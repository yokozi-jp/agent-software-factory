// Process tests for cli.ts. Each test makes its own main checkout and git worktrees in the sandbox,
// so the slots one test takes do not leak into another.
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type RunOptions, type Sandbox } from "../test/sandbox.ts";
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

// 最後の引数がオブジェクトなら、runIn のオプション (env など) として渡す。
const run = (dir: string, ...args: (string | RunOptions)[]) => {
  const last = args.at(-1);
  const options = typeof last === "object" ? last : undefined;
  const words = args.filter((arg): arg is string => typeof arg === "string");
  return runIn(dir, "node", [cli, ...words], options);
};
const apiFile = (dir: string) => join(dir, "apps/api/.env.local");
const webFile = (dir: string) => join(dir, "apps/web/.env.local");
const slotIn = (text: string): number => Number(/^slot (\d+)/m.exec(text)?.[1]);

// post-checkout の hook (lefthook.yml) が呼ぶ入口。git worktree add が null ref を渡す (https://git-scm.com/docs/githooks)。
// 失敗しても終了コードは 0: git 2.53.0 は、失敗した post-checkout を worktree add の失敗にする (worktree は作られる。
// 実験で確かめた、2026-11-12。githooks には書かれていない)。
describe("dev-ports の hook", () => {
  const nullRef = "0".repeat(40);

  it("null ref のとき、その worktree に slot を割り当て、ファイルを書くこと", () => {
    const { add } = repo();
    const dir = add();
    const result = run(dir, "hook", nullRef);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("slot 1");
    expect(readFileSync(apiFile(dir), "utf8")).toBe(envFiles(1).api);
  });

  it("前の HEAD がある通常の checkout では、何も書かず何も出力しないこと", () => {
    const { add } = repo();
    const dir = add();
    const result = run(dir, "hook", "14c74576e7421e12e79ab2546d7135e353a4a56f");
    expect(result).toMatchObject({ status: 0, stdout: "", stderr: "" });
    expect(existsSync(apiFile(dir))).toBe(false);
  });

  it("main の checkout では、null ref でも何も書かず、静かに終了コード 0 で終わること", () => {
    const { main } = repo();
    const result = run(main, "hook", nullRef);
    expect(result).toMatchObject({ status: 0, stdout: "", stderr: "" });
  });

  // worktree.sh add が続けて assign しても、hook の結果が残る。
  it("すでに割り当て済みの worktree では、書き直さず、終了コード 0 で終わること", () => {
    const { add } = repo();
    const dir = add();
    run(dir, "hook", nullRef);
    const before = readFileSync(apiFile(dir), "utf8");
    const again = run(dir, "hook", nullRef);
    expect(again.status).toBe(0);
    expect(readFileSync(apiFile(dir), "utf8")).toBe(before);
  });

  it("割り当てに失敗しても、警告を stderr に出し、終了コード 0 で終わること", () => {
    const { main, add } = repo();
    for (let index = 1; index < slotCount; index += 1) run(main, "assign", add());
    const dir = add();
    const result = run(dir, "hook", nullRef);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("worktree を消");
    expect(existsSync(apiFile(dir))).toBe(false);
  });

  it("引数がないとき、使い方を出さず、終了コード 0 で何もしないこと", () => {
    const { add } = repo();
    const dir = add();
    expect(run(dir, "hook")).toMatchObject({ status: 0, stdout: "" });
    expect(existsSync(apiFile(dir))).toBe(false);
  });

  // 通常の checkout と switch のたびに動くので、前の HEAD が null ref でなければ、git も ロックも使わずに終わる。
  // git の失敗が出ないことが、git を呼んでいない証拠になる: git の作業ツリーでない場所で動かす。
  it("null ref でなければ、git の作業ツリーでない場所でも、何も出さず終了コード 0 で終わること", () => {
    const outside = join(box.root, "not-a-repo");
    mkdirSync(outside);
    const result = run(outside, "hook", "14c74576e7421e12e79ab2546d7135e353a4a56f");
    expect(result).toMatchObject({ status: 0, stdout: "", stderr: "" });
  });

  // 別の assign がロックを持つ間、git worktree add を何秒も止めない。待ちを短くして、取れなければ警告して終わる。
  it("ロックを取れなくても、警告を出して終了コード 0 で終わり、何も書かないこと", () => {
    const { main, add } = repo();
    const dir = add();
    mkdirSync(join(main, ".git", "dev-ports.lock"));
    const started = Date.now();
    const result = run(dir, "hook", nullRef);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("ロック");
    expect(existsSync(apiFile(dir))).toBe(false);
    // 既定の待ちは 2 秒。人が実行する assign の 10 秒より短い。
    expect(Date.now() - started).toBeLessThan(8000);
  });

  // 失敗は git worktree add の失敗になるので、どの失敗でも 0 で終わる。ここでは git が失敗する場所 (作業ツリーでない) で、
  // null ref を渡す。
  it("null ref でも git が失敗する場所では、警告を出して終了コード 0 で終わること", () => {
    const outside = join(box.root, "not-a-repo-either");
    mkdirSync(outside);
    const result = run(outside, "hook", nullRef);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("dev-ports");
  });
});

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

  it("すでに割り当て済みの worktree に assign すると、書き直さず、同じ slot を出力すること", () => {
    const { main, add } = repo();
    const dir = add();
    run(main, "assign", dir);
    const before = readFileSync(apiFile(dir), "utf8");
    const again = run(main, "assign", dir);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("slot 1");
    expect(readFileSync(apiFile(dir), "utf8")).toBe(before);
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

  // git は、ディレクトリを手で消した worktree を一覧に残す。以前は realpath が ENOENT で全部の実行を止めた。
  it("ディレクトリを手で消した worktree があっても、その slot を空きとして割り当てること", () => {
    const { main, add } = repo();
    const gone = add();
    run(main, "assign", gone);
    rmSync(gone, { recursive: true });
    const result = run(main, "assign", add());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("slot 1");
  });
});

// 同時に worktree を作る複数のセッションが、同じ slot を取らないための排他 (git の共通ディレクトリの dev-ports.lock)。
describe("dev-ports の排他", () => {
  const lockOf = (main: string) => join(main, ".git", "dev-ports.lock");

  it("割り当てたあとに、ロックを残さないこと", () => {
    const { main, add } = repo();
    run(main, "assign", add());
    expect(existsSync(lockOf(main))).toBe(false);
  });

  it("ほかの assign がロックを持っている間は待ち、取れなければ何も書かず終了コード 2 で断ること", () => {
    const { main, add } = repo();
    const dir = add();
    mkdirSync(lockOf(main));
    const result = run(main, "assign", dir, { env: { DEV_PORTS_LOCK_WAIT_MS: "300" } });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("ロック");
    expect(existsSync(apiFile(dir))).toBe(false);
    expect(existsSync(lockOf(main))).toBe(true);
  });

  // assign が途中で殺されると、ロックが残る。いつまでも後続を止めないよう、古いロックは捨てる。
  it("60 秒より古いロックは捨てて、割り当てること", () => {
    const { main, add } = repo();
    mkdirSync(lockOf(main));
    const old = new Date(Date.now() - 120_000);
    utimesSync(lockOf(main), old, old);
    const result = run(main, "assign", add());
    expect(result.status).toBe(0);
    expect(existsSync(lockOf(main))).toBe(false);
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
