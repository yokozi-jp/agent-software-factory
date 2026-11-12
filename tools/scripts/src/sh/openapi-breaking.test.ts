// Process tests for sh/openapi-breaking.sh in a sandboxed repository. A stub `mise` records how oasdiff is called, prints
// a report and returns the exit code chosen. The real oasdiff is in openapi-gate.tools.test.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";
import { onlyCommands, stubDir, withPath } from "../test/stubs.ts";

const script = join(import.meta.dirname, "../../sh/openapi-breaking.sh");

let box: Sandbox;
let repo: string;
let record: string;
let summary: string;
// The script, with a `mise` that appends its arguments to the record, prints a report and exits with `code`.
const compare = (args: string[], code = 0, env: Record<string, string> = {}) => {
  writeFileSync(record, "");
  const mise = `echo "$@" >> "${record}"\necho "the report"\nexit ${code}`;
  return runIn(repo, "sh", [script, ...args], {
    env: { PATH: withPath(stubDir(box.root, `mise-${code}`, { mise })), ...env },
  });
};
const calls = (): string => readFileSync(record, "utf8").trimEnd();

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  record = join(box.root, "record");
  summary = join(box.root, "summary");
  gitIn(repo, ["init", "-q", "-b", "main"]);
});
afterAll(() => {
  box.remove();
});

describe("openapi-breaking.sh", () => {
  it("origin/main の spec と作業ツリーを比べ、ERR のときだけ失敗すること", () => {
    const result = compare([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("the report");
    expect(calls()).toBe(
      "exec -- oasdiff breaking origin/main:apps/api/openapi.json apps/api/openapi.json --fail-on ERR",
    );
  });

  it("base と spec を引数に取ること", () => {
    expect(compare(["main", "other.json"]).status).toBe(0);
    expect(calls()).toBe("exec -- oasdiff breaking main:other.json other.json --fail-on ERR");
  });

  it("oasdiff が破壊的変更を報告したとき、2 段階で抜ける方法を示して失敗すること", () => {
    const result = compare([], 1);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("the report");
    expect(result.stderr).toContain("deprecated: true with x-sunset");
    expect(result.stderr).toContain("docs/web-api/versioning.md");
  });

  it("レポートがあるとき、job の要約に書くこと", () => {
    writeFileSync(summary, "");
    expect(compare([], 0, { GITHUB_STEP_SUMMARY: summary }).status).toBe(0);
    expect(readFileSync(summary, "utf8")).toContain("the report");
  });

  it("mise がないとき、検査を飛ばさずに失敗すること", () => {
    const path = onlyCommands(box.root, "no-mise", ["git", "sh", "mktemp", "rm", "cat"]);
    const result = runIn(repo, "sh", [script], { env: { PATH: path } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("openapi-breaking: mise is not installed");
  });
});
