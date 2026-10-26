// Process tests for sh/worktree.sh in a sandboxed main checkout with a local bare origin.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const script = join(import.meta.dirname, "../../sh/worktree.sh");

let box: Sandbox;
let main: string;
let base: string;

beforeAll(() => {
  box = sandbox();
  const origin = join(box.root, "origin.git");
  main = join(box.root, "app");
  base = join(box.root, "app-worktrees");
  gitIn(origin, ["init", "-q", "--bare", "-b", "main"]);
  gitIn(main, ["init", "-q", "-b", "main"]);
  mkdirSync(join(main, "sub/deeper"), { recursive: true });
  writeFileSync(join(main, "sub/deeper/a"), "a\n");
  gitIn(main, ["add", "-A"]);
  gitIn(main, ["commit", "-qm", "base"]);
  gitIn(main, ["remote", "add", "origin", origin]);
  gitIn(main, ["push", "-q", "origin", "main"]);
});
afterAll(() => {
  box.remove();
});

const worktree = (dir: string, ...args: string[]) => runIn(dir, "sh", [script, ...args]);
const branchOf = (dir: string): string => gitIn(dir, ["branch", "--show-current"]).trim();

describe("worktree.sh path", () => {
  it("prints the same path from the main checkout and from a subdirectory of it", () => {
    for (const dir of [main, join(main, "sub/deeper")])
      expect(worktree(dir, "path", "feat/a")).toMatchObject({
        status: 0,
        stdout: `${base}/feat/a\n`,
      });
  });
});

describe("worktree.sh add", () => {
  it("creates the worktree from origin/main and checks out the new branch", () => {
    expect(worktree(main, "add", "feat/a", "--no-install").status).toBe(0);
    expect(branchOf(join(base, "feat/a"))).toBe("feat/a");
  });

  // From inside another worktree, a relative ../<base> would land inside that worktree.
  it("puts a worktree added from another worktree, or its subdirectory, beside the first", () => {
    const other = join(base, "feat/a");
    expect(worktree(other, "path", "feat/b").stdout).toBe(`${base}/feat/b\n`);
    expect(worktree(join(other, "sub/deeper"), "path", "feat/b").stdout).toBe(`${base}/feat/b\n`);
    expect(worktree(join(other, "sub"), "add", "feat/b", "--no-install").status).toBe(0);
    expect(branchOf(join(base, "feat/b"))).toBe("feat/b");
    expect(existsSync(join(other, "sub/app-worktrees"))).toBe(false);
  });

  it("prints only the path on stdout", () => {
    expect(worktree(main, "add", "feat/c", "--no-install")).toMatchObject({
      status: 0,
      stdout: `${base}/feat/c\n`,
    });
  });

  it("refuses an existing directory with exit 1", () => {
    const result = worktree(main, "add", "feat/a", "--no-install");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already exists");
  });
});

describe("worktree.sh usage", () => {
  it.each([
    ["missing arguments", ["path"]],
    ["an empty branch", ["path", ""]],
    ["an unknown command", ["remove", "feat/a"]],
    ["an unknown option", ["add", "feat/d", "--install"]],
  ])("refuses %s with exit 2", (_, args) => {
    const result = worktree(main, ...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: tools/scripts/sh/worktree.sh");
  });
});
