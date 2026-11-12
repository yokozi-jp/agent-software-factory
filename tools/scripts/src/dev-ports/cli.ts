// 開発サーバーのポートを worktree ごとに分ける (docs/tooling/worktrees.md ("開発サーバーを動かす")、Issue #184)。
//   node tools/scripts/src/dev-ports/cli.ts assign <worktree>   空いている slot を割り当て、apps/web と apps/api の
//                                                               .env.local を書く。URL を出力する
//   node tools/scripts/src/dev-ports/cli.ts show                この worktree の slot の URL を出力する
// .env.local は、エージェントが読めない (docs/tooling/agent-permissions.md) ので、URL は show で知る。
// tools/scripts/sh/worktree.sh add が、worktree を作った後に assign を呼ぶ。
//   exit 0  done
//   exit 1  assign: 書く先に .env.local がある (上書きしない)。show: この worktree には assign していない
//   exit 2  usage, main の checkout への assign, 空いている slot がない, git の失敗
// 規則は rules.ts にある。このファイルは git とファイルを読み書きして、出力する。
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { envFiles, lowestFreeSlot, slotOf, summary, worktreePaths } from "./rules.ts";

interface Output {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

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

// git が返す worktree の path (main が先頭)。
function worktrees(cwd: string): string[] {
  return worktreePaths(git(cwd, ["worktree", "list", "--porcelain"])).map((path) =>
    realpathSync(path),
  );
}

function assign(cwd: string, target: string | undefined): Output {
  if (target === undefined) return fail(2, usage.trim());
  const [main, ...others] = worktrees(cwd);
  const dir = realpathSync(resolve(cwd, target));
  if (dir === main)
    return fail(2, "main の checkout には割り当てない (slot 0 の既定のポートを使う)");
  if (!others.includes(dir)) return fail(2, `${dir} は git の worktree ではない`);
  if (read(apiFile(dir)) !== undefined || read(webFile(dir)) !== undefined)
    return fail(1, `${dir} には .env.local がある。上書きしない (消してからやり直す)`);
  // main は slot 0。ほかの worktree は、書き出したファイルの印が slot を持つ。
  const used = [
    0,
    ...others
      .filter((other) => other !== dir)
      .flatMap((other) => slotOf(read(apiFile(other)) ?? "") ?? []),
  ];
  let slot: number;
  try {
    slot = lowestFreeSlot(used);
  } catch (error) {
    return fail(2, error instanceof Error ? error.message : String(error));
  }
  const files = envFiles(slot);
  // "wx" は、ファイルがあると失敗する。上の確認と書き込みの間に作られても、上書きしない。
  writeFileSync(webFile(dir), files.web, { flag: "wx" });
  writeFileSync(apiFile(dir), files.api, { flag: "wx" });
  return { status: 0, stdout: summary(slot), stderr: "" };
}

function show(cwd: string): Output {
  const top = realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]).trim());
  const [main] = worktrees(cwd);
  if (top === main) return { status: 0, stdout: summary(0), stderr: "" };
  const slot = slotOf(read(apiFile(top)) ?? "");
  if (slot === undefined)
    return fail(
      1,
      "この worktree には slot を割り当てていない。`node tools/scripts/src/dev-ports/cli.ts assign <worktree>` を実行する",
    );
  return { status: 0, stdout: summary(slot), stderr: "" };
}

function main(args: readonly string[]): Output {
  const cwd = process.cwd();
  const [command, target, ...rest] = args;
  if (rest.length > 0) return fail(2, usage.trim());
  if (command === "assign") return assign(cwd, target);
  if (command === "show" && target === undefined) return show(cwd);
  return fail(2, usage.trim());
}

let output: Output;
try {
  output = main(process.argv.slice(2));
} catch (error) {
  // git か、ファイルの書き込みの失敗。git は理由を stderr に出している。
  output = fail(2, error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error));
}
process.stdout.write(output.stdout);
process.stderr.write(output.stderr);
process.exitCode = output.status;
