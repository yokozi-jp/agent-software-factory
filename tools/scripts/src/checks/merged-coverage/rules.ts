// The rules of the merged coverage check (#567, docs/tooling/ci.md ("coverage の下限")). The projects of Nx each write
// coverage/coverage-final.json (Istanbul's format) and count the files they load, whichever project owns them. This
// check adds the records up: a file is covered by what every project's tests ran, and each measured file must reach the
// minimum of coverage-policy.json. Pure functions; cli.ts reads the files and prints.
import { matchesGlob } from "node:path";
import { isObject } from "../json.ts";

// What coverage counts, in coverage-policy.json. vitest-coverage.ts reads the same table to make the `include` and
// `exclude` of every project's record, so the files that a project writes and the files that this check counts cannot
// differ (#577). Paths and globs are from the repository root.
export interface Scope {
  // The directories of the Nx projects that write a record (globs); their `src` is what counts.
  readonly projects: readonly string[];
  // Kinds of files that are never counted: tests, fixtures that break the lint on purpose, generated files, stories.
  readonly notMeasured: readonly string[];
  // Files (or globs) that are never counted by design, with the reason: the entry files that only start the program.
  readonly entries: ReadonlyMap<string, string>;
}

export interface Policy extends Scope {
  readonly minimum: { readonly lines: number; readonly branches: number };
  // Measured files that are left out, for now: path from the repository root to the reason. A row is removed when the
  // tests reach the minimum, unlike an entry, which stays.
  readonly exceptions: ReadonlyMap<string, string>;
}

// One file of a record, reduced to what the minimum counts. A statement is keyed by its location and a branch by its
// type and location, so the same source in two records lines up, and a different one does not add up wrongly.
export interface FileCoverage {
  readonly statements: ReadonlyMap<string, { readonly line: number; readonly hits: number }>;
  readonly branches: ReadonlyMap<string, readonly number[]>;
}

// How many of the things (lines, branch paths) that a file has ran.
interface Ratio {
  readonly covered: number;
  readonly total: number;
}

export interface Summary {
  readonly lines: Ratio;
  readonly branches: Ratio;
}

// The `src` of each project (`.ts` and `.tsx`) is where the files that count are. vitest-coverage.ts makes the same globs,
// one for each project: a single name in braces would not be expanded.
const sourcesOf = (project: string): string => `${project}/src/**/*.{ts,tsx}`;

const inSources = (path: string, { projects }: Scope): boolean =>
  projects.some((project) => matchesGlob(path, sourcesOf(project)));

const leftOut = (scope: Scope): string[] => [...scope.notMeasured, ...scope.entries.keys()];

// The files that count: the code of the projects, except what the table says is not measured.
export const isMeasured = (path: string, scope: Scope): boolean =>
  inSources(path, scope) && !leftOut(scope).some((glob) => matchesGlob(path, glob));

// The Nx projects that write a record: apps/<x>, packages/<x> and packages/<x>/events. A file belongs to the project
// whose directory it is under, and a project is in scope when its record exists (the affected projects ran `test`).
export const projectOf = (path: string, projects: readonly string[]): string | undefined =>
  projects
    .filter((project) => path.startsWith(`${project}/`))
    .toSorted((a, b) => b.length - a.length)[0];

// Which of the directories that hold a record are read: those of the affected projects. The others hold a record that an
// earlier run left (a CI checkout has none), and are not read (#579).
export function scopeOf(
  recorded: readonly string[],
  affected: readonly string[],
): { readonly projects: string[]; readonly stale: string[] } {
  return {
    projects: recorded.filter((project) => affected.includes(project)),
    stale: recorded.filter((project) => !affected.includes(project)),
  };
}

// A table of reasons (`exceptions`, `entries`): a path or a glob to why. A row without a reason is a row nobody can judge.
function reasons(value: unknown, table: string, kind: string): Map<string, string> | string {
  if (!isObject(value)) return `coverage-policy.json: ${table} is not an object`;
  const entries: [string, string][] = [];
  for (const [path, reason] of Object.entries(value)) {
    if (typeof reason !== "string" || reason.trim() === "") {
      return `coverage-policy.json: the ${kind} for ${path} has no reason`;
    }
    entries.push([path, reason]);
  }
  return new Map(entries);
}

