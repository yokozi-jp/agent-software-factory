// 開発サーバーのポートを worktree ごとに分ける (docs/tooling/worktrees.md ("開発サーバーを動かす")、Issue #184)。
//   node tools/scripts/src/dev-ports/cli.ts assign <worktree>   空いている slot を割り当て、apps/web と apps/api の
//                                                               .env.local を書く。URL を出力する
//   node tools/scripts/src/dev-ports/cli.ts show                この worktree の slot の URL を出力する
// .env.local は、エージェントが読めない (docs/tooling/agent-permissions.md) ので、URL は show で知る。
// tools/scripts/sh/worktree.sh add が、worktree を作った後に assign を呼ぶ。
//   exit 0  done
//   exit 1  assign: 書く先に .env.local がある (上書きしない)。show: この worktree には assign していない
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
import { planAssign, planShow, summary, worktreePaths, type Worktree } from "./rules.ts";

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
// ロックを作る (mkdir は、あれば失敗する原子的な操作)。assign が殺されて残ったロックは、60 秒たてば捨てる。
const staleMs = 60_000;
function withLock<T>(cwd: string, work: () => T): T {
  const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  const lock = join(common, "dev-ports.lock");
  const waitMs = Number(process.env["DEV_PORTS_LOCK_WAIT_MS"] ?? 10_000);
  const giveUpAt = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      if (Date.now() - statSync(lock).mtimeMs > staleMs) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= giveUpAt)
        throw new Error("ほかの assign のロックを取れない (dev-ports.lock)");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return work();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function assign(cwd: string, target: string | undefined): Output {
  if (target === undefined) return fail(2, usage.trim());
  const dir = realpathSync(resolve(cwd, target));
  return withLock(cwd, () => {
    const plan = planAssign(worktrees(cwd), dir);
    if (!plan.ok) return fail(plan.status, plan.message);
    // "wx" は、ファイルがあると失敗する。planAssign の確認と書き込みの間に作られても、上書きしない。
    writeFileSync(webFile(dir), plan.files.web, { flag: "wx" });
    writeFileSync(apiFile(dir), plan.files.api, { flag: "wx" });
    return { status: 0, stdout: summary(plan.slot), stderr: "" };
  });
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
  if (rest.length > 0) return fail(2, usage.trim());
  if (command === "assign") return assign(cwd, target);
  if (command === "show" && target === undefined) return show(cwd);
  return fail(2, usage.trim());
}

let output: Output;
try {
  output = run(process.argv.slice(2));
} catch (error) {
  // git か、ファイルの書き込みか、ロックの失敗。git は理由を stderr に出している。
  output = fail(2, error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error));
}
process.stdout.write(output.stdout);
process.stderr.write(output.stderr);
process.exitCode = output.status;
