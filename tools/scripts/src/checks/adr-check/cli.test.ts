// Process tests for the adr-check entry point: argv, stdin, the environment and a real git repository in
// the sandbox, to exit code and output. Which files warn and what the messages say is in rules.test.ts.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");
const zero = "0".repeat(40);
// The variables adr-check reads, cleared as on a developer machine (Vitest itself may run in CI).
const local = { ADR_ACK: "", GITHUB_ACTIONS: "", GITHUB_BASE_REF: "" };

let box: Sandbox;
let repo: string;
let n = 0;

const git = (...args: string[]): string => gitIn(repo, args).trim();
// A new branch from origin/main with one commit that changes (or adds) each path. Returns the commit.
const change = (...paths: string[]): string => {
  n += 1;
  git("switch", "-q", "-C", `case-${n}`, "origin/main");
  for (const path of paths) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    appendFileSync(join(repo, path), `${n}\n`);
  }
  git("add", "-A");
  git("commit", "-qm", `case ${n}`);
  return git("rev-parse", "HEAD");
};
const adrCheck = (dir: string, args: string[] = [], env: Record<string, string> = {}, input = "") =>
  runIn(dir, process.execPath, [cli, ...args], { env: { ...local, ...env }, input });

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  mkdirSync(join(repo, "docs/adr"), { recursive: true });
  appendFileSync(join(repo, "package.json"), "{}\n");
  appendFileSync(join(repo, "docs/adr/0001-a.md"), "base\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
});
afterAll(() => {
  box.remove();
});

describe("adr-check", () => {
  it("判断に関わる変更がないとき、何も出力せず 0 で終了すること", () => {
    change("README.md");
    expect(adrCheck(repo)).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("ADR なしで判断のファイルを変えたとき、stderr に警告して 0 で終了すること", () => {
    change("package.json", "src/index.ts");
    const result = adrCheck(repo);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("adr-check: warning");
    expect(result.stderr).toContain("  - package.json\n");
    expect(result.stderr).not.toContain("src/index.ts");
  });

  it("変更が ADR を足すとき、何も出力しないこと", () => {
    change("package.json", "docs/adr/0002-new.md");
    expect(adrCheck(repo)).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("ADR_ACK=1 のとき、何も出力しないこと", () => {
    change("package.json");
    expect(adrCheck(repo, [], { ADR_ACK: "1" })).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("origin/$GITHUB_BASE_REF と比べ、GitHub Actions では annotation を書くこと", () => {
    change("package.json");
    const result = adrCheck(repo, [], { GITHUB_ACTIONS: "true", GITHUB_BASE_REF: "main" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning title=adr-check::");
    expect(result.stderr).toBe("");
  });

  it("pre-push は HEAD ではなく、stdin の push する commit ごとに比べること", () => {
    const withAdr = change("nx.json", "docs/adr/0002-new.md");
    const withoutAdr = change("package.json");
    git("switch", "-q", "main");
    const push = (...tips: string[]) =>
      tips.map((tip) => `refs/heads/x ${tip} refs/heads/x ${zero}\n`).join("");

    expect(adrCheck(repo, ["pre-push"], {}, push(withAdr)).stderr).toBe("");
    const both = adrCheck(repo, ["pre-push"], {}, push(withAdr, withoutAdr));
    expect(both.status).toBe(0);
    expect(both.stderr).toContain("  - package.json\n");
    expect(both.stderr).not.toContain("nx.json");
    expect(
      adrCheck(repo, ["pre-push"], {}, `(delete) ${zero} refs/heads/x ${withoutAdr}\n`).stderr,
    ).toBe("");
  });

  it("origin/main がないとき、理由を述べて通すこと", () => {
    const other = join(box.root, "no-origin");
    gitIn(other, ["init", "-q", "-b", "main"]);
    gitIn(other, ["commit", "-q", "--allow-empty", "-m", "base"]);
    const result = adrCheck(other);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("adr-check: skipped. origin/main does not exist here");
    const ci = adrCheck(other, [], { GITHUB_ACTIONS: "true" });
    expect(ci.stdout).toContain("::notice title=adr-check::skipped.");
  });

  it("merge base のない浅い clone のとき、理由を述べて通すこと", () => {
    // origin/main moves on, so the branch's parent is not in a depth-1 clone.
    git("switch", "-q", "main");
    appendFileSync(join(repo, "more.txt"), "more\n");
    git("add", "-A");
    git("commit", "-qm", "advance");
    change("package.json");
    const branch = `case-${n}`;
    const shallow = join(box.root, "shallow");
    gitIn(shallow, ["clone", "-q", "--depth", "1", "--no-single-branch", `file://${repo}`, "."]);
    gitIn(shallow, ["switch", "-q", branch]);
    const result = adrCheck(shallow);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("adr-check: skipped.");
    expect(result.stderr).not.toContain("warning");
  });
});
