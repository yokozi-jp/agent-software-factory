// Secret scan: run the pinned betterleaks with the repo's fixed flags over one scan target
// (docs/tooling/secret-scan.md). Callers choose only what to scan; the targets are in `usage` (rules.ts).
// betterleaks runs through `mise exec`, so the version is the one pinned in mise.toml and mise.lock
// (docs/adr/0009). Fails (instead of silently skipping) when mise is missing, so nobody commits unscanned.
// Prints how many commits or files each scan covers, so an empty scan is visible instead of passing silently.
//   exit 0  no secret found (or nothing to scan)
//   exit 1  betterleaks found a secret, mise is missing, or a pushed ref cannot be compared
//   exit 2  usage error
//   exit 128 or more  git failed (not a repository, a bad revision in range): git's code
// The rules are in rules.ts; this file reads argv, stdin and git, runs betterleaks, and prints.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  betterleaks,
  exitStatus,
  gitFailed,
  parseTarget,
  plan,
  pushedRefs,
  usage,
} from "./rules.ts";

function main(): number {
  const target = parseTarget(process.argv.slice(2));
  if (target === undefined) {
    process.stderr.write(usage);
    return 2;
  }
  // Read stdin before anything returns: git waits for a pre-push hook to read it.
  const refs = target.name === "pre-push" ? pushedRefs(readFileSync(0, "utf8")) : [];
  if (spawnSync("mise", ["--version"], { stdio: "ignore" }).error !== undefined) {
    process.stderr.write(
      'secret-scan: mise is not installed, so the secret scan cannot run. See docs/local-env-setup/setup.md ("Ubuntu の初期セットアップ").\n',
    );
    return 1;
  }
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const git = (args: readonly string[]): string =>
    execFileSync("git", args, { cwd: top, encoding: "utf8" }).trim();
  const steps = plan(target, refs, {
    hasCommit: (sha) =>
      spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: top }).status === 0,
    countCommits: (revs) => Number(git(["rev-list", "--count", ...revs])),
    countStaged: () => git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean).length,
  });
  const statuses = steps.map((step) => {
    process.stdout.write(step.stdout);
    if (step.kind === "report") {
      process.stderr.write(step.stderr);
      return step.status;
    }
    // The only place betterleaks runs. Its findings go straight to the terminal.
    return spawnSync("mise", betterleaks(step.mode, step.options), { cwd: top, stdio: "inherit" })
      .status;
  });
  return exitStatus(target, statuses);
}

try {
  process.exitCode = main();
} catch (error) {
  // git failed: git has said why on stderr.
  const status = error instanceof Error && "status" in error ? error.status : undefined;
  process.stderr.write(
    `secret-scan: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}\n`,
  );
  process.exitCode = gitFailed(typeof status === "number" ? status : undefined);
}
