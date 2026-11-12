// Process tests for the renovate-preview entry point: argv and the log file, to exit code and output.
// What the preview lists is in rules.test.ts.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");

let box: Sandbox;
const run = (...args: string[]) => runIn(box.root, process.execPath, [cli, ...args]);

beforeAll(() => {
  box = sandbox();
});
afterAll(() => {
  box.remove();
});

describe("renovate-preview", () => {
  it("ログファイルがないとき、使い方の誤りとすること", () => {
    const result = run();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: node tools/scripts/src/checks/renovate-preview/cli.ts");
  });

  it("ログにブランチの一覧がないとき失敗すること", () => {
    writeFileSync(join(box.root, "empty.log"), 'not json\n{"msg":"other"}\n');
    const result = run("empty.log");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("renovate-preview: no branch list in the log.");
  });

  it("ログのブランチを出力すること", () => {
    const entry = {
      msg: "branches",
      branches: [{ branchName: "renovate/x", prTitle: "chore(deps): update x to v2" }],
    };
    writeFileSync(join(box.root, "renovate.log"), `${JSON.stringify(entry)}\n`);
    expect(run("renovate.log")).toEqual({
      status: 0,
      stdout: "renovate/x\n  chore(deps): update x to v2\n  automerge: no\n\n1 branch(es)\n",
      stderr: "",
    });
  });

  // A line over the 512 MB that a JavaScript string holds is not tested: the file would be as large as the log.
  it("ほかの項目の大きな行の中から、ブランチの一覧を見つけること", () => {
    const big = JSON.stringify({ msg: "other", data: "x".repeat(10_000_000) });
    const entry = { msg: "branches", branches: [{ branchName: "b", prTitle: "t" }] };
    writeFileSync(join(box.root, "big.log"), `${big}\n${JSON.stringify(entry)}\n${big}\n`);
    expect(run("big.log").stdout).toBe("b\n  t\n  automerge: no\n\n1 branch(es)\n");
  });
});
