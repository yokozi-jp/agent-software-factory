// Process tests for cli.ts. Each test makes its own main checkout and git worktrees in the sandbox,
// so the slots one test takes do not leak into another.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";
import { envFiles, slotCount } from "./rules.ts";

const cli = join(import.meta.dirname, "cli.ts");

let box: Sandbox;
let repos = 0;

beforeAll(() => {
  box = sandbox();
});
afterAll(() => {
  box.remove();
});

interface Repo {
  readonly main: string;
  // main の隣に worktree を作る。apps/ は git に入っていないので、ここで作る。
  readonly add: () => string;
}

function repo(): Repo {
  repos += 1;
  const main = join(box.root, `app-${repos}`);
  gitIn(main, ["init", "-q", "-b", "main"]);
  writeFileSync(join(main, "a"), "a\n");
  gitIn(main, ["add", "-A"]);
  gitIn(main, ["commit", "-qm", "base"]);
  let count = 0;
  return {
    main,
    add: () => {
      count += 1;
      const dir = join(box.root, `app-${repos}-worktrees/wt-${count}`);
      gitIn(main, ["worktree", "add", "-q", "-b", `wt-${count}`, dir]);
      mkdirSync(join(dir, "apps/api"), { recursive: true });
      mkdirSync(join(dir, "apps/web"), { recursive: true });
      return dir;
    },
  };
}

const run = (dir: string, ...args: string[]) => runIn(dir, "node", [cli, ...args]);
const apiFile = (dir: string) => join(dir, "apps/api/.env.local");
const webFile = (dir: string) => join(dir, "apps/web/.env.local");
const slotIn = (text: string): number => Number(/^slot (\d+)/m.exec(text)?.[1]);

describe("dev-ports の assign", () => {
  it("最初の worktree に slot 1 を割り当て、2 つのファイルを書き、URL を出力すること", () => {
    const { main, add } = repo();
    const dir = add();
    const result = run(main, "assign", dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("slot 1");
    expect(result.stdout).toContain("http://localhost:5183");
    expect(readFileSync(webFile(dir), "utf8")).toBe(envFiles(1).web);
    expect(readFileSync(apiFile(dir), "utf8")).toBe(envFiles(1).api);
  });

  it("使われていない次の slot を、worktree ごとに割り当てること", () => {
    const { main, add } = repo();
    expect(run(main, "assign", add()).stdout).toContain("slot 1");
    expect(run(main, "assign", add()).stdout).toContain("slot 2");
  });

  it("消した worktree の slot を、再び割り当てること", () => {
    const { main, add } = repo();
    const first = add();
    run(main, "assign", first);
    run(main, "assign", add());
    gitIn(main, ["worktree", "remove", "--force", first]);
    expect(run(main, "assign", add()).stdout).toContain("slot 1");
  });

  it("worktree の中から実行しても、ほかの worktree の slot を避けること", () => {
    const { main, add } = repo();
    const first = add();
    const second = add();
    const taken = slotIn(run(main, "assign", first).stdout);
    const next = slotIn(run(first, "assign", second).stdout);
    expect(next).not.toBe(taken);
  });

  it("すでに .env.local があるときは、上書きせず終了コード 1 で断ること", () => {
    const { main, add } = repo();
    const dir = add();
    writeFileSync(apiFile(dir), "AUTH_SECRET=mine\n");
    const result = run(main, "assign", dir);
    expect(result.status).toBe(1);
    expect(readFileSync(apiFile(dir), "utf8")).toBe("AUTH_SECRET=mine\n");
    expect(existsSync(webFile(dir))).toBe(false);
  });

  it("main の checkout には割り当てず、終了コード 2 で断ること", () => {
    const { main } = repo();
    const result = run(main, "assign", main);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("main");
    expect(existsSync(apiFile(main))).toBe(false);
  });

  it("slot が尽きたら、worktree を消すよう伝えて終了コード 2 で終わること", () => {
    const { main, add } = repo();
    for (let index = 1; index < slotCount; index += 1)
      expect(run(main, "assign", add()).status).toBe(0);
    const dir = add();
    const result = run(main, "assign", dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("worktree を消");
    expect(existsSync(apiFile(dir))).toBe(false);
  });

  it("引数が足りないとき、使い方を出して終了コード 2 で終わること", () => {
    const { main } = repo();
    const result = run(main, "assign");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage:");
  });
});

describe("dev-ports の show", () => {
  it("assign した worktree で、その slot の URL を出力すること", () => {
    const { main, add } = repo();
    const dir = add();
    run(main, "assign", dir);
    run(main, "assign", add());
    const result = run(dir, "show");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("slot 1");
    expect(result.stdout).toContain("api        http://localhost:3010");
  });

  it("サブディレクトリから実行しても、worktree の slot を出力すること", () => {
    const { main, add } = repo();
    const dir = add();
    run(main, "assign", dir);
    expect(run(join(dir, "apps/web"), "show").stdout).toContain("slot 1");
  });

  it("main の checkout では、slot 0 (既定のポート) を出力すること", () => {
    const { main } = repo();
    const result = run(main, "show");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("slot 0");
    expect(result.stdout).toContain("web        http://localhost:5173");
  });

  it("assign していない worktree では、slot 0 の URL を出さず、終了コード 1 で断ること", () => {
    const { add } = repo();
    const result = run(add(), "show");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("assign");
    expect(result.stdout).toBe("");
  });
});
