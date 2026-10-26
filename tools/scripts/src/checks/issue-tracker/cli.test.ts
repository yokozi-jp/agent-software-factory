// Process tests for the issue-tracker entry point: a real git repository in the sandbox, and a stub gh on
// PATH that answers each call cli.ts makes from a file (no network). The rules and messages are in
// rules.test.ts.
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");
const url = (number: number): string => `https://github.com/owner/name/issues/${number}`;

let box: Sandbox;
let repo: string;
let bin: string;
let answers: string;

const git = (...args: string[]): string => gitIn(repo, args).trim();
const key = (args: readonly string[]): string =>
  createHash("sha256").update(args.join(" ")).digest("hex").slice(0, 16);
// What the stub gh prints for `gh <args>`. Without an answer, it fails like a dropped connection.
const answer = (args: readonly string[], output: unknown): void =>
  writeFileSync(
    join(answers, key(args)),
    typeof output === "string" ? output : JSON.stringify(output),
  );
const forget = (args: readonly string[]): void => rmSync(join(answers, key(args)), { force: true });

const repoView = ["repo", "view", "--json", "nameWithOwner", "--jq", "[.nameWithOwner]"];
const openIssues = [
  "issue",
  "list",
  "--state",
  "open",
  "--limit",
  "1000",
  "--json",
  "number,title,body",
];
const maps = [
  "issue",
  "list",
  "--state",
  "all",
  "--label",
  "wayfinder:map",
  "--json",
  "number,title,body",
];
const blockers = (number: number): string[] => [
  "api",
  "--paginate",
  `repos/{owner}/{repo}/issues/${number}/dependencies/blocked_by`,
  "--jq",
  "[.[].number]",
];
const tickets = (map: number): string[] => [
  "api",
  "--paginate",
  `repos/{owner}/{repo}/issues/${map}/sub_issues`,
  "--jq",
  ".[] | {number, title, state, state_reason, labels: [.labels[].name]}",
];
const comments = (number: number): string[] => [
  "issue",
  "view",
  String(number),
  "--json",
  "comments",
  "--jq",
  "[.comments[].body]",
];

const checkIn = (dir: string) =>
  runIn(dir, process.execPath, [cli], { env: { PATH: `${bin}:${process.env.PATH}` } });
const check = () => checkIn(repo);

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  bin = join(box.root, "bin");
  answers = join(box.root, "answers");
  mkdirSync(bin);
  mkdirSync(answers);
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/bin/sh",
      `file='${answers}/'"$(printf '%s' "$*" | sha256sum | cut -c1-16)"`,
      `[ -f "$file" ] && exec cat "$file"`,
      `echo 'Post "https://api.github.com/graphql": EOF' >&2`,
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "gh"), 0o755);
  gitIn(repo, ["init", "-q", "-b", "main"]);
  mkdirSync(join(repo, "scripts"));
  writeFileSync(join(repo, "scripts/check.sh"), "a\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  mkdirSync(join(repo, "tools"));
  git("mv", "scripts/check.sh", "tools/check.ts");
  git("commit", "-qm", "move");
  answer(repoView, ["owner/name"]);
  answer(maps, []);
});
afterAll(() => {
  box.remove();
});

describe("issue-tracker", () => {
  it("passes when no issue names a removed path or a missing edge", () => {
    answer(openIssues, [{ number: 1, title: "T", body: "Edit `tools/check.ts`." }]);
    expect(check()).toEqual({ status: 0, stdout: "issue-tracker: no problems\n", stderr: "" });
  });

  it("reports a path that a commit removed, though git recorded the move as a rename", () => {
    answer(openIssues, [{ number: 1, title: "T", body: "Edit `scripts/check.sh`." }]);
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "#1 「T」: `scripts/check.sh` was removed from the repository.",
    );
  });

  it("reports a Blocked by: line without a native edge", () => {
    answer(openIssues, [{ number: 2, title: "U", body: `Blocked by: [A](${url(5)})、#6` }]);
    answer(blockers(2), [6]);
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      `issue-tracker: #2 「U」: "Blocked by:" names #5, but GitHub has no native edge. Add it (docs/agents/issue-tracker.md ("Wayfinding operations")).\n`,
    );
  });

  it("reports a decision ticket closed without its implementation issue, after reading its comments", () => {
    answer(openIssues, []);
    answer(maps, [
      {
        number: 23,
        title: "Map",
        body: `## Decisions so far\n- [A](${url(30)}): done\n- [B](${url(31)}): done`,
      },
    ]);
    answer(
      tickets(23),
      [
        {
          number: 30,
          title: "A",
          state: "closed",
          state_reason: "completed",
          labels: ["wayfinder:grilling"],
        },
        {
          number: 31,
          title: "B",
          state: "closed",
          state_reason: "completed",
          labels: ["wayfinder:grilling"],
        },
        {
          number: 25,
          title: "Old",
          state: "closed",
          state_reason: "completed",
          labels: ["wayfinder:grilling"],
        },
      ]
        .map((ticket) => JSON.stringify(ticket))
        .join("\n"),
    );
    answer(comments(30), ["実施の Issue は作らない"]);
    answer(comments(31), ["decided"]);
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /^issue-tracker: #31 「B」 \(map #23\): closed without its implementation issue\./,
    );
    expect(result.stderr.split("\n")).toHaveLength(2);
    answer(maps, []);
  });

  it("asks gh again after a dropped connection, and exits 2 when it never answers", () => {
    answer(openIssues, []);
    forget(repoView);
    expect(check()).toEqual({
      status: 2,
      stdout: "",
      stderr:
        "issue-tracker: could not read the repository with gh. Check `gh auth status` and try again.\n",
    });
    answer(repoView, ["owner/name"]);
  });

  it("exits 2 in a shallow clone, whose history does not show the removed paths", () => {
    const clone = join(box.root, "shallow");
    mkdirSync(clone);
    gitIn(clone, ["clone", "-q", "--depth", "1", `file://${repo}`, "."]);
    const result = checkIn(clone);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("the clone is shallow");
  });

  it("exits 2 outside a git repository, after git says why", () => {
    const outside = join(box.root, "outside");
    mkdirSync(outside);
    const result = checkIn(outside);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/fatal: not a git repository/);
    expect(result.stderr).toMatch(
      /issue-tracker: Command failed: git rev-parse --is-shallow-repository\n$/,
    );
  });
});
