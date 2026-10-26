import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "./sandbox.ts";

let box: Sandbox;
beforeEach(() => {
  box = sandbox();
});
afterEach(() => {
  box.remove();
});

describe("gitIn", () => {
  it("creates a repository in the sandbox and runs git in it", () => {
    const repo = join(box.root, "repo");
    gitIn(repo, ["init", "-q", "-b", "main"]);
    expect(gitIn(repo, ["rev-parse", "--absolute-git-dir"]).trim()).toBe(join(repo, ".git"));
  });

  it("gives git the sandbox as HOME", () => {
    const repo = join(box.root, "repo");
    gitIn(repo, ["init", "-q"]);
    // A shell alias sees the environment that git was started with.
    expect(gitIn(repo, ["-c", 'alias.home=!printf %s "$HOME"', "home"])).toBe(box.root);
  });

  it("refuses a directory whose repository is outside the sandbox", () => {
    // This test file lives in this repository, outside any sandbox.
    expect(() => gitIn(import.meta.dirname, ["status"])).toThrow(/outside the sandbox/);
  });

  it("refuses to create a repository outside the sandbox", () => {
    expect(() => gitIn(join(import.meta.dirname, "no-such-repo"), ["init", "-q"])).toThrow(
      /outside the sandbox/,
    );
  });

  it("refuses a directory in the sandbox that is not a repository, instead of finding an outer one", () => {
    const plain = join(box.root, "plain");
    mkdirSync(plain);
    expect(() => gitIn(plain, ["status"])).toThrow(/not a git repository/);
  });

  it("refuses to run before sandbox() is called", () => {
    box.remove();
    expect(() => gitIn(box.root, ["status"])).toThrow(/call sandbox\(\)/);
  });
});

describe("runIn", () => {
  it("refuses a directory outside the sandbox", () => {
    expect(() => runIn(import.meta.dirname, "true", [])).toThrow(/outside the sandbox/);
  });

  it("passes stdin and returns the exit code and output", () => {
    const result = runIn(box.root, "sh", ["-c", "cat; echo err >&2; exit 3"], { input: "in" });
    expect(result).toEqual({ status: 3, stdout: "in", stderr: "err\n" });
  });

  it("gives the command the sandbox as HOME, and the variables it is given", () => {
    const result = runIn(box.root, "sh", ["-c", 'printf "%s %s" "$HOME" "$EXTRA"'], {
      env: { EXTRA: "x" },
    });
    expect(result.stdout).toBe(`${box.root} x`);
  });
});
