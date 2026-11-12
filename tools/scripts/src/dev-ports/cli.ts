// 開発サーバーのポートを worktree ごとに分ける (docs/tooling/worktrees.md ("開発サーバーを動かす")、Issue #184)。
//   node tools/scripts/src/dev-ports/cli.ts assign <worktree>   空いている slot を割り当て、apps/web と apps/api の
//                                                               .env.local を書く。URL を出力する。割り当て済みなら何も書かず、
//                                                               その slot を出力する
//   node tools/scripts/src/dev-ports/cli.ts show                この worktree の slot の URL を出力する
//   node tools/scripts/src/dev-ports/cli.ts hook <前の HEAD>    post-checkout の入口。前の HEAD が null ref (git worktree add)
//                                                               のときだけ、この worktree に assign する。常に終了コード 0
// .env.local は、エージェントが読めない (docs/tooling/agent-permissions.md) ので、URL は show で知る。
// lefthook.yml の post-checkout が hook を呼び、worktree を作った人が誰でも slot が付く。古い commit から作った worktree には
// hook がないので、tools/scripts/sh/worktree.sh add が、作った後に assign を呼ぶ。
//   exit 0  done。hook は、割り当てに失敗しても 0 (失敗した post-checkout は git worktree add を失敗にする)。hook が 0 を
//           守るのは、このファイルが動き出してから。node が起動しない、このファイルがない、という失敗は、lefthook.yml の
//           `|| true` が吸収する
//   exit 1  assign: 書く先に、slot の印のない .env.local がある (上書きしない)。show: この worktree には assign していない
//   exit 2  usage, main の checkout への assign, 空いている slot がない, ロックを取れない, git の失敗
// このファイルは git とファイルを読み書きして、事実を集めて出力する。何を決めるかは rules.ts にある (docs/adr/0024)。
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  isNullRef,
  lockAction,
  planAssign,
  planShow,
  shouldAssignOnCheckout,
  summary,
  worktreePaths,
  type Worktree,
} from "./rules.ts";

type Output = { readonly status: number; readonly stdout: string; readonly stderr: string };

const usage = "usage: node tools/scripts/src/dev-ports/cli.ts assign <worktree> | show\n";
const fail = (status: number, message: string): Output => ({
  status,
  stdout: "",
  stderr: `dev-ports: ${message}\n`,
});

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// The file the ports are written to, in the directory of each app (gitignored). Its name is written apart from the
// directory: repo-policy reads a path written whole as a tracked file (docs/tooling/ci.md).
const portsFile = ".env.local";
const apiFile = (worktree: string): string => join(worktree, "apps", "api", portsFile);
const webFile = (worktree: string): string => join(worktree, "apps", "web", portsFile);

