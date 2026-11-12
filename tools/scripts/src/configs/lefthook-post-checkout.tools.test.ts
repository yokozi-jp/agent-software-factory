// The post-checkout job of lefthook.yml (Issue #740): the `run` string is the only part that the tests of dev-ports/cli.ts do not
// reach. It runs on every checkout and switch, so it must start node only for a first argument of zeros, which is what
// `git worktree add` passes (https://git-scm.com/docs/githooks), and it must end with 0 whatever node does. Reads lefthook.yml
// of the workspace, an input of the test-tools target (package.json). node is a stand-in that records its arguments: the real
// entry would assign ports to a worktree of this repository.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { isObject } from "../checks/json.ts";
import { runIn, sandbox, type Sandbox } from "../test/sandbox.ts";
import { stubDir, withPath } from "../test/stubs.ts";

const workspace = join(import.meta.dirname, "../../../..");
const nullRef = "0".repeat(40);

// The `run` of the job `dev-ports` of the hook `post-checkout`, with {1} (lefthook's first git argument) not yet replaced.
function jobRun(): string {
  const config: unknown = parse(readFileSync(join(workspace, "lefthook.yml"), "utf8"));
  const hook = isObject(config) ? config["post-checkout"] : undefined;
  const jobs = isObject(hook) ? hook["jobs"] : undefined;
  const job = (Array.isArray(jobs) ? jobs : [])
    .filter(isObject)
    .find((candidate) => candidate["name"] === "dev-ports");
  expect(job?.["run"]).toBeTypeOf("string");
  return String(job?.["run"]);
}

let box: Sandbox;
let work: string;
let calls: string;
let stubs = 0;

beforeAll(() => {
  box = sandbox();
  work = join(box.root, "work");
  calls = join(work, "node-calls");
  mkdirSync(work, { recursive: true });
});
afterAll(() => {
  box.remove();
});

// A directory with a stand-in `node`, to put first on PATH.
const nodeThat = (body: string): string => stubDir(box.root, `bin-${stubs++}`, { node: body });
const recording = (): string => nodeThat(`echo "$@" >> ${JSON.stringify(calls)}`);
const recorded = (): string => (existsSync(calls) ? readFileSync(calls, "utf8") : "");

// What lefthook does with {1}: the argument of git goes there, and sh runs the string in the repository.
function runJob(argument: string, node: string) {
  rmSync(calls, { force: true });
  const command = jobRun().replaceAll("{1}", argument);
  return runIn(work, "sh", ["-c", command], { env: { PATH: withPath(node) } });
}

describe("lefthook.yml の post-checkout の dev-ports の run", () => {
  it("ゼロだけの引数 (git worktree add の null ref) のとき、入口に hook と引数を渡して node を呼ぶこと", () => {
    const result = runJob(nullRef, recording());
    expect(result.status).toBe(0);
    expect(recorded()).toBe(`tools/scripts/src/dev-ports/cli.ts hook ${nullRef}\n`);
  });

  // 通常の checkout と switch は、前の HEAD を渡す。そのたびに node を起動しない。
  it.each([
    ["通常の前の HEAD", "14c74576e7421e12e79ab2546d7135e353a4a56f"],
    ["空", ""],
    ["0 でない文字だけの文字列", "abc"],
  ])("%s のとき、node を起動しないこと", (_, argument) => {
    const result = runJob(argument, recording());
    expect(result.status).toBe(0);
    expect(recorded()).toBe("");
  });

  // 形 (ゼロだけ) の判定は run が、長さ (40 か 64) の判定は入口の isNullRef が持つ。run は長さの違うゼロも入口へ渡す。
  it("ゼロだけで長さが違う引数は、入口に渡すこと (長さは入口が断る)", () => {
    runJob("0".repeat(39), recording());
    expect(recorded()).toBe(`tools/scripts/src/dev-ports/cli.ts hook ${"0".repeat(39)}\n`);
  });

  // git は失敗した post-checkout を git worktree add の失敗にする。入口が動く前の失敗 (node がない、入口がない) も 0 にする。
  it("node が失敗しても、終了コード 0 で終わること", () => {
    const result = runJob(nullRef, nodeThat("echo 'node: cannot start' >&2\nexit 1"));
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("node: cannot start");
  });

  // 偽の node はスクリプトの引数を見ない。入口のファイルがないことは、本物の node で確かめる。作業ディレクトリは空で、
  // run が相対パスで指す入口 (tools/scripts/src/dev-ports/cli.ts) がない。
  it("入口のファイルがなくても (本物の node)、終了コード 0 で終わること", () => {
    const empty = join(box.root, "empty");
    mkdirSync(empty, { recursive: true });
    const command = jobRun().replaceAll("{1}", nullRef);
    const result = runIn(empty, "sh", ["-c", command]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Cannot find module");
  });
});
