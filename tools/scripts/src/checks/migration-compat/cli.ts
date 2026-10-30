// The migration compatibility test (docs/adr/0037): runs the integration tests of the base, the version to roll back
// to, against a database that has the pull request's migrations applied.
//   node tools/scripts/src/checks/migration-compat/cli.ts
// The base is the merge base of HEAD and origin/$GITHUB_BASE_REF (origin/main when unset). The base is checked out in a
// git worktree, `pnpm install --frozen-lockfile` runs there, and `vp test run --project integration` (without coverage)
// runs in apps/api with MIGRATION_COMPAT_FILES naming the added migration files. The worktree is removed at the end.
//   exit 0  the tests passed, or there is nothing to test (no migration added, or the base cannot apply them yet)
//   exit 1  a migration of the base was changed or deleted, or the tests failed
//   exit 2  the base could not be found or a command could not run
// The rules are in rules.ts; this file runs git, pnpm and vp, and prints.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tryGit } from "../git.ts";
import {
  classifyMigrations,
  decide,
  harnessEntry,
  harnessMarker,
  migrationsDirectory,
  report,
  seedEntry,
} from "./rules.ts";

const env = process.env;

function fail(message: string): number {
  process.stderr.write(`migration-compat: ${message}\n`);
  return 2;
}

// Runs a command with its output on ours; the exit status, or undefined when it could not start.
function run(
  command: string,
  args: readonly string[],
  cwd: string,
  extra = {},
): number | undefined {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...env, ...extra },
  });
  return result.status ?? undefined;
}

function main(): number {
  const top = tryGit(undefined, ["rev-parse", "--show-toplevel"])?.trim();
  if (top === undefined) return fail("not a git repository.");
  const ref = `origin/${env.GITHUB_BASE_REF || "main"}`;
  const base = tryGit(top, ["merge-base", ref, "HEAD"])?.trim();
  if (base === undefined)
    return fail(
      `could not find the merge base of ${ref} and HEAD. Fetch the history (fetch-depth: 0).`,
    );

  const diff = tryGit(top, [
    "-c",
    "core.quotePath=false",
    "diff",
    "--name-status",
    "--no-renames",
    `${base}..HEAD`,
    "--",
    migrationsDirectory,
  ]);
  if (diff === undefined) return fail(`git diff from ${base} failed.`);

  const decision = decide(classifyMigrations(diff), {
    hasSeed: tryGit(top, ["cat-file", "-e", `${base}:${seedEntry}`]) !== undefined,
    hasHarness: tryGit(top, ["show", `${base}:${harnessEntry}`])?.includes(harnessMarker) === true,
  });
  if (decision.kind !== "run") {
    const { stdout, stderr } = report(decision, env);
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    return decision.kind === "fail" ? 1 : 0;
  }

  const worktree = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), "migration-compat-"));
  try {
    if (tryGit(top, ["worktree", "add", "--detach", worktree, base]) === undefined)
      return fail(`could not check out ${base} in ${worktree}.`);
    const files = decision.files.map((file) => join(top, file));
    const installed = run("pnpm", ["install", "--frozen-lockfile"], worktree);
    if (installed !== 0)
      return fail(`pnpm install in the base worktree failed (${installed ?? "killed"}).`);
    const tested = run(
      "vp",
      ["test", "run", "--project", "integration"],
      join(worktree, "apps/api"),
      {
        MIGRATION_COMPAT_FILES: JSON.stringify(files),
      },
    );
    if (tested === undefined) return fail("could not run vp.");
    if (tested !== 0)
      process.stderr.write(
        `migration-compat: the integration tests of ${base} failed on the database with the pull request's migrations. The version to roll back to would not work with them (docs/adr/0037).\n`,
      );
    return tested === 0 ? 0 : 1;
  } finally {
    tryGit(top, ["worktree", "remove", "--force", worktree]);
    rmSync(worktree, { recursive: true, force: true });
    tryGit(top, ["worktree", "prune"]);
  }
}

try {
  process.exitCode = main();
} catch (error) {
  process.exitCode = fail(error instanceof Error ? error.message : String(error));
}
