// Process tests for the retry-web-test entry point: a stand-in for `nx` that plays a list of runs, to exit code and
// output. Which failures are run again is in rules.test.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");

// The stand-in plays plan.json: run n (counted in runs.txt) prints plan[n].stdout and plan[n].stderr, and exits
// with plan[n].status. A run past the end of the plan exits 99.
const standIn = `
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const plan = JSON.parse(readFileSync("plan.json", "utf8"));
const n = existsSync("runs.txt") ? readFileSync("runs.txt", "utf8").length : 0;
appendFileSync("runs.txt", "x");
const run = plan[n];
if (run === undefined) process.exit(99);
process.stdout.write(run.stdout ?? "");
process.stderr.write(run.stderr ?? "");
process.exit(run.status);
`;

const iframe = 'The iframe "/work/a.test.tsx" did not become ready within 60000ms.';
const failed = (...tasks: string[]): string =>
  `Failed tasks:\n\n${tasks.map((task) => `- ${task}`).join("\n")}\n`;
const flaky = { status: 1, stdout: `${iframe}\n${failed("web:test")}` };

let box: Sandbox;
let dir: string;

const play = (...plan: object[]): void =>
  writeFileSync(join(dir, "plan.json"), JSON.stringify(plan));
const runs = (): number => {
  try {
    return readFileSync(join(dir, "runs.txt"), "utf8").length;
  } catch {
    return 0;
  }
};
const retry = (env: Record<string, string> = {}) =>
  runIn(dir, process.execPath, [cli, process.execPath, "stand-in.mjs"], {
    env: { GITHUB_ACTIONS: "", ...env },
  });

beforeAll(() => {
  box = sandbox();
});

afterAll(() => {
  box.remove();
});

beforeEach(() => {
  // A directory of its own for each test: the run counter is a file in it.
  dir = join(box.root, `case-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir);
  writeFileSync(join(dir, "stand-in.mjs"), standIn);
});

describe("retry-web-test", () => {
  it("コマンドが成功したとき、1 回だけ流して出力をそのまま流すこと", () => {
    play({ status: 0, stdout: "all good\n", stderr: "a note\n" });
    const result = retry();
    expect(result).toEqual({ status: 0, stdout: "all good\n", stderr: "a note\n" });
    expect(runs()).toBe(1);
  });

  it("読み込みの失敗の後に流し直し、2 回目が成功すれば成功にすること", () => {
    play(flaky, { status: 0, stdout: "second run\n" });
    const result = retry();
    expect(result.status).toBe(0);
    expect(runs()).toBe(2);
    // The output of the first run, the notice, then the output of the second run.
    expect(result.stdout).toBe(
      `${flaky.stdout}warning: web:test failed to load a test file (iframe did not become ready). ` +
        "Running the failed tasks once more; the tasks that passed come from the Nx cache. " +
        "This is the flaky failure of #523.\nsecond run\n",
    );
  });

  it("GitHub Actions では、流し直しの知らせを annotation にすること", () => {
    play(flaky, { status: 0 });
    expect(retry({ GITHUB_ACTIONS: "true" }).stdout).toContain("::warning title=web-test-flaky::");
  });

  it("3 回目は流さず、2 回目の終了コードで終わること", () => {
    play(flaky, { status: 3, stdout: "still broken\n" }, { status: 0 });
    const result = retry();
    expect(result.status).toBe(3);
    expect(runs()).toBe(2);
    expect(result.stdout).toContain("still broken\nThe second run failed too (exit 3).");
  });

  it("読み込みの失敗ではないとき、流し直さないこと", () => {
    play({ status: 4, stdout: `AssertionError\n${failed("web:test")}` }, { status: 0 });
    const result = retry();
    expect(result.status).toBe(4);
    expect(runs()).toBe(1);
    expect(result.stdout).not.toContain("warning");
  });

  it("別の task も落ちたとき、流し直さないこと", () => {
    play({ status: 1, stdout: `${iframe}\n${failed("web:test", "api:test")}` }, { status: 0 });
    expect(retry().status).toBe(1);
    expect(runs()).toBe(1);
  });

  it("標準エラーの読み込みの失敗も読むこと", () => {
    play({ status: 1, stderr: iframe, stdout: failed("web:test") }, { status: 0 });
    expect(retry().status).toBe(0);
    expect(runs()).toBe(2);
  });

  it("コマンドがなければ、使い方を述べて 2 で終わること", () => {
    const result = runIn(dir, process.execPath, [cli]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^usage: /);
  });

  it("コマンドが起動できなければ 127 で終わること", () => {
    const result = runIn(dir, process.execPath, [cli, "no-such-command-for-retry-web-test"]);
    expect(result.status).toBe(127);
    expect(result.stderr).toContain("no-such-command-for-retry-web-test:");
  });

  it("コマンドが signal で終わったら 1 で終わること", () => {
    // process.kill(process.pid) ends the stand-in with SIGTERM: no exit code.
    const result = runIn(dir, process.execPath, [
      cli,
      process.execPath,
      "-e",
      "process.kill(process.pid)",
    ]);
    expect(result.status).toBe(1);
  });
});
