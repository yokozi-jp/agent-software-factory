// Secret scan: run the pinned betterleaks with the repo's fixed flags over one scan target
// (docs/tooling/secret-scan.md). Callers choose only what to scan; the targets are in `usage` (rules.ts).
// betterleaks runs through `mise exec`, so the version is the one pinned in mise.toml and mise.lock
// (docs/adr/0009). Fails (instead of silently skipping) when mise is missing, so nobody commits unscanned.
// Prints how many commits or files each scan covers, so an empty scan is visible instead of passing silently.
//   exit 0  no secret found (or nothing to scan)
//   exit 1  betterleaks found a secret, mise is missing, or a pushed ref cannot be compared
//   exit 2  usage error
// The rules are in rules.ts; this file reads argv and stdin, runs git and betterleaks, and prints.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { betterleaks, parseTarget, pushedRefs, usage } from "./rules.ts";

const say = (line: string): void => {
  process.stdout.write(`secret-scan: ${line}\n`);
};

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
  // The only place betterleaks runs. Its findings go straight to the terminal.
  const run = (mode: "git" | "dir", options: readonly string[]): number =>
    spawnSync("mise", betterleaks(mode, options), { cwd: top, stdio: "inherit" }).status ?? 1;
  // The commits that rev-list selects with revs ("base..head", "sha --not --remotes").
  const scanCommits = (label: string, revs: readonly string[]): number => {
    const count = Number(git(["rev-list", "--count", ...revs]));
    if (count === 0) {
      say(`${label}: 0 commits, skipped (nothing new to scan)`);
      return 0;
    }
    say(`${label}: scanning ${count} commit(s) (${revs.join(" ")})`);
    return run("git", [`--log-opts=${revs.join(" ")}`]);
  };

  switch (target.name) {
    case "staged": {
      const count = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean).length;
      if (count === 0) {
        say("staged: 0 files, skipped (nothing staged)");
        return 0;
      }
      say(`staged: scanning ${count} file(s)`);
      return run("git", ["--staged"]);
    }
    case "pre-push": {
      let status = 0;
      for (const ref of refs) {
        if (ref.kind === "deleted") {
          say(`${ref.remoteRef}: branch deletion, nothing to scan`);
        } else if (
          ref.remote !== undefined &&
          spawnSync("git", ["cat-file", "-e", `${ref.remote}^{commit}`], { cwd: top }).status !== 0
        ) {
          process.stderr.write(
            `secret-scan: ${ref.remoteRef} is at ${ref.remote}, which is not in this clone.\n` +
              "Run `git fetch` and push again, so the scan can tell which commits are new.\n",
          );
          status = 1;
        } else if (scanCommits(ref.label, ref.revs) !== 0) {
          status = 1;
        }
      }
      return status;
    }
    case "range":
      return scanCommits("range", [`${target.base}..${target.head}`]);
    case "all":
      say(`all: scanning ${git(["rev-list", "--count", "--all"])} commit(s) (full history)`);
      return run("git", []);
    case "worktree":
      say("worktree: scanning working tree files");
      return run("dir", []);
  }
}

process.exitCode = main();
