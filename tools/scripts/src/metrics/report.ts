// The text that cli.ts prints: the factory metrics as Markdown, for a person to read
// (docs/agents/factory-metrics.md). Every rate comes with the counts it is made of. It prints no count of lines,
// commits or pull requests of its own: the factory is not measured by its output.
import { day, months, month, week } from "./jst.ts";
import {
  quantile,
  summarize,
  type Category,
  type Merged,
  type Sample,
  type Summary,
} from "./metrics.ts";

const DEFINITIONS = "定義は docs/agents/factory-metrics.md にあります。";
const NONE = "—";

const rate = (part: number, whole: number): string =>
  whole === 0 ? NONE : `${Math.round((part / whole) * 100)}% (${part}/${whole})`;

const minutes = (ms: number | undefined): string => `${(Number(ms) / 60_000).toFixed(1)} 分`;

// The median and p90 of the feedback loops, with the number of pushes they come from.
const loopCell = (loops: readonly number[]): string =>
  loops.length === 0
    ? NONE
    : `中央値 ${minutes(quantile(loops, 0.5))}、p90 ${minutes(quantile(loops, 0.9))} (push ${loops.length})`;

const row = (cells: readonly string[]): string => `| ${cells.join(" | ")} |\n`;

const table = (first: string, rows: readonly (readonly string[])[]): string =>
  row([first, "サンプル機能の PR", "ハーネスの PR"]) +
  row(["---", "---", "---"]) +
  rows.map(row).join("");

const perCategory = (
  summaries: Record<Category, Summary>,
  cell: (summary: Summary) => string,
): string[] => [cell(summaries.sample), cell(summaries.harness)];

// The rows of the values of a group: the rates, and the feedback loop when `withLoops`.
function valueRows(summaries: Record<Category, Summary>, withLoops: boolean): string[][] {
  const rows = [
    ["first-pass acceptance", ...perCategory(summaries, (s) => rate(s.firstPass, s.pulls))],
    ["手戻りの割合", ...perCategory(summaries, (s) => rate(s.reworked, s.pulls))],
  ];
  if (withLoops)
    rows.push(["CI の feedback loop の時間", ...perCategory(summaries, (s) => loopCell(s.loops))]);
  return rows;
}

const pullLine = (pull: Merged): string =>
  `- ${day(pull.mergedAt)} #${pull.number} ${pull.title}\n`;

export interface PeriodInput {
  readonly since: number;
  readonly until: number;
  // The pull requests merged in the period that count (metrics.ts inPeriod), with their details.
  readonly samples: readonly Sample[];
  readonly reworked: ReadonlySet<number>;
}

// Each month of the period: the rates of the pull requests merged in it, and next to them the harness pull
// requests merged in it. Then the feedback loop of each week, over the pushes to those pull requests.
export function periodReport({ since, until, samples, reworked }: PeriodInput): string {
  let out = `# 工場の成果の指標: ${day(since)} から ${day(until - 1)} まで\n\n`;
  out += `merge した日 (JST) で PR を数えます。bot の PR は数えません。${DEFINITIONS}\n`;

  for (const key of months(since, until - 1)) {
    const inMonth = samples.filter((sample) => month(sample.pull.mergedAt) === key);
    out += `\n## ${key}\n\n${table("指標", valueRows(summarize(inMonth, reworked), false))}`;
    const harness = inMonth.filter((sample) => sample.category === "harness");
    out +=
      harness.length === 0
        ? "\nその月に merge されたハーネスの PR: なし\n"
        : `\nその月に merge されたハーネスの PR:\n\n${harness.map((sample) => pullLine(sample.pull)).join("")}`;
  }

  out += "\n## CI の feedback loop の時間 (週ごと)\n\n";
  out += "期間に merge された PR への push を、push した週 (月曜から、JST) で分けます。\n\n";
  const loops = samples.flatMap((sample) =>
    sample.loops.map((loop) => ({
      category: sample.category,
      week: week(loop.pushedAt),
      ms: loop.ms,
    })),
  );
  const weeks = [...new Set(loops.map((loop) => loop.week))].sort();
  if (weeks.length === 0) return `${out}必須チェックがすべて終わった push がありません。\n`;
  const cell = (key: string, category: Category): string =>
    loopCell(
      loops
        .filter((loop) => loop.week === key && loop.category === category)
        .map((loop) => loop.ms),
    );
  return (
    out +
    table(
      "週",
      weeks.map((key) => [key, cell(key, "sample"), cell(key, "harness")]),
    )
  );
}

export interface BoundaryInput {
  readonly boundary: Merged;
  readonly count: number;
  readonly before: readonly Sample[];
  readonly after: readonly Sample[];
  readonly reworked: ReadonlySet<number>;
}

// The values of the pull requests merged before the boundary, and of those after it.
export function boundaryReport({
  boundary,
  count,
  before,
  after,
  reworked,
}: BoundaryInput): string {
  const { number } = boundary;
  let out = `# 工場の成果の指標: #${number} の前後 ${count} 件\n\n`;
  out += `merge した順に、#${number} (${day(boundary.mergedAt)} に merge) の前と後の PR を数えます。`;
  out += `#${number} 自身と bot の PR は数えません。${DEFINITIONS}\n`;
  const side = (heading: string, samples: readonly Sample[]): string => {
    if (samples.length === 0) return `\n## ${heading}\n\nmerge された PR がありません。\n`;
    const times = samples.map((sample) => sample.pull.mergedAt);
    const span = `${day(Math.min(...times))} から ${day(Math.max(...times))} に merge`;
    return `\n## ${heading} (${span})\n\n${table("指標", valueRows(summarize(samples, reworked), true))}`;
  };
  return out + side(`#${number} より前`, before) + side(`#${number} より後`, after);
}
