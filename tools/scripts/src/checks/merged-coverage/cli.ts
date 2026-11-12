// Add up the coverage records of the projects and check each measured file against the minimum of coverage-policy.json
// (#567, docs/tooling/ci.md ("coverage の下限")). Run from the repository root after `nx affected -t test` (CI), or by hand:
//   node tools/scripts/src/checks/merged-coverage/cli.ts
// A project is in scope when nx says it is affected and it wrote coverage/coverage-final.json. The records of the other
// projects (left in coverage/ by an earlier run; a CI checkout has none) are not read, and are named in the output (#579).
// Exit codes: 0 passes (also when no affected project runs tests, so there is no record), 1 a file is under the minimum or
// an exception is wrong, 2 the check could not run (no record although tests were affected, nx cannot say which projects
// are affected, bad policy).
// The rules are in rules.ts; this file reads the files and prints.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { tryGit } from "../git.ts";
import { isObject } from "../json.ts";
import {
  isMeasured,
  addFile,
  parseFileCoverage,
  parsePolicy,
  scopeOf,
  violations,
  type FileCoverage,
} from "./rules.ts";

class CannotRun extends Error {}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CannotRun(`${path}: not valid JSON.`);
  }
}

// The directories that can be an Nx project with a record: apps/<x>, packages/<x> and packages/<x>/events.
function candidates(top: string): string[] {
  const subdirectories = (dir: string): string[] =>
    existsSync(join(top, dir))
      ? readdirSync(join(top, dir), { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
          .map((entry) => `${dir}/${entry.name}`)
      : [];
  return [
    ...subdirectories("apps"),
    ...subdirectories("packages").flatMap((dir) => [dir, `${dir}/events`]),
  ];
}

// The output of `pnpm exec nx <args>`, or undefined when nx cannot say (a non-zero exit).
function nx(top: string, args: string[]): string | undefined {
  const result = spawnSync("pnpm", ["exec", "nx", ...args], { cwd: top, encoding: "utf8" });
  return result.status === 0 ? result.stdout : undefined;
}

// The names of the projects that `nx show projects` prints for these arguments, or undefined when nx cannot say.
const nxProjects = (top: string, args: string[]): string[] | undefined =>
  nx(top, ["show", "projects", ...args])
    ?.split("\n")
    .filter((line) => line.trim() !== "");

// The root of each project by name, from the project graph (`nx graph --print`), or undefined when nx cannot say. The
// names that nx prints (`shared-kernel`, `approval-events`) do not follow the directories (packages/approval/events), so
// the directories are asked in one call, instead of one `nx show project` for each project.
function nxRoots(top: string): ReadonlyMap<string, string> | undefined {
  const output = nx(top, ["graph", "--print"]);
  if (output === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(output);
    const nodes = isObject(parsed) && isObject(parsed.graph) ? parsed.graph.nodes : undefined;
    if (!isObject(nodes)) return undefined;
    const roots = new Map<string, string>();
    for (const [name, node] of Object.entries(nodes)) {
      const root = isObject(node) && isObject(node.data) ? node.data.root : undefined;
      if (typeof root === "string") roots.set(name, root);
    }
    return roots;
  } catch {
    return undefined;
  }
}

// The directories of the projects that nx would run `test` for in this change and that can write a record (the
// directories of candidates()), or undefined when nx cannot say. A change that touches none of them (docs only, a version
// bump of a tool, or tools/scripts alone, whose coverage is not a record of this check) has none: `nx affected -t test`
// then writes no record, and that is not a failure.
// `--projects` makes `nx show projects` ignore `--affected` (it prints every matching project), so the directories are
// asked separately and the two answers are intersected.
function affectedRecordRoots(top: string): string[] | undefined {
  const affected = nxProjects(top, ["--affected", "--with-target", "test"]);
  const withRecord = nxProjects(top, [
    "--with-target",
    "test",
    ...["apps/*", "packages/*", "packages/*/events"].flatMap((glob) => ["--projects", glob]),
  ]);
  const roots = nxRoots(top);
  if (affected === undefined || withRecord === undefined || roots === undefined) return undefined;
  const directories: string[] = [];
  for (const name of affected.filter((project) => withRecord.includes(project))) {
    const root = roots.get(name);
    if (root === undefined) return undefined;
    directories.push(root);
  }
  return directories;
}

function main(): string[] {
  const top = tryGit(undefined, ["rev-parse", "--show-toplevel"])?.trim();
  if (top === undefined) throw new CannotRun("not in a git repository.");
  const policy = parsePolicy(readJson(join(top, "coverage-policy.json")));
  if (typeof policy === "string") throw new CannotRun(policy);

  const recordOf = (project: string): string =>
    join(top, project, "coverage", "coverage-final.json");
  const affectedRoots = affectedRecordRoots(top);
  if (affectedRoots === undefined) {
    throw new CannotRun(
      "nx could not say which projects are affected, so the records cannot be told from stale ones. Run `pnpm exec nx show projects --affected --with-target test` to see why.",
    );
  }
  const recorded = candidates(top).filter((project) => existsSync(recordOf(project)));
  const { projects, stale } = scopeOf(recorded, affectedRoots);
  if (stale.length > 0) {
    process.stdout.write(
      `merged-coverage: ignored the records of ${stale.length} project(s) that are not affected (left by an earlier run): ${stale.join(", ")}.\n`,
    );
  }
  if (projects.length === 0) {
    if (affectedRoots.length === 0) {
      process.stdout.write(
        "merged-coverage: no affected project of apps/* or packages/* has a test target; nothing to check.\n",
      );
      return [];
    }
    throw new CannotRun(
      `no coverage-final.json under apps/*/coverage or packages/*/coverage for the affected projects (${affectedRoots.join(", ")}). Run \`pnpm exec nx affected -t test\` first.`,
    );
  }

  const coverage = new Map<string, FileCoverage>();
  for (const project of projects) {
    const record = readJson(recordOf(project));
    if (!isObject(record)) throw new CannotRun(`${project}: the record is not an object.`);
    for (const [absolute, value] of Object.entries(record)) {
      const path = relative(top, absolute).replaceAll("\\", "/");
      if (!isMeasured(path)) continue;
      const file = parseFileCoverage(value);
      if (file === undefined) {
        throw new CannotRun(`${project}: the record of ${path} is not in Istanbul's format.`);
      }
      addFile(coverage, path, file);
    }
  }

  const listing = tryGit(top, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (listing === undefined) throw new CannotRun("git ls-files failed.");
  const tracked = listing.split("\0").filter((path) => path !== "");

  const failures = violations({ policy, tracked, projects, coverage });
  process.stdout.write(
    `merged-coverage: ${coverage.size} files from the records of ${projects.length} projects.\n`,
  );
  return failures;
}

const annotate = process.env.GITHUB_ACTIONS === "true";
const print = (lines: string[]): void => {
  process.stderr.write(
    `${lines.map((line) => (annotate ? `::error::${line}` : line)).join("\n")}\n`,
  );
};

try {
  const failures = main();
  if (failures.length > 0) {
    print([...failures, `merged-coverage: ${failures.length} problem(s).`]);
    process.exitCode = 1;
  }
} catch (error) {
  if (!(error instanceof CannotRun)) throw error;
  print([`merged-coverage: ${error.message}`]);
  process.exitCode = 2;
}
