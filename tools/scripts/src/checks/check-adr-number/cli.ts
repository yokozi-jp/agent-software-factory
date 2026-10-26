// Before a PR: is each ADR number this branch adds still free? Prints the next free number.
//   node tools/scripts/src/checks/check-adr-number/cli.ts
// Numbers are taken by origin/main and by the other open PRs (gh). Run `git fetch origin` first.
// check-repo-policy.sh only sees the numbers in one tree, so two open PRs can pick the same number
// (docs/tooling/worktrees.md ("PR を出す")).
//   exit 0  every ADR the branch adds has a free number
//   exit 1  an added ADR uses a number that origin/main or another open PR uses
//   exit 2  the open PRs could not be read (gh failed), or this is not a git repository, so nothing
//           was checked
// Without origin/main (no fetch), git says why and the check carries on with the numbers of the open PRs.
// The rules are in rules.ts; this file runs gh and git, and prints.
import { execFileSync } from "node:child_process";
import { checkNumbers, ghFailed, parsePrs, type OpenPr, type Output } from "./rules.ts";

const git = (cwd: string | undefined, args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const lines = (text: string): string[] => text.split("\n").filter((line) => line !== "");

// The files under docs/adr/ on origin/main; none when git cannot read origin/main (git says why on stderr).
function mainFiles(top: string): string[] {
  try {
    return lines(git(top, ["ls-tree", "--name-only", "origin/main", "docs/adr/"]));
  } catch {
    return [];
  }
}

// gh sometimes fails with a dropped connection (EOF); try again before giving up.
function openPrs(): OpenPr[] | undefined {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const prs = parsePrs(
        execFileSync(
          "gh",
          ["pr", "list", "--state", "open", "--limit", "200", "--json", "number,headRefName,files"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        ),
      );
      if (prs !== undefined) return prs;
    } catch {
      // Tried again below.
    }
    if (attempt < 3) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  return undefined;
}

function main(): Output {
  const top = git(undefined, ["rev-parse", "--show-toplevel"]).trim();
  const branch = git(top, ["branch", "--show-current"]).trim();
  const prs = openPrs();
  if (prs === undefined) return ghFailed;
  return checkNumbers({
    branch,
    main: mainFiles(top),
    prs,
    branchFiles: [
      ...lines(git(top, ["ls-files", "--", "docs/adr/"])),
      ...lines(git(top, ["ls-files", "--others", "--exclude-standard", "--", "docs/adr/"])),
    ],
  });
}

let output: Output;
try {
  output = main();
} catch (error) {
  // git failed (not a repository): git has said why on stderr.
  output = {
    status: 2,
    stdout: "",
    stderr: `check-adr-number: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}\n`,
  };
}
process.stdout.write(output.stdout);
process.stderr.write(output.stderr);
process.exitCode = output.status;
