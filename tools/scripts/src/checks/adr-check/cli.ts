// Warn when a change touches files that tend to carry a decision but adds no ADR (docs/adr/0016). Never fails.
//   node tools/scripts/src/checks/adr-check/cli.ts            compare HEAD with the base (CI, and by hand)
//   node tools/scripts/src/checks/adr-check/cli.ts pre-push   compare each commit being pushed with the base
//                                                             (pre-push hook; reads the refs from stdin)
// The base is origin/$GITHUB_BASE_REF in a pull request, and origin/main elsewhere. The diff runs from the merge base.
// ADR_ACK=1 silences the warning for a change that needs no ADR. In GitHub Actions the warning is a ::warning:: annotation.
// If the base cannot be compared (a shallow clone, or no fetch), it says why and passes.
// The rules are in rules.ts; this file reads argv, stdin, the environment and git, and prints.
import { readFileSync } from "node:fs";
import { tryGit } from "../git.ts";
import type { Output } from "../output.ts";
import { pushedTips } from "../pre-push.ts";
import { skipped, warnedPaths, warning } from "./rules.ts";

const env = process.env;

function print({ stdout, stderr }: Output): void {
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}

function main(): Output | undefined {
  // Read stdin before anything returns: git waits for a pre-push hook to read it.
  const tips = process.argv[2] === "pre-push" ? pushedTips(readFileSync(0, "utf8")) : ["HEAD"];
  if (env.ADR_ACK === "1") return undefined;
  // A push that only deletes refs has no commit to compare.
  if (tips.length === 0) return undefined;
  const top = tryGit(undefined, ["rev-parse", "--show-toplevel"])?.trim();
  if (top === undefined) return undefined;

  const base = `origin/${env.GITHUB_BASE_REF || "main"}`;
  if (tryGit(top, ["rev-parse", "-q", "--verify", `${base}^{commit}`]) === undefined) {
    return skipped(
      `${base} does not exist here, so there is nothing to compare with. Run \`git fetch origin\`.`,
      env,
    );
  }
  const diffs: string[] = [];
  for (const tip of tips) {
    const commit = tryGit(top, ["rev-parse", "-q", "--verify", `${tip}^{commit}`])?.trim();
    if (commit === undefined || tryGit(top, ["merge-base", base, commit]) === undefined) continue;
    const diff = tryGit(top, [
      "-c",
      "core.quotePath=false",
      "diff",
      "--name-status",
      "--no-renames",
      `${base}...${commit}`,
    ]);
    if (diff !== undefined) diffs.push(diff);
  }
  if (diffs.length === 0) {
    return skipped(
      `Could not compare ${base} with the commits (a shallow clone has no shared history). Run \`git fetch --unshallow\`, or fetch more history.`,
      env,
    );
  }
  const paths = warnedPaths(diffs);
  return paths.length === 0 ? undefined : warning(paths, env);
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
