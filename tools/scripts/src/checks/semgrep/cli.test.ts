// Process tests for the Semgrep entry point: a real git repository in the sandbox and a stub mise on PATH,
// which records how Semgrep would run and exits with STUB_EXIT. What the real Semgrep reports is in
// cli.tools.test.ts.
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");
const fixed = "--severity ERROR --error --metrics off --disable-version-check --quiet";

let box: Sandbox;
let repo: string;
let bin: string;
let calls: string;
let mergeBase: string;

const git = (...args: string[]): string => gitIn(repo, args).trim();
const scan = (env: Record<string, string> = {}, dir = repo) =>
  runIn(dir, process.execPath, [cli], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_BASE_REF: "",
      SEMGREP_RULES: "",
      STUB_EXIT: "0",
      ...env,
    },
  });
// One line per Semgrep run: the directory it ran in, then the arguments of mise.
const recorded = (): string[] => {
  try {
    return readFileSync(calls, "utf8").split("\n").slice(0, -1);
  } catch {
    return [];
  }
};
const cannotScan = (message: string) => ({
  status: 2,
  stdout: "",
  stderr: `semgrep: ${message}\n`,
});

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  bin = join(box.root, "bin");
  calls = join(box.root, "calls");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "mise"),
    `#!/bin/sh\n[ "$1" = --version ] && exit 0\necho "$PWD $*" >>'${calls}'\nexit "$STUB_EXIT"\n`,
  );
  chmodSync(join(bin, "mise"), 0o755);
  gitIn(repo, ["init", "-q", "-b", "main"]);
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src/a.ts"), "a\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  mergeBase = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("switch", "-qc", "topic");
  git("commit", "-q", "--allow-empty", "-m", "topic");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("commit", "-q", "--allow-empty", "-m", "topic 2");
});
beforeEach(() => {
  rmSync(calls, { force: true });
});
afterAll(() => {
  box.remove();
});

describe("semgrep", () => {
  it("scans from the repository top against the merge base with origin/main, with the Registry rules", () => {
    const top = git("rev-parse", "origin/main");
    expect(scan({}, join(repo, "src"))).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(recorded()).toEqual([
      `${repo} exec -- semgrep scan --config p/typescript --config p/react --baseline-commit ${top} ${fixed}`,
    ]);
  });

  it("passes Semgrep's exit code on: 1 for a new finding, and others for a Semgrep error", () => {
    expect(scan({ STUB_EXIT: "1" }).status).toBe(1);
    expect(scan({ STUB_EXIT: "7" }).status).toBe(7);
  });

  it("compares with origin/$GITHUB_BASE_REF, and uses the rules in SEMGREP_RULES", () => {
    git("update-ref", "refs/remotes/origin/release", mergeBase);
    expect(scan({ GITHUB_BASE_REF: "release", SEMGREP_RULES: "/r.yml" }).status).toBe(0);
    expect(recorded()).toEqual([
      `${repo} exec -- semgrep scan --config /r.yml --baseline-commit ${mergeBase} ${fixed}`,
    ]);
  });

  it("exits 2 without scanning when the base does not exist", () => {
    expect(scan({ GITHUB_BASE_REF: "missing" })).toEqual(
      cannotScan(
        "origin/missing does not exist here, so new findings cannot be told apart. Run `git fetch origin`.",
      ),
    );
    expect(recorded()).toEqual([]);
  });

  it("exits 2 without scanning when HEAD shares no history with the base", () => {
    git("switch", "-q", "--orphan", "unrelated");
    git("commit", "-q", "--allow-empty", "-m", "unrelated");
    const result = scan();
    git("switch", "-q", "topic");
    expect(result).toEqual(
      cannotScan(
        "HEAD shares no history with origin/main (a shallow clone?). Run `git fetch --unshallow`.",
      ),
    );
    expect(recorded()).toEqual([]);
  });

  it("exits 2 (could not scan), not 1 (a finding), outside a git repository", () => {
    const outside = join(box.root, "outside");
    mkdirSync(outside);
    const result = scan({}, outside);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("semgrep: Command failed: git rev-parse --show-toplevel");
    expect(recorded()).toEqual([]);
  });

  it("exits 2 without mise, so CI fails instead of passing unchecked", () => {
    const noMise = join(box.root, "no-mise");
    mkdirSync(noMise);
    symlinkSync(join(gitIn(repo, ["--exec-path"]).trim(), "git"), join(noMise, "git"));
    expect(scan({ PATH: noMise })).toEqual(
      cannotScan(
        'mise is not installed, so the code cannot be scanned. See docs/local-env-setup/setup.md ("Ubuntu の初期セットアップ").',
      ),
    );
  });
});
