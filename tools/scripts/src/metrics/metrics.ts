// The factory metrics of docs/agents/factory-metrics.md: which pull requests count, which category each is
// in, which were reworked, and how long CI took after each push. Pure functions over the GitHub REST API
// responses that cli.ts fetches with `gh api --paginate --slurp`.
import { isObject, objects } from "../checks/json.ts";

// The label an agent puts on its pull request when it pushes a change a person asked for (手直し).
const REWORK_LABEL = "rework";

// サンプル機能の PR, or ハーネスの PR.
export type Category = "sample" | "harness";

// A required status check of the ruleset: its name, and the app that must report it.
export interface RequiredCheck {
  readonly context: string;
  readonly app: number | undefined;
}

export interface Pull {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  // Opened by a GitHub App (Renovate and the like), not by an agent.
  readonly bot: boolean;
  readonly labels: readonly string[];
  readonly branch: string;
  readonly createdAt: number;
  readonly mergedAt: number | undefined;
}

export interface Merged extends Pull {
  readonly mergedAt: number;
}

// The feedback loop of one push: when it was pushed, and the milliseconds until every required check finished.
interface Loop {
  readonly pushedAt: number;
  readonly ms: number;
}

// A pull request that counts, with what cli.ts fetched for it.
export interface Sample {
  readonly pull: Merged;
  readonly category: Category;
  readonly loops: readonly Loop[];
}

// The values of a group of samples of one category. firstPass and reworked are counts out of `pulls`.
export interface Summary {
  readonly pulls: number;
  readonly firstPass: number;
  readonly reworked: number;
  readonly loops: readonly number[];
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

// A timestamp of the API (ISO 8601) in milliseconds; undefined for null.
const time = (value: unknown): number | undefined => {
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? undefined : ms;
};

// The items of `gh api --paginate --slurp`: an array of pages, each page the array of items itself, or an
// object that holds it under `key` (`workflow_runs`, `check_runs`).
export function items(pages: unknown, key?: string): unknown[] {
  if (!Array.isArray(pages)) return [];
  return pages.flatMap((page: unknown): unknown[] => {
    if (key === undefined) return Array.isArray(page) ? page : [];
    const inner = isObject(page) ? page[key] : undefined;
    return Array.isArray(inner) ? inner : [];
  });
}

// The required status checks of a ruleset (.github/rulesets/protect-main.json).
export function requiredChecks(ruleset: unknown): RequiredCheck[] {
  const rules = objects(isObject(ruleset) ? ruleset.rules : undefined);
  const parameters = rules.find((rule) => rule.type === "required_status_checks")?.parameters;
  const checks = objects(isObject(parameters) ? parameters.required_status_checks : undefined);
  return checks.flatMap((check) => {
    const context = text(check.context);
    if (context === undefined) return [];
    const app = typeof check.integration_id === "number" ? check.integration_id : undefined;
    return [{ context, app }];
  });
}

// A pull request of GET /repos/{owner}/{repo}/pulls; undefined for anything else.
export function toPull(raw: unknown): Pull | undefined {
  if (!isObject(raw) || typeof raw.number !== "number") return undefined;
  const createdAt = time(raw.created_at);
  if (createdAt === undefined) return undefined;
  return {
    number: raw.number,
    title: text(raw.title) ?? "",
    body: text(raw.body) ?? "",
    bot: isObject(raw.user) && raw.user.type === "Bot",
    labels: objects(raw.labels).flatMap((label) => text(label.name) ?? []),
    branch: text(isObject(raw.head) ? raw.head.ref : undefined) ?? "",
    createdAt,
    mergedAt: time(raw.merged_at),
  };
}

const isMerged = (pull: Pull): pull is Merged => pull.mergedAt !== undefined;

// The pull requests that count: merged, and not opened by a bot. In the order they were merged.
export const counted = (pulls: readonly Pull[]): Merged[] =>
  pulls
    .filter(isMerged)
    .filter((pull) => !pull.bot)
    .sort((a, b) => a.mergedAt - b.mergedAt);

// Those merged from `since` (included) to `until` (excluded).
export const inPeriod = (pulls: readonly Pull[], since: number, until: number): Merged[] =>
  counted(pulls).filter((pull) => pull.mergedAt >= since && pull.mergedAt < until);

export interface Around {
  readonly boundary: Merged;
  readonly before: readonly Merged[];
  readonly after: readonly Merged[];
}

// The `count` pull requests that count merged right before pull request `number`, and the `count` right after.
// The boundary itself is in neither. Undefined when `number` is not a merged pull request.
export function around(pulls: readonly Pull[], number: number, count: number): Around | undefined {
  const boundary = pulls.find((pull) => pull.number === number);
  if (boundary === undefined || !isMerged(boundary)) return undefined;
  const all = counted(pulls);
  return {
    boundary,
    before: all.filter((pull) => pull.mergedAt < boundary.mergedAt).slice(-count),
    after: all.filter((pull) => pull.mergedAt > boundary.mergedAt).slice(0, count),
  };
}

// A path of the sample feature: a file of a project in apps/ or packages/, except its lint rules (lint/) and
// the project's config files at its root, which are part of the harness.
const PROJECT_FILE = /^(?:apps|packages)\/[^/]+\/(.+)/;
const PROJECT_CONFIGS = new Set(["package.json", "tsconfig.json", "vite.config.ts"]);

export const isSampleFile = (path: string): boolean => {
  const inProject = PROJECT_FILE.exec(path)?.[1];
  return (
    inProject !== undefined && !inProject.startsWith("lint/") && !PROJECT_CONFIGS.has(inProject)
  );
};

// The category of a pull request from its files (GET /repos/{owner}/{repo}/pulls/{n}/files). A file renamed out
// of the sample feature counts by its old path too. A pull request that touches both is a sample one.
export const categoryOf = (files: readonly unknown[]): Category =>
  objects(files)
    .flatMap((file) => [file.filename, file.previous_filename])
    .some((path) => isSampleFile(String(path)))
    ? "sample"
    : "harness";

const REVERT_TITLE = /^revert(?:\([^)]*\))?!?:/;
// The field of the pull request template: `直す PR: #12, #34`.
const FIXES_FIELD = /^直す PR[:：]/;
// The line GitHub's Revert button writes: `Reverts owner/repo#12`.
const REVERTS_LINE = /^Reverts (?:[\w.-]+\/[\w.-]+)?#(\d+)$/;