// A list of globs, none empty.
const globs = (value: unknown, name: string): string[] | string =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "")
    ? value.map(String)
    : `coverage-policy.json: ${name} needs a list of globs`;

export function parsePolicy(value: unknown): Policy | string {
  if (!isObject(value)) return "coverage-policy.json is not an object";
  const { minimum } = value;
  if (
    !isObject(minimum) ||
    typeof minimum.lines !== "number" ||
    typeof minimum.branches !== "number"
  ) {
    return "coverage-policy.json: minimum needs numbers for lines and branches";
  }
  const projects = globs(value.projects, "projects");
  if (typeof projects === "string") return projects;
  if (projects.length === 0) return "coverage-policy.json: projects needs a list of globs";
  const notMeasured = globs(value.notMeasured, "notMeasured");
  if (typeof notMeasured === "string") return notMeasured;
  const entries = reasons(value.entries, "entries", "entry");
  if (typeof entries === "string") return entries;
  const exceptions = reasons(value.exceptions, "exceptions", "exception");
  if (typeof exceptions === "string") return exceptions;
  return {
    minimum: { lines: minimum.lines, branches: minimum.branches },
    projects,
    notMeasured,
    entries,
    exceptions,
  };
}

const numbers = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === "number");

// The line where an Istanbul location starts.
const startLine = (location: unknown): unknown =>
  isObject(location) && isObject(location.start) ? location.start.line : undefined;

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
    const line = startLine(location);
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
const reaches = ({ covered, total }: Ratio, percent: number): boolean =>
  // Stryker disable next-line ConditionalExpression: equivalent, with nothing to count `0 >= percent * 0` holds for any finite percent
  total === 0 || covered * 100 >= percent * total;

const meetsMinimum = (summary: Summary, minimum: Policy["minimum"]): boolean =>
  reaches(summary.lines, minimum.lines) && reaches(summary.branches, minimum.branches);

const percent = ({ covered, total }: Ratio): string =>
  total === 0 ? "100" : (Math.floor((covered / total) * 10_000) / 100).toString();

// Adds one file of a record to the merged coverage of the repository.
export function addFile(
  coverage: Map<string, FileCoverage>,
  path: string,
  file: FileCoverage,
): void {
  const before = coverage.get(path);
  coverage.set(path, before === undefined ? file : mergeFileCoverage(before, file));
}

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
  // An entry is never counted, so a row that no file of a project's `src` matches (the entry was renamed or deleted)
  // is a row to remove, as for an exception.
  for (const glob of policy.entries.keys()) {
    if (!tracked.some((path) => inSources(path, policy) && matchesGlob(path, glob))) {
      failures.push(`${glob}: the entry matches no file. Remove its row.`);
    }
  }
  for (const path of policy.exceptions.keys()) {
    if (!known.has(path)) {
      failures.push(`${path}: the exception names a file that does not exist. Remove its row.`);
    } else if (!isMeasured(path, policy)) {
      failures.push(
        `${path}: the exception names a file that is not measured anyway. Remove its row.`,
      );
    }
  }
  const { lines, branches } = policy.minimum;
  for (const path of tracked.filter((path) => isMeasured(path, policy)).toSorted()) {
    if (projectOf(path, projects) === undefined) continue;
    const file = coverage.get(path);
    if (policy.exceptions.has(path)) {
      // An exception that the tests have outgrown is a row to remove, so the file is checked again.
      if (file !== undefined && meetsMinimum(summarize(file), policy.minimum)) {
        failures.push(
          `${path}: the file reaches the minimum now. Remove its row from coverage-policy.json.`,
        );
      }
      continue;
    }
    if (file === undefined) {
      failures.push(
        `${path}: no test of any project ran it, and it is not an exception. Add a test, or a row to coverage-policy.json with the reason.`,
      );
      continue;
    }
    const summary = summarize(file);
    if (!meetsMinimum(summary, policy.minimum)) {
      failures.push(
        `${path}: lines ${percent(summary.lines)}% (minimum ${lines}%), branches ${percent(summary.branches)}% (minimum ${branches}%).`,
      );
    }
  }
  return failures;
}
