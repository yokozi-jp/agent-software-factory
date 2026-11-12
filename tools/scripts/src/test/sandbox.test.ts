import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  gitIn,
  isolatedGitEnv,
  miseDirs,
  runIn,
  sandbox,
  startIn,
  type Sandbox,
} from "./sandbox.ts";

let box: Sandbox;
beforeEach(() => {
  box = sandbox();
});
afterEach(() => {
  box.remove();
});

describe("sandbox", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(Object.keys(isolatedGitEnv))(
    "ルートの設定からの実行のように、setup.ts が %s を設定していないとき、起動を拒否すること",
    (name) => {
      vi.stubEnv(name, undefined);
      expect(() => sandbox()).toThrow(
        new RegExp(
          `isolation of src/test/setup\\.ts is not in place \\(${name}\\).*nx test scripts`,
        ),
      );
    },
  );

  it("変数が別の値のとき、起動を拒否すること", () => {
    vi.stubEnv("GIT_CONFIG_GLOBAL", "/home/u/.gitconfig");
    expect(() => sandbox()).toThrow(/not in place \(GIT_CONFIG_GLOBAL\)/);
  });
});

describe("gitIn", () => {
  it("sandbox にリポジトリを作り、その中で git を実行すること", () => {
    const repo = join(box.root, "repo");
    gitIn(repo, ["init", "-q", "-b", "main"]);
    expect(gitIn(repo, ["rev-parse", "--absolute-git-dir"]).trim()).toBe(join(repo, ".git"));
  });

  it("git に sandbox を HOME として渡すこと", () => {
    const repo = join(box.root, "repo");
    gitIn(repo, ["init", "-q"]);
    // A shell alias sees the environment that git was started with.
    expect(gitIn(repo, ["-c", 'alias.home=!printf %s "$HOME"', "home"])).toBe(box.root);
  });

  it("リポジトリが sandbox の外にあるディレクトリを拒否すること", () => {
    // This test file lives in this repository, outside any sandbox.
    expect(() => gitIn(import.meta.dirname, ["status"])).toThrow(/outside the sandbox/);
  });

  it("sandbox の外にリポジトリを作ることを拒否すること", () => {
    expect(() => gitIn(join(import.meta.dirname, "no-such-repo"), ["init", "-q"])).toThrow(
      /outside the sandbox/,
    );
  });

  it("外側のものを見つけずに、リポジトリではない sandbox 内のディレクトリを拒否すること", () => {
    const plain = join(box.root, "plain");
    mkdirSync(plain);
    expect(() => gitIn(plain, ["status"])).toThrow(/not a git repository/);
  });

  it("sandbox() を呼ぶ前の実行を拒否すること", () => {
    box.remove();
    expect(() => gitIn(box.root, ["status"])).toThrow(/call sandbox\(\)/);
  });
});

describe("runIn", () => {
  it("sandbox の外のディレクトリを拒否すること", () => {
    expect(() => runIn(import.meta.dirname, "true", [])).toThrow(/outside the sandbox/);
  });

  it("stdin を渡し、終了コードと出力を返すこと", () => {
    const result = runIn(box.root, "sh", ["-c", "cat; echo err >&2; exit 3"], { input: "in" });
    expect(result).toEqual({ status: 3, stdout: "in", stderr: "err\n" });
  });

  it("timeout を過ぎて実行されるコマンドを kill すること", () => {
    const result = runIn(box.root, "sleep", ["5"], { timeout: 200 });
    expect(result.status).toBeNull();
  });

  it("コマンドに sandbox を HOME として、与えられた変数とともに渡すこと", () => {
    const result = runIn(box.root, "sh", ["-c", 'printf "%s %s" "$HOME" "$EXTRA"'], {
      env: { EXTRA: "x" },
    });
    expect(result.stdout).toBe(`${box.root} x`);
  });
});

describe("miseDirs", () => {
  it("実際のホームの下で mise が既定で使うディレクトリを名付けること", () => {
    expect(miseDirs({}, "/home/u")).toEqual({
      MISE_DATA_DIR: "/home/u/.local/share/mise",
      MISE_CACHE_DIR: "/home/u/.cache/mise",
      MISE_STATE_DIR: "/home/u/.local/state/mise",
    });
  });

  it("XDG の変数と、それより前の MISE の変数に従うこと", () => {
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

  it("既定では、このプロセスの環境とホームを読むこと", () => {
    expect(miseDirs().MISE_DATA_DIR).toBe(
      process.env.MISE_DATA_DIR ??
        join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "mise"),
    );
  });
});

describe("startIn", () => {
  it("sandbox の外のディレクトリを拒否すること", () => {
    expect(() => startIn(import.meta.dirname, "sleep", ["1"])).toThrow(/outside the sandbox/);
  });

  it("コマンドを起動できないとき throw すること", () => {
    expect(() => startIn(box.root, join(box.root, "no-such-command"), [])).toThrow(
      /could not start/,
    );
  });

  it("stop() まで実行されるプロセスを起動すること", async () => {
    const sleeper = startIn(box.root, "sleep", ["60"]);
    expect(() => process.kill(sleeper.pid, 0)).not.toThrow();
    await sleeper.stop();
    expect(() => process.kill(sleeper.pid, 0)).toThrow(/ESRCH/);
  });
});
