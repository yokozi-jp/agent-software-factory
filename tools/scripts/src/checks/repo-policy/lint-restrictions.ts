// The table of lint restrictions (lint-restrictions.json, docs/adr/0050) agrees with its fixtures.
// The table lists, for each restriction, what vite.config.ts stops (the values and the message) and the lines of the
// fixtures that show it: a line that the rule stops, below `oxlint-disable-next-line <rule>`, and a line that it lets
// through, with no disable comment above. The disable comments fail `vp check` when they are unused
// (`reportUnusedDisableDirectives`), so the table and the fixtures together show that every value is stopped where it
// should be and let through where it should be. This check reads both ways: every row has its line, and every line of a
// fixture of the table has its row, so removing either fails.
import { Tree, isRecord, record, text } from "./tree.ts";

const tablePath = "lint-restrictions.json";
const howTo = 'docs/tooling/ci.md ("禁止の表")';

interface Row {
  readonly files: readonly string[];
  readonly rule: string;
  readonly text: string;
  readonly expect: "stop" | "pass";
  readonly reason: string;
}

interface Restriction {
  readonly adr: string;
  readonly values: readonly string[];
  readonly message?: string;
  readonly mentions: readonly string[];
}

type Shape = Record<string, unknown>;

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const shapeFailure = (where: string, what: string): string =>
  `${tablePath} の ${where} が${what}でない (${howTo})。`;

// The fields of a row that do not have their shape, each with what it should be.
function rowProblems(row: Shape): (readonly [string, string])[] {
  const files = row.files;
  return [
    ...(isStrings(files) && files.length > 0 && files.every((file) => text(file) !== undefined)
      ? []
      : [["files", "空でない文字列の配列"] as const]),
    ...["rule", "text", "reason"]
      .filter((name) => text(row[name]) === undefined)
      .map((name) => [name, "空でない文字列"] as const),
    ...(row.expect === "stop" || row.expect === "pass"
      ? []
      : [["expect", '"stop" か "pass"'] as const]),
  ];
}

// The fields of a restriction, other than its rows, that do not have their shape.
function restrictionProblems(restriction: Shape): (readonly [string, string])[] {
  return [
    ...(typeof restriction.adr === "string" ? [] : [["adr", "文字列"] as const]),
    ...["values", "mentions"]
      .filter((name) => !isStrings(restriction[name]))
      .map((name) => [name, "文字列の配列"] as const),
    ...(restriction.message === undefined || typeof restriction.message === "string"
      ? []
      : [["message", "文字列"] as const]),
    ...(Array.isArray(restriction.rows) ? [] : [["rows", "配列"] as const]),
  ];
}

// Whether a value with no problems has the shape. The problems are checked above, field by field.
const hasShape = <T>(value: Shape, problems: readonly unknown[]): value is Shape & T =>
  problems.length === 0;

interface Table {
  readonly restrictions: readonly (readonly [string, Restriction, readonly Row[]])[];
  readonly failures: readonly string[];
}

// The restrictions and the rows of the table that have their shape, and a failure for each part that does not.
function readTable(table: unknown): Table {
  if (!isRecord(table))
    return {
      restrictions: [],
      failures: [`${tablePath} の最上位がオブジェクトでない (${howTo})。`],
    };
  const restrictions: [string, Restriction, Row[]][] = [];
  const failures: string[] = [];
  for (const [key, value] of Object.entries(table)) {
    if (!isRecord(value)) {
      failures.push(shapeFailure(key, "オブジェクト"));
      continue;
    }
    const problems = restrictionProblems(value);
    failures.push(...problems.map(([name, what]) => shapeFailure(`${key}.${name}`, what)));
    if (!hasShape<Restriction & { rows: unknown[] }>(value, problems)) continue;
    const rows: Row[] = [];
    for (const [index, row] of value.rows.entries()) {
      const where = `${key}.rows[${index}]`;
      if (!isRecord(row)) {
        failures.push(shapeFailure(where, "オブジェクト"));
        continue;
      }
      const wrong = rowProblems(row);
      failures.push(...wrong.map(([name, what]) => shapeFailure(`${where}.${name}`, what)));
      if (hasShape<Row>(row, wrong)) rows.push(row);
    }
    restrictions.push([key, value, rows]);
  }
  return { restrictions, failures };
}

