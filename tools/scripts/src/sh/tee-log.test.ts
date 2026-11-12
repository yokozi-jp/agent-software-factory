// Process tests for sh/tee-log.sh, which runs a hook command, passes its output through, and keeps the same
// output in a log file, so that a push that fails after minutes can be read without running it again.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const script = join(import.meta.dirname, "../../sh/tee-log.sh");

let box: Sandbox;
beforeAll(() => {
  box = sandbox();
});
afterAll(() => {
  box.remove();
});

const tee = (args: string[]) =>
  runIn(box.root, "sh", [script, ...args], { env: { HOOK_LOG_DIR: join(box.root, "logs") } });
const log = (name: string): string => readFileSync(join(box.root, "logs", `${name}.log`), "utf8");

describe("tee-log.sh", () => {
  it("出力を stdout にそのまま渡し (stderr を合わせる)、ログに残して 0 で終了すること", () => {
    const result = tee(["ok", "sh", "-c", "echo out; echo err >&2"]);
    expect(result).toMatchObject({ status: 0, stdout: "out\nerr\n", stderr: "" });
    expect(log("ok")).toBe("out\nerr\n");
  });

  it("コマンドの終了コードで終了し、ログの場所を述べること", () => {
    const result = tee(["bad", "sh", "-c", "echo broken; exit 3"]);
    expect(result.status).toBe(3);
    expect(result.stdout).toContain("broken");
    expect(result.stderr).toContain(
      `tee-log: bad failed (exit 3). Output: ${join(box.root, "logs", "bad.log")}`,
    );
    expect(log("bad")).toBe("broken\n");
  });

  it("前の実行のログを上書きすること", () => {
    tee(["again", "echo", "first"]);
    tee(["again", "echo", "second"]);
    expect(log("again")).toBe("second\n");
  });

  it("名前とコマンドがないとき、使い方の誤りとすること", () => {
    expect(tee([]).status).toBe(2);
    expect(tee(["only-a-name"]).status).toBe(2);
  });
});
