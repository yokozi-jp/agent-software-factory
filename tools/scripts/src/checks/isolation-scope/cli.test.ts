// Process tests for the isolation-scope entry point: a real git repository in the sandbox. This is the test
// of the condition that ci.yml and the pre-push hook use (#477): a change to an isolation path prints `run`,
// any other change prints `skip`. Which paths count is in rules.test.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");

let box: Sandbox;
let repo: string;

const git = (...args: string[]): string => gitIn(repo, args).trim();
const scope = (...args: string[]) => runIn(repo, process.execPath, [cli, ...args]);
const commit = (file: string, text: string): void => {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), text);
  git("add", "-A");
  git("commit", "-qm", file);
};

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  commit("README.md", "a\n");
});
afterAll(() => {
  box.remove();
});

describe("isolation-scope", () => {
  it("skips when the branch changes nothing under the isolation paths", () => {
    git("switch", "-qc", "other");
    commit("tools/scripts/src/checks/a.ts", "a\n");
    expect(scope("main", "HEAD")).toEqual({ status: 0, stdout: "skip\n", stderr: "" });
  });

  it("runs when the branch changes a file under src/test/", () => {
    commit("tools/scripts/src/test/helper.ts", "a\n");
    expect(scope("main", "HEAD")).toEqual({ status: 0, stdout: "run\n", stderr: "" });
  });

  it("runs when the branch changes the Vitest config", () => {
    git("switch", "-q", "main");
    git("switch", "-qc", "config");
    commit("tools/scripts/vite.config.ts", "a\n");
    expect(scope("main", "HEAD")).toMatchObject({ status: 0, stdout: "run\n" });
  });

  it("is not triggered by what main changed after the branch left it", () => {
    git("switch", "-q", "other");
    git("switch", "-q", "main");
    commit("tools/scripts/src/test/on-main.ts", "a\n");
    git("switch", "-q", "other");
    git("reset", "-q", "--hard", "HEAD~1");
    expect(scope("main", "HEAD")).toMatchObject({ status: 0, stdout: "skip\n" });
  });

  it("accepts a commit SHA as the base, as CI passes NX_BASE", () => {
    const sha = git("rev-parse", "main~1");
    expect(scope(sha, "config")).toMatchObject({ status: 0, stdout: "run\n" });
  });

  it("fails with nothing on stdout when a ref is unknown, so a caller does not read it as skip", () => {
    const result = scope("no-such-ref", "HEAD");
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
  });

  it("fails with a usage message when the arguments are wrong", () => {
    const result = scope("main");
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("usage");
    expect(scope("a", "b", "c").status).toBe(2);
  });
});
