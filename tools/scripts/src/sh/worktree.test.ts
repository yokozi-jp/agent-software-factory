// Process tests for sh/worktree.sh in a sandboxed main checkout with a local bare origin.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
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

describe("worktree.sh path の出力", () => {
  it("main の checkout とそのサブディレクトリから、同じ path を出力すること", () => {
    for (const dir of [main, join(main, "sub/deeper")])
      expect(worktree(dir, "path", "feat/a")).toMatchObject({
        status: 0,
        stdout: `${base}/feat/a\n`,
      });
  });
});

describe("worktree.sh add の動作", () => {
  it("origin/main から worktree を作り、新しいブランチを checkout すること", () => {
    expect(worktree(main, "add", "feat/a", "--no-install").status).toBe(0);
    expect(branchOf(join(base, "feat/a"))).toBe("feat/a");
  });

  // From inside another worktree, a relative ../<base> would land inside that worktree.
  it("別の worktree またはそのサブディレクトリから足した worktree を、最初のものの隣に置くこと", () => {
    const other = join(base, "feat/a");
    expect(worktree(other, "path", "feat/b").stdout).toBe(`${base}/feat/b\n`);
    expect(worktree(join(other, "sub/deeper"), "path", "feat/b").stdout).toBe(`${base}/feat/b\n`);
    expect(worktree(join(other, "sub"), "add", "feat/b", "--no-install").status).toBe(0);
    expect(branchOf(join(base, "feat/b"))).toBe("feat/b");
    expect(existsSync(join(other, "sub/app-worktrees"))).toBe(false);
  });

  it("stdout には path だけを出力すること", () => {
    expect(worktree(main, "add", "feat/c", "--no-install")).toMatchObject({
      status: 0,
      stdout: `${base}/feat/c\n`,
    });
  });

  it("存在するディレクトリを終了コード 1 で拒否すること", () => {
    const result = worktree(main, "add", "feat/a", "--no-install");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already exists");
  });
});

// A main checkout with a local bare origin. withApps: apps/web and apps/api exist, where the ports are written.
function makeMain(name: string, withApps: boolean): string {
  const origin = join(box.root, `${name}.git`);
  const dir = join(box.root, name);
  gitIn(origin, ["init", "-q", "--bare", "-b", "main"]);
  gitIn(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "a"), "a\n");
  if (withApps)
    for (const app of ["web", "api"]) {
      mkdirSync(join(dir, "apps", app), { recursive: true });
      writeFileSync(join(dir, "apps", app, ".gitkeep"), "");
    }
  gitIn(dir, ["add", "-A"]);
  gitIn(dir, ["commit", "-qm", "base"]);
  gitIn(dir, ["remote", "add", "origin", origin]);
  gitIn(dir, ["push", "-q", "origin", "main"]);
  return dir;
}

describe("worktree.sh add の採番 (Issue #184)", () => {
  // 各テストが自分の main の checkout を持つ。前のテストが slot を使った状態に頼らない。
  it("worktree に開発サーバーの slot を割り当て、URL を stderr に出し、stdout は path だけにすること", () => {
    const own = makeMain("ports", true);
    const result = worktree(own, "add", "feat/slot-a", "--no-install");
    expect(result).toMatchObject({
      status: 0,
      stdout: `${join(box.root, "ports-worktrees")}/feat/slot-a\n`,
    });
    expect(result.stderr).toContain("slot 1");
    expect(
      readFileSync(join(box.root, "ports-worktrees/feat/slot-a/apps/api/.env.local"), "utf8"),
    ).toContain("PORT=3010");
  });

  it("続けて足した worktree には、別の slot を割り当てること", () => {
    const own = makeMain("ports-two", true);
    expect(worktree(own, "add", "feat/one", "--no-install").stderr).toContain("slot 1");
    expect(worktree(own, "add", "feat/two", "--no-install").stderr).toContain("slot 2");
  });

  // script を相対 path で呼ぶと (docs の書き方)、cd の後の $0 は新しい worktree の中を指す。
  it("script を相対 path で呼んでも、割り当てること", () => {
    const own = makeMain("ports-relative", true);
    const sub = join(own, "deep");
    mkdirSync(sub);
    const result = runIn(sub, "sh", [relative(sub, script), "add", "feat/rel", "--no-install"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("slot 1");
  });

  // 採番に失敗しても worktree は使える。strictPort が衝突を失敗にする。
  it("採番に失敗しても、警告を出して worktree を作り、終了コード 0 で終わること", () => {
    const plain = makeMain("no-apps", false);
    const result = worktree(plain, "add", "feat/x", "--no-install");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${join(box.root, "no-apps-worktrees")}/feat/x\n`);
    expect(result.stderr).toContain("warning: dev-ports");
  });
});

describe("worktree.sh の使い方", () => {
  it.each([
    ["missing arguments", ["path"]],
    ["an empty branch", ["path", ""]],
    ["an unknown command", ["remove", "feat/a"]],
    ["an unknown option", ["add", "feat/d", "--install"]],
  ])("%s を終了コード 2 で拒否すること", (_, args) => {
    const result = worktree(main, ...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: tools/scripts/sh/worktree.sh");
  });
});
