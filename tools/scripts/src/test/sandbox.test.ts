import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { gitIn, miseDirs, runIn, sandbox, startIn, type Sandbox } from "./sandbox.ts";

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

  it("kills a command that runs past its timeout", () => {
    const result = runIn(box.root, "sleep", ["5"], { timeout: 200 });
    expect(result.status).toBeNull();
  });

  it("gives the command the sandbox as HOME, and the variables it is given", () => {
    const result = runIn(box.root, "sh", ["-c", 'printf "%s %s" "$HOME" "$EXTRA"'], {
      env: { EXTRA: "x" },
    });
    expect(result.stdout).toBe(`${box.root} x`);
  });
});

describe("miseDirs", () => {
  it("names the directories mise uses by default under the real home", () => {
    expect(miseDirs({}, "/home/u")).toEqual({
      MISE_DATA_DIR: "/home/u/.local/share/mise",
      MISE_CACHE_DIR: "/home/u/.cache/mise",
      MISE_STATE_DIR: "/home/u/.local/state/mise",
    });
  });

  it("follows the XDG variables, and the MISE variables before them", () => {
    const env = {
      XDG_DATA_HOME: "/x/data",
      XDG_CACHE_HOME: "/x/cache",
      XDG_STATE_HOME: "/x/state",
      MISE_DATA_DIR: "/m/data",
    };
    expect(miseDirs(env, "/home/u")).toEqual({
      MISE_DATA_DIR: "/m/data",
      MISE_CACHE_DIR: "/x/cache/mise",
      MISE_STATE_DIR: "/x/state/mise",
    });
  });

  it("reads the environment and the home of this process by default", () => {
    expect(miseDirs().MISE_DATA_DIR).toBe(
      process.env.MISE_DATA_DIR ??
        join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "mise"),
    );
  });
});

describe("startIn", () => {
  it("refuses a directory outside the sandbox", () => {
    expect(() => startIn(import.meta.dirname, "sleep", ["1"])).toThrow(/outside the sandbox/);
  });

  it("throws when the command cannot start", () => {
    expect(() => startIn(box.root, join(box.root, "no-such-command"), [])).toThrow(
      /could not start/,
    );
  });

  it("starts a process that runs until stop()", async () => {
    const sleeper = startIn(box.root, "sleep", ["60"]);
    expect(() => process.kill(sleeper.pid, 0)).not.toThrow();
    await sleeper.stop();
    expect(() => process.kill(sleeper.pid, 0)).toThrow(/ESRCH/);
  });
});
