// Warn when a change deletes test files or declares fewer test cases in one (#138). Never fails, like adr-check
// (docs/adr/0016): a reviewer reads the pull request instead.
//   node tools/scripts/src/checks/test-weakening/cli.ts            compare HEAD with the base (CI, and by hand)
//   node tools/scripts/src/checks/test-weakening/cli.ts pre-push   compare each commit being pushed with the base
//                                                                  (pre-push hook; reads the refs from stdin)
// The base is origin/$GITHUB_BASE_REF in a pull request, and origin/main elsewhere. The diff runs from the merge base.
// TESTS_ACK=1 silences the warning for an intended change. In GitHub Actions the warning is a ::warning:: annotation.
// If the base cannot be compared (a shallow clone, or no fetch), it says why and passes.
// The rules are in rules.ts; this file reads argv, stdin, the environment and git, and prints.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pushedTips, type Output } from "../adr-check/rules.ts";
import { finding, findingLines, skipped, testChanges, warning, type Finding } from "./rules.ts";

const env = process.env;

function print({ stdout, stderr }: Output): void {
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}

// git <args> in <cwd>; undefined when git fails.
function git(cwd: string | undefined, args: readonly string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return undefined;
  }
}

function main(): Output | undefined {
  // Read stdin before anything returns: git waits for a pre-push hook to read it.
  const tips = process.argv[2] === "pre-push" ? pushedTips(readFileSync(0, "utf8")) : ["HEAD"];
  if (env.TESTS_ACK === "1") return undefined;
  // A push that only deletes refs has no commit to compare.
  if (tips.length === 0) return undefined;
  const top = git(undefined, ["rev-parse", "--show-toplevel"])?.trim();
  if (top === undefined) return undefined;

  const base = `origin/${env.GITHUB_BASE_REF || "main"}`;
  if (git(top, ["rev-parse", "-q", "--verify", `${base}^{commit}`]) === undefined) {
    return skipped(
      `${base} does not exist here, so there is nothing to compare with. Run \`git fetch origin\`.`,
      env,
    );
  }
  const findings: Finding[] = [];
  let compared = 0;
  for (const tip of tips) {
    const commit = git(top, ["rev-parse", "-q", "--verify", `${tip}^{commit}`])?.trim();
    if (commit === undefined) continue;
    const mergeBase = git(top, ["merge-base", base, commit])?.trim();
    if (mergeBase === undefined) continue;
    const diff = git(top, [
      "-c",
      "core.quotePath=false",
      "diff",
      "--name-status",
      "--find-renames",
      mergeBase,
      commit,
    ]);
    if (diff === undefined) continue;
    compared += 1;
    for (const change of testChanges(diff)) {
      const show = (rev: string, path: string): string =>
        git(top, ["show", `${rev}:${path}`]) ?? "";
      const before = change.to === undefined ? "" : show(mergeBase, change.from);
      const after = change.to === undefined ? "" : show(commit, change.to);
      const found = finding(change, before, after);
      if (found !== undefined) findings.push(found);
    }
  }
  if (compared === 0) {
    return skipped(
      `Could not compare ${base} with the commits (a shallow clone has no shared history). Run \`git fetch --unshallow\`, or fetch more history.`,
      env,
    );
  }
  const found = findingLines(findings);
  return found.length === 0 ? undefined : warning(found, env);
}

try {
  const output = main();
  if (output !== undefined) print(output);
} catch (error) {
  // Warn-only (docs/adr/0016): an unexpected error is reported, never a failure.
  print(
    skipped(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`, env),
  );
}