function read(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

// git が返す worktree (main が先頭) と、それぞれの .env.local の中身。ディレクトリを手で消した worktree も、git は
// 一覧に残す (prunable)。その path は realpath にできないので、そのまま渡して exists: false にする。
function worktrees(cwd: string): Worktree[] {
  return worktreePaths(git(cwd, ["worktree", "list", "--porcelain"])).map((path) => {
    if (!existsSync(path)) return { path, exists: false, api: undefined, web: undefined };
    const real = realpathSync(path);
    return { path: real, exists: true, api: read(apiFile(real)), web: read(webFile(real)) };
  });
}

// 同時に worktree を作る複数のセッションが、同じ slot を取らないための排他。git の共通ディレクトリに mkdir で
// ロックを作る (mkdir は、あれば失敗する原子的な操作)。assign が殺されて残ったロックは、60 秒たてば捨てる
// (rules.ts の lockAction)。
// 人が実行する assign は 10 秒まで待つ。DEV_PORTS_LOCK_WAIT_MS で変えられる (assign のテストが短くする)。hook は
// 下の hookLockWaitMs で、この値を見ない。
const assignLockWaitMs = Number(process.env["DEV_PORTS_LOCK_WAIT_MS"] ?? 10_000);

const isErrno = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

// ロックを作ってからのミリ秒。調べる前に保持者が解放していれば undefined (stat が ENOENT)。
function lockAge(lock: string): number | undefined {
  try {
    return Date.now() - statSync(lock).mtimeMs;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    throw error;
  }
}

function withLock<T>(cwd: string, waitMs: number, work: () => T): T {
  const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  const lock = join(common, "dev-ports.lock");
  const giveUpAt = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
      const action = lockAction({ age: lockAge(lock), remainingMs: giveUpAt - Date.now() });
      if (action === "give-up")
        throw new Error("ほかの assign のロックを取れない (dev-ports.lock)");
      if (action === "remove") rmSync(lock, { recursive: true, force: true });
      if (action === "wait") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return work();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function assign(cwd: string, target: string | undefined, waitMs = assignLockWaitMs): Output {
  if (target === undefined) return fail(2, usage.trim());
  const dir = realpathSync(resolve(cwd, target));
  return withLock(cwd, waitMs, () => {
    const plan = planAssign(worktrees(cwd), dir);
    if (!plan.ok) return fail(plan.status, plan.message);
    // すでに割り当て済み (kind: "existing") なら何も書かない。
    // "wx" は、ファイルがあると失敗する。planAssign の確認と書き込みの間に作られても、上書きしない。
    if (plan.kind === "new") {
      writeFileSync(webFile(dir), plan.files.web, { flag: "wx" });
      writeFileSync(apiFile(dir), plan.files.api, { flag: "wx" });
    }
    return { status: 0, stdout: summary(plan.slot), stderr: "" };
  });
}

// lefthook.yml の post-checkout が呼ぶ。git worktree add が null ref を渡すので、そのときだけ割り当てる。
// 通常の checkout と switch のたびに動くので、null ref でなければ、git もロックも使わずに終わる。この早期の判定は、
// git を呼ぶ前に終えるためにここにある。割り当てるかどうかの判断 (main の checkout を除く) は、shouldAssignOnCheckout が持つ。
// どんな失敗でも終了コード 0 で、警告だけを出す: git は、失敗した post-checkout を git worktree add の失敗にする
// (worktree は作られる。git 2.53.0 で確かめた、2026-11-12)。
// ロックは短く待つ。git worktree add を長く止めないためで、取れなければ、worktree.sh add の assign に任せる。保持者は
// git を数回呼ぶだけで、通常は数十ミリ秒で終わる。
const hookLockWaitMs = 2_000;

function hook(cwd: string, previousHead: string | undefined): Output {
  if (previousHead === undefined || !isNullRef(previousHead))
    return { status: 0, stdout: "", stderr: "" };
  try {
    const top = realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]).trim());
    const [mainCheckout] = worktrees(cwd);
    if (mainCheckout === undefined || !shouldAssignOnCheckout(previousHead, top, mainCheckout.path))
      return { status: 0, stdout: "", stderr: "" };
    const result = assign(cwd, top, hookLockWaitMs);
    return result.status === 0 ? result : { status: 0, stdout: "", stderr: result.stderr };
  } catch (error) {
    return { status: 0, stdout: "", stderr: failure(error) };
  }
}

function show(cwd: string): Output {
  const top = realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]).trim());
  const plan = planShow(worktrees(cwd), top);
  if (!plan.ok) return fail(plan.status, plan.message);
  return {
    status: 0,
    stdout: summary(plan.slot),
    stderr: plan.warning === undefined ? "" : `dev-ports: ${plan.warning}\n`,
  };
}

function run(args: readonly string[]): Output {
  const cwd = process.cwd();
  const [command, target, ...rest] = args;
  // hook は、git が渡す引数 (第 1 引数のほか 2 つ) を受ける。形が合わなくても失敗にしない。
  if (command === "hook") return hook(cwd, target);
  if (rest.length > 0) return fail(2, usage.trim());
  if (command === "assign") return assign(cwd, target);
  if (command === "show" && target === undefined) return show(cwd);
  return fail(2, usage.trim());
}

// 例外の最初の行。git は理由を stderr に出している。
const failure = (error: unknown): string =>
  `dev-ports: ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)}\n`;

let output: Output;
try {
  output = run(process.argv.slice(2));
} catch (error) {
  // git か、ファイルの書き込みか、ロックの失敗。
  output = { status: 2, stdout: "", stderr: failure(error) };
}
process.stdout.write(output.stdout);
process.stderr.write(output.stderr);
process.exitCode = output.status;
