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
  it("returns what git prints", () => {
    gitIn(box.root, ["init", "-q", "."]);
    expect(tryGit(box.root, ["rev-parse", "--show-toplevel"])?.trim()).toBe(box.root);
  });

  it("returns output larger than the default buffer of 1 MiB", () => {
    gitIn(box.root, ["init", "-q", "."]);
    const big = gitIn(box.root, ["hash-object", "-w", "--stdin"], {
      input: "x".repeat(2 * 1024 * 1024),
    }).trim();
    expect(tryGit(box.root, ["cat-file", "blob", big])).toHaveLength(2 * 1024 * 1024);
  });

  it("returns undefined when git fails, such as outside a repository", () => {
    expect(tryGit(box.root, ["rev-parse", "--show-toplevel"])).toBeUndefined();
  });

  it("returns undefined when the directory does not exist", () => {
    expect(tryGit(`${box.root}/missing`, ["status"])).toBeUndefined();
  });
});
