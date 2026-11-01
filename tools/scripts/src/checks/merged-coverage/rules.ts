// The rules of the merged coverage check (#567, docs/tooling/ci.md ("coverage の下限")). The projects of Nx each write
// coverage/coverage-final.json (Istanbul's format) and count the files they load, whichever project owns them. This
// check adds the records up: a file is covered by what every project's tests ran, and each measured file must reach the
// minimum of coverage-policy.json. Pure functions; cli.ts reads the files and prints.
import { isObject } from "../json.ts";

export interface Policy {
  readonly minimum: { readonly lines: number; readonly branches: number };
  // Measured files that are left out: path from the repository root to the reason.
  readonly exceptions: ReadonlyMap<string, string>;
}

// One file of a record, reduced to what the minimum counts. A statement is keyed by its location and a branch by its
// type and location, so the same source in two records lines up, and a different one does not add up wrongly.
export interface FileCoverage {
  readonly statements: ReadonlyMap<string, { readonly line: number; readonly hits: number }>;
  readonly branches: ReadonlyMap<string, readonly number[]>;
}

export interface Summary {
  readonly lines: { readonly covered: number; readonly total: number };
  readonly branches: { readonly covered: number; readonly total: number };
}

// The files that count: the code of apps and packages (and the events packages in them), not the tests, the fixtures
// that break the lint on purpose, the generated files and the stories. The exclude lists in the vite.config.ts of the
// projects say the same, for the coverage they write.
const measured = /^(apps|packages)\/[^/]+\/(events\/)?src\/.+\.tsx?$/u;
const notMeasured = /(\.test\.tsx?|\.d\.ts|\.gen\.ts|\.stories\.tsx)$|\/__fixtures__\//u;

export const isMeasured = (path: string): boolean => measured.test(path) && !notMeasured.test(path);

// The Nx projects that write a record: apps/<x>, packages/<x> and packages/<x>/events. A file belongs to the project
// whose directory it is under, and a project is in scope when its record exists (the affected projects ran `test`).
export const projectOf = (path: string, projects: readonly string[]): string | undefined =>
  projects
    .filter((project) => path.startsWith(`${project}/`))
    .toSorted((a, b) => b.length - a.length)[0];

export function parsePolicy(value: unknown): Policy | string {
  if (!isObject(value)) return "coverage-policy.json is not an object";
  const { minimum, exceptions } = value;
  if (
    !isObject(minimum) ||
    typeof minimum.lines !== "number" ||
    typeof minimum.branches !== "number"
  ) {
    return "coverage-policy.json: minimum needs numbers for lines and branches";
  }
  if (!isObject(exceptions)) return "coverage-policy.json: exceptions is not an object";
  const entries: [string, string][] = [];
  for (const [path, reason] of Object.entries(exceptions)) {
    if (typeof reason !== "string" || reason.trim() === "") {
      return `coverage-policy.json: the exception for ${path} has no reason`;
    }
    entries.push([path, reason]);
  }
  return {
    minimum: { lines: minimum.lines, branches: minimum.branches },
    exceptions: new Map(entries),
  };
}

const numbers = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === "number");

// A file of coverage-final.json; undefined when it is not in Istanbul's format.
export function parseFileCoverage(value: unknown): FileCoverage | undefined {
  if (!isObject(value)) return undefined;
  const { statementMap, s, branchMap, b } = value;
  if (!isObject(statementMap) || !isObject(s) || !isObject(branchMap) || !isObject(b)) {
    return undefined;
  }
  const statements = new Map<string, { line: number; hits: number }>();
  for (const [id, location] of Object.entries(statementMap)) {
    const hits = s[id];
    const line = isObject(location) && isObject(location.start) ? location.start.line : undefined;
    if (typeof hits !== "number" || typeof line !== "number") return undefined;
    const key = JSON.stringify(location);
    statements.set(key, { line, hits: (statements.get(key)?.hits ?? 0) + hits });
  }
  const branches = new Map<string, number[]>();
  for (const [id, branch] of Object.entries(branchMap)) {
    const counts = b[id];
    if (!isObject(branch) || !numbers(counts)) return undefined;
    branches.set(`${String(branch.type)}:${JSON.stringify(branch.loc)}`, counts);
  }
  return { statements, branches };
}

const addCounts = (a: readonly number[], b: readonly number[]): number[] =>
  a.map((count, index) => count + (b[index] ?? 0));

// The sum of two records of one file: what either ran.
export function mergeFileCoverage(a: FileCoverage, b: FileCoverage): FileCoverage {
  const statements = new Map(a.statements);
  for (const [key, statement] of b.statements) {
    const same = statements.get(key);
    statements.set(
      key,
      same === undefined ? statement : { line: same.line, hits: same.hits + statement.hits },
    );
  }
  const branches = new Map(a.branches);
  for (const [key, counts] of b.branches) {
    const same = branches.get(key);
    branches.set(key, same === undefined ? counts : addCounts(same, counts));
  }
  return { statements, branches };
}

// A line is covered when a statement that starts on it ran, as in Istanbul's getLineCoverage; a branch counts once per
// path (an `if` has two).
export function summarize(file: FileCoverage): Summary {
  const lines = new Map<number, number>();
  for (const { line, hits } of file.statements.values()) {
    lines.set(line, Math.max(lines.get(line) ?? 0, hits));
  }
  const paths = [...file.branches.values()].flat();
  return {
    lines: { covered: [...lines.values()].filter((hits) => hits > 0).length, total: lines.size },
    branches: { covered: paths.filter((hits) => hits > 0).length, total: paths.length },
  };
}

// Whether covered/total reaches the percentage. Nothing to count is 100%, as in Vitest. Integers only: no rounding.
const reaches = (
  { covered, total }: { covered: number; total: number },
  percent: number,
): boolean => total === 0 || covered * 100 >= percent * total;

const percent = ({ covered, total }: { covered: number; total: number }): string =>
  total === 0 ? "100" : (Math.floor((covered / total) * 10_000) / 100).toString();

export interface Input {
  readonly policy: Policy;
  // Every file of the repository that git knows.
  readonly tracked: readonly string[];
  // The directories of the projects whose record exists.
  readonly projects: readonly string[];
  // The merged record: repository path to the file.
  readonly coverage: ReadonlyMap<string, FileCoverage>;
}

export function violations({ policy, tracked, projects, coverage }: Input): string[] {
  const failures: string[] = [];
  const known = new Set(tracked);
  for (const path of policy.exceptions.keys()) {
    if (!known.has(path)) {
      failures.push(`${path}: the exception names a file that does not exist. Remove its row.`);
    } else if (!isMeasured(path)) {
      failures.push(
        `${path}: the exception names a file that is not measured anyway. Remove its row.`,
      );
    }
  }
  const { lines, branches } = policy.minimum;
  for (const path of tracked.filter(isMeasured).toSorted()) {
    if (projectOf(path, projects) === undefined || policy.exceptions.has(path)) continue;
    const file = coverage.get(path);
    if (file === undefined) {
      failures.push(
        `${path}: no test of any project ran it, and it is not an exception. Add a test, or a row to coverage-policy.json with the reason.`,
      );
      continue;
    }
    const summary = summarize(file);
    if (!reaches(summary.lines, lines) || !reaches(summary.branches, branches)) {
      failures.push(
        `${path}: lines ${percent(summary.lines)}% (minimum ${lines}%), branches ${percent(summary.branches)}% (minimum ${branches}%).`,
      );
    }
  }
  return failures;
}