// The rules of an `oxlint-disable-next-line` comment that fills its line (`// ...` or `/* ... */`), before the
// ` --` of the reason or the end of the comment; undefined for any other line.
function disabledRules(line: string): string[] | undefined {
  const match = /^\s*(?:\/\/|\/\*)\s*oxlint-disable-next-line\s(.*)/.exec(line);
  if (match === null) return undefined;
  const [rules] = String(match[1]).split(/\s--|\*\//);
  return String(rules)
    .split(",")
    .map((rule) => rule.trim())
    .filter((rule) => rule !== "");
}

const isComment = (line: string): boolean => /^\s*(?:\/\/|\/\*|\*)/.test(line);

// The lines of code of a fixture, each with its number and the rules of the disable comment just above it
// (undefined when the line above is not one).
interface CodeLine {
  readonly number: number;
  readonly text: string;
  readonly disabled: readonly string[] | undefined;
}

function codeLines(source: string): CodeLine[] {
  const lines = source.split(/\r?\n/);
  return lines.flatMap((line, index) =>
    line.trim() === "" || isComment(line)
      ? []
      : [{ number: index + 1, text: line, disabled: disabledRules(String(lines[index - 1])) }],
  );
}

// Whether the line is one that the row asks for: below the disable comment of its rule when it stops, with no
// disable comment above when it lets through. A type import is not told apart: a disable comment above one is
// unused, and fails `vp check`.
const matches = (row: Row, line: CodeLine): boolean =>
  line.text.includes(row.text) &&
  (row.expect === "stop"
    ? (line.disabled?.includes(row.rule) ?? false)
    : line.disabled === undefined);

const missingLine = (file: string, row: Row, adr: string): string => {
  const where =
    row.expect === "stop"
      ? `\`oxlint-disable-next-line ${row.rule}\` の次の行で`
      : "disable のコメントを前に置かずに";
  return `\`${file}\` に、${where} \`${row.text}\` を書いた行がない。${row.reason} (${adr})。`;
};

// A fixture of the table is named after its key: <dir>/__fixtures__/<key>.ts, or <key>.test.ts for the override of
// the tests. The fixtures of the checks themselves (tools/scripts/src/checks/) are the input of their tests.
const fixtureKey = (path: string): string | undefined =>
  path.startsWith("tools/scripts/src/checks/")
    ? undefined
    : /(?:^|\/)__fixtures__\/([^/]+?)(?:\.test)?\.tsx?$/.exec(path)?.[1];

// Whether `value` is in `text` as a whole name: not as a part of a longer name.
const hasName = (text: string, value: string): boolean =>
  new RegExp(`(?<![\\w-])${value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\w-])`).test(text);

function restrictionFailures(
  tree: Tree,
  key: string,
  restriction: Restriction,
  rows: readonly Row[],
): string[] {
  const { adr } = restriction;
  const failures: string[] = [];
  const named = (file: string) => fixtureKey(file) === key;
  for (const file of [...new Set(rows.flatMap((row) => row.files))].filter((f) => !named(f)))
    failures.push(
      `${tablePath} の ${key} の行が \`${file}\` を挙げるが、fixture のファイルは __fixtures__/${key}.ts か __fixtures__/${key}.test.ts にする (${howTo})。`,
    );
  for (const row of rows)
    for (const file of row.files.filter(named))
      if (!codeLines(tree.read(file)).some((line) => matches(row, line)))
        failures.push(missingLine(file, row, adr));
  // Each file that stops the restriction has a row for each value it stops, so that a value added to the table
  // without a fixture fails.
  const stops = rows.filter((row) => row.expect === "stop");
  for (const value of restriction.values)
    for (const file of new Set(stops.flatMap((row) => row.files)))
      if (!stops.some((row) => row.files.includes(file) && hasName(row.text, value)))
        failures.push(
          `${tablePath} の ${key} は \`${value}\` を止めるが、\`${file}\` に、それを書いて止める行が表にない。表と fixture に止める行を足す (${howTo})。`,
        );
  // The message that Oxlint reports says what to write instead and names the ADR, so that an agent that is stopped
  // knows the way out.
  const { message } = restriction;
  if (message !== undefined)
    for (const mention of [...restriction.mentions, adr])
      if (!message.includes(mention))
        failures.push(
          `${tablePath} の ${key} の message に \`${mention}\` がない。止められた人が、代わりに書くものと ADR を知るため (${howTo})。`,
        );
  return failures;
}

// Every line of a fixture of the table that the rule stops, or that has a text of the restriction and is let through,
// has its row: a row removed from the table fails here.
function unlistedLines(tree: Tree, key: string, allRows: readonly Row[], file: string): string[] {
  const rows = allRows.filter((row) => row.files.includes(file));
  const failures: string[] = [];
  for (const line of codeLines(tree.read(file))) {
    for (const rule of line.disabled ?? [])
      if (!rows.some((row) => row.rule === rule && matches(row, line)))
        failures.push(
          `\`${file}\` の ${line.number} 行目は \`${rule}\` で止める行だが、${tablePath} の ${key} に、このファイルでこの行を止める行がない。表に行を足すか、fixture から行を消す (${howTo})。`,
        );
    if (
      line.disabled === undefined &&
      allRows.some((row) => line.text.includes(row.text)) &&
      !rows.some((row) => matches(row, line))
    )
      failures.push(
        `\`${file}\` の ${line.number} 行目は ${key} の文字列を書いて通す行だが、${tablePath} の ${key} に、このファイルでこの行を通す行がない。表に行を足すか、fixture から行を消す (${howTo})。`,
      );
  }
  return failures;
}

// Whether the path is a fixture of the table: one named after a key. It shows one restriction, and is not a fixture of
// the overrides that lint-fixtures.ts asks of a directory.
export const isRestrictionFixture = (tree: Tree, path: string): boolean =>
  Object.keys(record(tree.parsed(tablePath))).some((key) => key === fixtureKey(path));

export function lintRestrictionsAgree(tree: Tree): string[] {
  const table = tree.parsed("lint-restrictions.json");
  if (table === undefined)
    return tree.paths.includes(tablePath)
      ? []
      : [
          `${tablePath} がない。lint で止める import と呼び出しと、その fixture の行を並べる表で、vite.config.ts と repo-policy が読む (${howTo})。`,
        ];
  const { restrictions, failures } = readTable(table);
  return [
    ...failures,
    ...restrictions.flatMap(([key, restriction, rows]) =>
      restrictionFailures(tree, key, restriction, rows),
    ),
    ...tree.paths.flatMap((file) =>
      restrictions
        .filter(([key]) => key === fixtureKey(file))
        .flatMap(([key, , rows]) => unlistedLines(tree, key, rows, file)),
    ),
  ];
}
