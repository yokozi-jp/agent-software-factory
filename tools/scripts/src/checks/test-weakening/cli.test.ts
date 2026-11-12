// Process tests for the test-weakening entry point: argv, stdin, the environment and a real git repository in
// the sandbox, to exit code and output. Which changes warn and what the messages say is in rules.test.ts.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");
const zero = "0".repeat(40);
// The variables test-weakening reads, cleared as on a developer machine (Vitest itself may run in CI).
const local = { TESTS_ACK: "", GITHUB_ACTIONS: "", GITHUB_BASE_REF: "" };
const tests = (...titles: string[]): string =>
  titles.map((title) => `it("${title}", () => {});\n`).join("");

let box: Sandbox;
let repo: string;
let n = 0;

const git = (...args: string[]): string => gitIn(repo, args).trim();
const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};
// A new branch from origin/main with one commit made by `edit`. Returns the commit.
const change = (edit: () => void): string => {
  n += 1;
  git("switch", "-q", "-C", `case-${n}`, "origin/main");
  edit();
  git("add", "-A");
  git("commit", "-qm", `case ${n}`, "--allow-empty");
  return git("rev-parse", "HEAD");
};
const check = (dir: string, args: string[] = [], env: Record<string, string> = {}, input = "") =>
  runIn(dir, process.execPath, [cli, ...args], { env: { ...local, ...env }, input });
const silent = { status: 0, stdout: "", stderr: "" };

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  write("src/a.test.ts", tests("a1", "a2"));
  write("src/b.test.ts", tests("b1", "b2", "b3"));
  write("src/app.ts", "export const x = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
});
afterAll(() => {
  box.remove();
});

describe("test-weakening", () => {
  it("テストが足された、またはコードが変わったとき、何も出力せず 0 で終了すること", () => {
    change(() => {
      write("src/a.test.ts", tests("a1", "a2", "a3"));
      write("src/c.test.ts", tests("c1"));
      write("src/app.ts", "export const x = 2;\n");
    });
    expect(check(repo)).toEqual(silent);
  });

  it("テストファイルが削除された、またはテストケースが減ったとき、stderr に警告して 0 で終了すること", () => {
    change(() => {
      rmSync(join(repo, "src/a.test.ts"));
      write("src/b.test.ts", tests("b1"));
    });
    const result = check(repo);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("test-weakening: warning");
    expect(result.stderr).toContain(
      "  - src/a.test.ts (deleted)\n  - src/b.test.ts (3 -> 1 test cases)\n",
    );
  });

  it("名前を変えたテストファイルを、元のファイルと比べること", () => {
    change(() => {
      git("mv", "src/b.test.ts", "src/renamed.test.ts");
      write("src/renamed.test.ts", tests("b1", "b2"));
    });
    const result = check(repo);
    expect(result.stderr).toContain("  - src/renamed.test.ts (3 -> 2 test cases)\n");
    expect(result.stderr).not.toContain("deleted");
  });

  it("TESTS_ACK=1 のとき、何も出力しないこと", () => {
    change(() => {
      rmSync(join(repo, "src/a.test.ts"));
    });
    expect(check(repo, [], { TESTS_ACK: "1" })).toEqual(silent);
  });

  it("origin/$GITHUB_BASE_REF と比べ、GitHub Actions では annotation を書くこと", () => {
    change(() => {
      rmSync(join(repo, "src/a.test.ts"));
    });
    const result = check(repo, [], { GITHUB_ACTIONS: "true", GITHUB_BASE_REF: "main" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning title=test-weakening::");
    expect(result.stderr).toBe("");
  });

  it("pre-push は HEAD ではなく、stdin の push する commit ごとに比べること", () => {
    const deletes = change(() => {
      rmSync(join(repo, "src/a.test.ts"));
    });
    const adds = change(() => {
      write("src/d.test.ts", tests("d1"));
    });
    git("switch", "-q", "main");
    const push = (...tips: string[]) =>
      tips.map((tip) => `refs/heads/x ${tip} refs/heads/x ${zero}\n`).join("");

    expect(check(repo, ["pre-push"], {}, push(adds))).toEqual(silent);
    const both = check(repo, ["pre-push"], {}, push(adds, deletes, deletes));
    expect(both.status).toBe(0);
    expect(both.stderr.match(/src\/a\.test\.ts \(deleted\)/g)).toHaveLength(1);
    expect(check(repo, ["pre-push"], {}, `(delete) ${zero} refs/heads/x ${deletes}\n`)).toEqual(
      silent,
    );
  });

  it("origin/main がないとき、理由を述べて通すこと", () => {
    const other = join(box.root, "no-origin");
    gitIn(other, ["init", "-q", "-b", "main"]);
    gitIn(other, ["commit", "-q", "--allow-empty", "-m", "base"]);
    const result = check(other);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("test-weakening: skipped. origin/main does not exist here");
    const ci = check(other, [], { GITHUB_ACTIONS: "true" });
    expect(ci.stdout).toContain("::notice title=test-weakening::skipped.");
  });

  it("merge base のない浅い clone のとき、理由を述べて通すこと", () => {
    // origin/main moves on, so the branch's parent is not in a depth-1 clone.
    git("switch", "-q", "main");
    write("more.txt", "more\n");
    git("add", "-A");
    git("commit", "-qm", "advance");
    change(() => {
      rmSync(join(repo, "src/a.test.ts"));
    });
    const branch = `case-${n}`;
    const shallow = join(box.root, "shallow");
    gitIn(shallow, ["clone", "-q", "--depth", "1", "--no-single-branch", `file://${repo}`, "."]);
    gitIn(shallow, ["switch", "-q", branch]);
    const result = check(shallow);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("test-weakening: skipped.");
    expect(result.stderr).not.toContain("warning");
  });
});
