// Process tests for the check-adr-number entry point: a real git repository in the sandbox, and a stub gh
// on PATH that prints the open PRs (no network). Which numbers are taken and the messages are in rules.test.ts.
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");
// Built from parts, so that the repo-policy check of docs/ references does not read these made-up ADRs.
const adr = (name: string): string => `docs/adr/${name}.md`;

let box: Sandbox;
let repo: string;
let bin: string;
let prsFile: string;
let failuresFile: string;

const git = (...args: string[]): string => gitIn(repo, args).trim();
const prs = (json: unknown[]): void => writeFileSync(prsFile, JSON.stringify(json));
// The stub gh fails this many more times before it answers, like a dropped connection.
const failNext = (times: number): void => writeFileSync(failuresFile, "x".repeat(times));
const check = () =>
  runIn(repo, process.execPath, [cli], { env: { PATH: `${bin}:${process.env.PATH}` } });

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  bin = join(box.root, "bin");
  prsFile = join(box.root, "prs.json");
  failuresFile = join(box.root, "failures");
  mkdirSync(bin);
  // Prints prs.json for exactly the gh call that cli.ts makes; fails like a dropped connection otherwise.
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/bin/sh",
      `[ "$*" = "pr list --state open --limit 200 --json number,headRefName,files" ] || exit 9`,
      `failures="$(cat '${failuresFile}' 2>/dev/null)"`,
      `if [ -n "$failures" ] || [ ! -f '${prsFile}' ]; then`,
      `  printf '%s' "\${failures#x}" >'${failuresFile}'`,
      `  echo 'Post "https://api.github.com/graphql": EOF' >&2`,
      "  exit 1",
      "fi",
      `cat '${prsFile}'`,
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "gh"), 0o755);
  gitIn(repo, ["init", "-q", "-b", "main"]);
  mkdirSync(join(repo, "docs/adr"), { recursive: true });
  writeFileSync(join(repo, adr("0001-a")), "a\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("switch", "-qc", "docs/mine");
});
afterAll(() => {
  box.remove();
});

describe("check-adr-number", () => {
  it("passes and prints the next number when the branch adds no ADR", () => {
    prs([]);
    expect(check()).toEqual({ status: 0, stdout: "next free ADR number: 0002\n", stderr: "" });
  });

  it("counts an untracked ADR, and fails when another open PR uses its number", () => {
    writeFileSync(join(repo, adr("0002-mine")), "b\n");
    expect(check()).toMatchObject({ status: 0, stdout: "next free ADR number: 0003\n" });
    prs([{ number: 7, headRefName: "docs/other", files: [{ path: adr("0002-other") }] }]);
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ADR 0002 is also used by PR #7.");
  });

  it("ignores this branch's own PR, and counts a staged rename before it is committed", () => {
    git("add", "-A");
    git("commit", "-qm", "mine");
    prs([{ number: 8, headRefName: "docs/mine", files: [{ path: adr("0002-mine") }] }]);
    expect(check().status).toBe(0);
    prs([{ number: 7, headRefName: "docs/other", files: [{ path: adr("0002-other") }] }]);
    expect(check().status).toBe(1);
    git("mv", adr("0002-mine"), adr("0003-mine"));
    expect(check()).toEqual({ status: 0, stdout: "next free ADR number: 0004\n", stderr: "" });
    git("commit", "-qm", "renumber");
  });

  it("fails when origin/main has the number", () => {
    prs([]);
    writeFileSync(join(repo, adr("0001-again")), "c\n");
    const result = check();
    rmSync(join(repo, adr("0001-again")));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ADR 0001 is also used by origin/main.");
  });

  it("asks gh again after a dropped connection", () => {
    prs([]);
    failNext(2);
    expect(check()).toMatchObject({ status: 0, stderr: "" });
  });

  it("exits 2 without checking when gh cannot list the PRs three times", () => {
    rmSync(prsFile);
    expect(check()).toEqual({
      status: 2,
      stdout: "",
      stderr:
        "check-adr-number: could not list the open PRs with gh. Check `gh auth status` and try again.\n",
    });
  });

  it("exits 2 without checking when origin/main does not exist", () => {
    prs([]);
    git("update-ref", "-d", "refs/remotes/origin/main");
    const result = check();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("check-adr-number: Command failed: git ls-tree");
  });
});
