// Add up the coverage records of the projects and check each measured file against the minimum of coverage-policy.json
// (#567, docs/tooling/ci.md ("coverage の下限")). Run from the repository root after `nx affected -t test` (CI), or by hand:
//   node tools/scripts/src/checks/merged-coverage/cli.ts
// A project is in scope when it wrote coverage/coverage-final.json, so only the affected projects count in CI. Exit codes:
// 0 passes (also when no affected project runs tests, so there is no record), 1 a file is under the minimum or an
// exception is wrong, 2 the check could not run (no record although tests were affected, bad policy).
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
  violations,
  type FileCoverage,
} from "./rules.ts";

class CannotRun extends Error {}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

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

// The projects that nx would run `test` for in this change and that can write a record (the directories of
// candidates()), or undefined when nx cannot say. A change that touches none of them (docs only, or tools/scripts
// alone, whose coverage is not a record of this check) has none: `nx affected -t test` then writes no record, and that
// is not a failure.
function affectedRecordProjects(top: string): string[] | undefined {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "nx",
      "show",
      "projects",
      "--affected",
      "--with-target",
      "test",
      ...["apps/*", "packages/*", "packages/*/events"].flatMap((glob) => ["--projects", glob]),
    ],
    { cwd: top, encoding: "utf8" },
  );
  if (result.status !== 0) return undefined;
  return result.stdout.split("\n").filter((line) => line.trim() !== "");
}

function main(): string[] {
  const top = tryGit(undefined, ["rev-parse", "--show-toplevel"])?.trim();
  if (top === undefined) throw new CannotRun("not in a git repository.");
  const policy = parsePolicy(readJson(join(top, "coverage-policy.json")));
  if (typeof policy === "string") throw new CannotRun(policy);

  const recordOf = (project: string): string =>
    join(top, project, "coverage", "coverage-final.json");
  const projects = candidates(top).filter((project) => existsSync(recordOf(project)));
  if (projects.length === 0) {
    if (affectedRecordProjects(top)?.length === 0) {
      process.stdout.write(
        "merged-coverage: no affected project of apps/* or packages/* has a test target; nothing to check.\n",
      );
      return [];
    }
    throw new CannotRun(
      "no coverage-final.json under apps/*/coverage or packages/*/coverage. Run `pnpm exec nx affected -t test` first.",
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
