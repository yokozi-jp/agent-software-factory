// Process tests for the repo-policy entry point: a real git repository in the sandbox, built from the
// passing fixture, to exit code and output. Which files fail and what the messages say is in the test file of each
// rule (tooling.test.ts, modules.test.ts ...).
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";
import { passingRepo } from "./fixtures/passing-repo.ts";

const cli = join(import.meta.dirname, "cli.ts");
const missingHeading =
  'repo-policy: lefthook.yml cites the heading "Ubuntu の初期セットアップ" in docs/local-env-setup/setup.md, which has no such heading.\n';

let box: Sandbox;
let repo: string;

const git = (...args: string[]): string => gitIn(repo, args);
const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};
const policy = (args: string[] = [], dir = repo) => runIn(dir, process.execPath, [cli, ...args]);

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  for (const [path, text] of Object.entries(passingRepo)) {
    write(path, text);
    if (path.endsWith(".sh")) chmodSync(join(repo, path), 0o755);
  }
  // A citation of a heading, so that a case can break it by editing setup.md alone.
  appendFileSync(
    join(repo, "lefthook.yml"),
    '# docs/local-env-setup/setup.md ("Ubuntu の初期セットアップ")\n',
  );
  git("add", "-A");
  git("commit", "-qm", "base");
});
afterAll(() => {
  box.remove();
});
// Every case starts from the base commit, without untracked files.
beforeEach(() => {
  git("reset", "-q", "--hard");
  git("clean", "-qfdx");
});

describe("repo-policy", () => {
  it("is silent and exits 0 on a repository that keeps every rule, in both modes", () => {
    expect(policy()).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(policy(["staged"])).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("checks the whole repository when run from a subdirectory", () => {
    write("docs/adr/0001-duplicate.md", "# x\n");
    git("add", "-A");
    expect(policy([], join(repo, "apps/api")).status).toBe(1);
  });

  it("prints each failure on stderr and exits 1", () => {
    write("docs/adr/0002-duplicate.md", "# x\n");
    write(".node-version", "25\n");
    git("add", "-A");
    const result = policy();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "repo-policy: package.json engines.node (24) must be Node.js 25, the major of .node-version (docs/adr/0013).\n",
    );
    expect(result.stderr).toContain(
      "repo-policy: ADR 0002 is used by more than one file: docs/adr/0002-duplicate.md docs/adr/0002-nx.md\n",
    );
  });

  it("checks the working tree without staged, and only what is staged with it", () => {
    // Someone is rewriting setup.md and has not staged it: the heading that lefthook.yml cites is gone.
    write("docs/local-env-setup/setup.md", "# Setup\n\n## 3. 書き直し中\n");
    expect(policy()).toEqual({ status: 1, stdout: "", stderr: missingHeading });
    expect(policy(["staged"])).toEqual({ status: 0, stdout: "", stderr: "" });
    git("add", "-A");
    expect(policy(["staged"])).toEqual({ status: 1, stdout: "", stderr: missingHeading });
  });

  it("reads the mode of a shell script from the index in both modes", () => {
    const message =
      "repo-policy: tools/scripts/sh/guard-push.sh is not executable in git. Run `chmod +x tools/scripts/sh/guard-push.sh` and stage it again.\n";
    chmodSync(join(repo, "tools/scripts/sh/guard-push.sh"), 0o644);
    git("add", "-A");
    chmodSync(join(repo, "tools/scripts/sh/guard-push.sh"), 0o755);
    expect(policy()).toEqual({ status: 1, stdout: "", stderr: message });
    expect(policy(["staged"])).toEqual({ status: 1, stdout: "", stderr: message });
  });

  it("refuses an untracked .vite-hooks directory", () => {
    mkdirSync(join(repo, ".vite-hooks"));
    expect(policy()).toEqual({
      status: 1,
      stdout: "",
      stderr:
        "repo-policy: .vite-hooks exists. Git hooks are managed by lefthook.yml (docs/adr/0001).\n",
    });
  });

  it("checks untracked steering files in both modes, but not ignored ones", () => {
    write(".kiro/steering/broken.md", "no frontmatter\n");
    const message =
      "repo-policy: .kiro/steering/broken.md: must start with a frontmatter block (docs/knowledge/steering-authoring.md)\n";
    expect(policy()).toEqual({ status: 1, stdout: "", stderr: message });
    expect(policy(["staged"])).toEqual({ status: 1, stdout: "", stderr: message });
    write(".gitignore", ".kiro/steering/broken.md\n");
    git("add", ".gitignore");
    expect(policy(["staged"])).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("copies an untracked steering file in a subdirectory into the staged tree", () => {
    write(".kiro/steering/sub/broken.md", "no frontmatter\n");
    expect(policy(["staged"])).toEqual({
      status: 1,
      stdout: "",
      stderr:
        "repo-policy: .kiro/steering/sub/broken.md: must start with a frontmatter block (docs/knowledge/steering-authoring.md)\n",
    });
  });

  it("refuses an unknown argument", () => {
    expect(policy(["stage"])).toEqual({
      status: 2,
      stdout: "",
      stderr: "repo-policy: unknown argument `stage`. Usage: cli.ts [staged]\n",
    });
  });
});
