// SAST with the pinned Semgrep CE (docs/adr/0021). Fails only on ERROR findings that the base does not have:
// the findings that this branch adds. Findings already on the base are left to the code scanning alerts (CodeQL).
//   node tools/scripts/src/checks/semgrep/cli.ts
// The comparison starts at the merge base of HEAD and the base (rules.ts). The Registry rules are fetched on
// every run, so the check needs the network.
// Silence a finding with `nosemgrep: <rule-id>` followed by the reason, on the line of the finding.
//   exit 0  no new ERROR finding
//   exit 1  a new finding
//   exit 2 or more  the scan could not run (no mise, no base, no network, a Semgrep error: Semgrep's code)
// Run by the pre-push hook (which stops only on exit 1, so being offline does not block a push) and by CI
// (which fails on both). The rules are in rules.ts; this file runs git and Semgrep.
import { execFileSync, spawnSync } from "node:child_process";
import { baseRef, semgrep } from "./rules.ts";

function cannotScan(message: string): number {
  process.stderr.write(`semgrep: ${message}\n`);
  return 2;
}

function main(): number {
  if (spawnSync("mise", ["--version"], { stdio: "ignore" }).error !== undefined) {
    return cannotScan(
      'mise is not installed, so the code cannot be scanned. See docs/local-env-setup/setup.md ("Ubuntu の初期セットアップ").',
    );
  }
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const git = (args: readonly string[]) =>
    spawnSync("git", args, { cwd: top, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const base = baseRef(process.env);
  if (git(["rev-parse", "-q", "--verify", `${base}^{commit}`]).status !== 0) {
    return cannotScan(
      `${base} does not exist here, so new findings cannot be told apart. Run \`git fetch origin\`.`,
    );
  }
  const mergeBase = git(["merge-base", base, "HEAD"]);
  if (mergeBase.status !== 0) {
    return cannotScan(
      `HEAD shares no history with ${base} (a shallow clone?). Run \`git fetch --unshallow\`.`,
    );
  }
  const run = spawnSync("mise", semgrep(mergeBase.stdout.trim(), process.env), {
    cwd: top,
    stdio: "inherit",
  });
  return run.status ?? 2;
}

process.exitCode = main();
