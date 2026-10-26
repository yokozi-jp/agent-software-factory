// Checks the open issues and the wayfinder maps of this repository (docs/agents/issue-tracker.md ("検査")).
//   node tools/scripts/src/checks/issue-tracker/cli.ts
// Runs weekly in .github/workflows/issue-tracker.yml, and by hand before taking an issue. Needs gh, and the
// full git history (the removed paths come from it).
//   exit 0  no problems
//   exit 1  an open issue names a removed path, a decision ticket was closed without its implementation
//           issue, or a "Blocked by:" line has no native edge
//   exit 2  gh could not read the issues, or the clone is shallow, so nothing was checked
// The rules are in rules.ts; this file runs gh and git, and prints.
import { execFileSync } from "node:child_process";
import {
  blockersInBody,
  edgeProblems,
  ghFailed,
  implementationProblems,
  parseChildren,
  parseIssues,
  parseNumbers,
  parseStrings,
  pathProblems,
  report,
  shallow,
  stalePaths,
  ticketsToRead,
  withDirectories,
  type Output,
} from "./rules.ts";

// Decision tickets of map #23 closed before its Notes asked for the implementation issue (2026-10-24).
// Their decisions were carried out by issues that the map does not link; they are not checked.
const closedBeforeTheRule = new Set([25, 26, 30, 39, 40, 41, 42, 44, 45, 95, 127]);

class GhError extends Error {}

const git = (args: readonly string[]): string =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const lines = (text: string): string[] => text.split("\n").filter((line) => line !== "");

// gh sometimes fails with a dropped connection (EOF); try again before giving up.
function gh<T>(what: string, args: readonly string[], parse: (out: string) => T | undefined): T {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const value = parse(
        execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
      );
      if (value !== undefined) return value;
    } catch {
      // Tried again below.
    }
    if (attempt < 3) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  throw new GhError(what);
}

function main(): Output {
  if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") return shallow;
  const repository = gh(
    "the repository",
    ["repo", "view", "--json", "nameWithOwner", "--jq", "[.nameWithOwner]"],
    parseStrings,
  )[0];
  const paths = {
    existing: withDirectories(lines(git(["ls-files"]))),
    removed: withDirectories(
      lines(git(["log", "--no-renames", "--diff-filter=D", "--name-only", "--format=", "HEAD"])),
    ),
  };
  const issues = gh(
    "the open issues",
    ["issue", "list", "--state", "open", "--limit", "1000", "--json", "number,title,body"],
    parseIssues,
  );
  const problems: string[] = [];
  for (const issue of issues) {
    problems.push(...pathProblems(issue, stalePaths(issue.body, paths)));
    const inBody = blockersInBody(issue.body, String(repository));
    if (inBody.length === 0) continue;
    const native = gh(
      `the blockers of #${issue.number}`,
      [
        "api",
        "--paginate",
        `repos/{owner}/{repo}/issues/${issue.number}/dependencies/blocked_by`,
        "--jq",
        "[.[].number]",
      ],
      parseNumbers,
    );
    problems.push(...edgeProblems(issue, inBody, native));
  }
  const maps = gh(
    "the maps",
    ["issue", "list", "--state", "all", "--label", "wayfinder:map", "--json", "number,title,body"],
    parseIssues,
  );
  for (const map of maps) {
    const children = gh(
      `the tickets of map #${map.number}`,
      [
        "api",
        "--paginate",
        `repos/{owner}/{repo}/issues/${map.number}/sub_issues`,
        "--jq",
        ".[] | {number, title, state, state_reason, labels: [.labels[].name]}",
      ],
      parseChildren,
    );
    const tickets = ticketsToRead(map.body, children, closedBeforeTheRule);
    const comments = new Map(
      tickets.map((ticket) => [
        ticket.number,
        gh(
          `the comments of #${ticket.number}`,
          [
            "issue",
            "view",
            String(ticket.number),
            "--json",
            "comments",
            "--jq",
            "[.comments[].body]",
          ],
          parseStrings,
        ),
      ]),
    );
    problems.push(...implementationProblems(map.number, tickets, comments));
  }
  return report(problems);
}

let output: Output;
try {
  output = main();
} catch (error) {
  // gh failed after its retries, or git failed (not a repository): git has said why on stderr.
  output =
    error instanceof GhError
      ? ghFailed(error.message)
      : {
          status: 2,
          stdout: "",
          stderr: `issue-tracker: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}\n`,
        };
}
process.stdout.write(output.stdout);
process.stderr.write(output.stderr);
process.exitCode = output.status;
