import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { gitIn, sandbox, type Sandbox } from "../test/sandbox.ts";
import { tryGit } from "./git.ts";

let box: Sandbox;
beforeEach(() => {
  box = sandbox();
});
afterEach(() => {
  box.remove();
});

describe("tryGit", () => {
  it("git が出力したものを返すこと", () => {
    gitIn(box.root, ["init", "-q", "."]);
    expect(tryGit(box.root, ["rev-parse", "--show-toplevel"])?.trim()).toBe(box.root);
  });

  it("既定のバッファ 1 MiB より大きい出力を返すこと", () => {
    gitIn(box.root, ["init", "-q", "."]);
    const big = gitIn(box.root, ["hash-object", "-w", "--stdin"], {
      input: "x".repeat(2 * 1024 * 1024),
    }).trim();
    expect(tryGit(box.root, ["cat-file", "blob", big])).toHaveLength(2 * 1024 * 1024);
  });

  it("リポジトリの外などで git が失敗したとき、undefined を返すこと", () => {
    expect(tryGit(box.root, ["rev-parse", "--show-toplevel"])).toBeUndefined();
  });

  it("ディレクトリがないとき、undefined を返すこと", () => {
    expect(tryGit(`${box.root}/missing`, ["status"])).toBeUndefined();
  });
});