// The pull requests that `pull` fixes: the ones in its 直す PR field and, for a `revert:` pull request, the one
// in GitHub's `Reverts` line.
export function fixes(pull: Pull): number[] {
  const lines = pull.body.split(/\r?\n/).map((line) => line.trim());
  const named = lines
    .filter((line) => FIXES_FIELD.test(line))
    .flatMap((line) => [...line.matchAll(/#(\d+)/g)].map((match) => Number(match[1])));
  if (!REVERT_TITLE.test(pull.title)) return named;
  const reverted = lines.flatMap((line) => REVERTS_LINE.exec(line)?.[1] ?? []).map(Number);
  return [...named, ...reverted];
}

// The pull requests reworked (手戻り): named by fixes() of a pull request merged after them. No time window.
// A pull request that is not merged, or not there, has no merge time: NaN, which is never before another.
export function reworked(pulls: readonly Pull[]): Set<number> {
  const mergedAt = new Map(pulls.map((pull) => [pull.number, pull.mergedAt]));
  const before = (target: number, fix: Pull): boolean =>
    Number(mergedAt.get(target)) < Number(fix.mergedAt);
  return new Set(pulls.flatMap((fix) => fixes(fix).filter((target) => before(target, fix))));
}

export interface Push {
  readonly sha: string;
  readonly pushedAt: number;
}

// The pushes to a pull request, from the workflow runs of its branch (GET /repos/{owner}/{repo}/actions/runs).
// A push is a head commit that started `pull_request` runs while the pull request was open; it was pushed when
// the first of them was created. A commit pushed under a later one starts no run, and does not count.
export function pushes(runs: readonly unknown[], pull: Merged): Push[] {
  const first = new Map<string, number>();
  for (const run of objects(runs)) {
    const sha = text(run.head_sha);
    const at = time(run.created_at);
    if (run.event !== "pull_request" || sha === undefined || at === undefined) continue;
    if (at < pull.createdAt || at > pull.mergedAt) continue;
    first.set(sha, Math.min(at, first.get(sha) ?? at));
  }
  return [...first]
    .map(([sha, pushedAt]) => ({ sha, pushedAt }))
    .sort((a, b) => a.pushedAt - b.pushedAt);
}

// The milliseconds from a push until every required check had finished on its commit, from the check runs of
// the commit (GET /repos/{owner}/{repo}/commits/{sha}/check-runs?filter=all). A check counts when it first
// finished without being cancelled (a later push cancels the runs of the earlier one). Undefined when a required
// check never finished.
export function feedbackLoop(
  pushedAt: number,
  checkRuns: readonly unknown[],
  required: readonly RequiredCheck[],
): number | undefined {
  const runs = objects(checkRuns);
  let last = pushedAt;
  for (const check of required) {
    const finished = runs
      .filter((run) => run.name === check.context && run.conclusion !== "cancelled")
      .filter((run) => check.app === undefined || (isObject(run.app) && run.app.id === check.app))
      .flatMap((run) => time(run.completed_at) ?? []);
    if (finished.length === 0) return undefined;
    last = Math.max(last, Math.min(...finished));
  }
  return last - pushedAt;
}

// The values of each category for a group of samples.
export function summarize(
  samples: readonly Sample[],
  reworkedPulls: ReadonlySet<number>,
): Record<Category, Summary> {
  const of = (category: Category): Summary => {
    const group = samples.filter((sample) => sample.category === category);
    return {
      pulls: group.length,
      firstPass: group.filter((sample) => !sample.pull.labels.includes(REWORK_LABEL)).length,
      reworked: group.filter((sample) => reworkedPulls.has(sample.pull.number)).length,
      loops: group.flatMap((sample) => sample.loops.map((loop) => loop.ms)),
    };
  };
  return { sample: of("sample"), harness: of("harness") };
}

// The q-quantile (0 to 1) of values, interpolating linearly between the two nearest ranks (the default method,
// linear, of numpy.quantile: https://numpy.org/doc/stable/reference/generated/numpy.quantile.html).
// Undefined for no values.
export function quantile(values: readonly number[], q: number): number | undefined {
  const sorted = values.toSorted((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const rank = (sorted.length - 1) * q;
  const below = Math.floor(rank);
  const low = Number(sorted[below]);
  const high = Number(sorted[Math.ceil(rank)]);
  return low + (high - low) * (rank - below);
}
