// The real jactionlint and zizmor pinned in mise.toml, through sh/lint-workflows.sh, with the jactionlint
// configuration of this repository, on workflows written here in a sandbox repository.
// Reads mise.toml, mise.lock, .mise/locks/ and .github/jactionlint.yaml of the workspace, the inputs of the
// test-tools target (tools/scripts/package.json). How the linters are called is in lint-workflows.test.ts.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, miseDirs, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const script = join(import.meta.dirname, "../../sh/lint-workflows.sh");
const workspace = join(import.meta.dirname, "../../../..");

let box: Sandbox;
let repo: string;
const git = (...args: string[]): string => gitIn(repo, args).trim();
const lint = () => runIn(repo, "sh", [script], { env: miseDirs() });

// A workflow that passes both tools, with `steps` as the steps of its job, tracked from now on.
const workflow = (steps: string): void => {
  writeFileSync(
    join(repo, ".github/workflows/test.yml"),
    [
      "name: Test",
      "on:",
      "  pull_request:",
      "permissions:",
      "  contents: read",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-26.04",
      "    steps:",
      steps,
      "",
    ].join("\n"),
  );
  git("add", ".github/workflows/test.yml");
};

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  for (const file of ["mise.toml", "mise.lock"]) cpSync(join(workspace, file), join(repo, file));
  // `mise exec` installs every missing tool in mise.toml, and Semgrep installs from .mise/locks/.
  cpSync(join(workspace, ".mise/locks"), join(repo, ".mise/locks"), { recursive: true });
  mkdirSync(join(repo, ".github/workflows"), { recursive: true });
  // The profile in the config decides which rules run, so the test checks the same rules as the repository.
  cpSync(join(workspace, ".github/jactionlint.yaml"), join(repo, ".github/jactionlint.yaml"));
  git("add", "-A");
  git("commit", "-qm", "base");
}, 300_000);
afterAll(() => {
  box.remove();
});

describe("本物の jactionlint と zizmor による lint-workflows.sh", () => {
  it("追跡された workflow がないとき通すこと", () => {
    expect(lint().status).toBe(0);
  }, 300_000);

  it("きれいな workflow を通すこと", () => {
    workflow("      - run: echo ok");
    expect(lint().status).toBe(0);
  }, 300_000);

  it("jactionlint が式の中の未定義の step を見つけること", () => {
    workflow(
      [
        '      - run: echo "$OUT"',
        "        env:",
        "          OUT: ${{ steps.missing.outputs.value }}",
      ].join("\n"),
    );
    expect(lint().status).toBe(1);
  }, 300_000);

  it("jactionlint の shellcheck が run: の中の引用符のない変数を見つけること", () => {
    workflow("      - run: echo $HOME");
    expect(lint().status).toBe(1);
  }, 300_000);

  it("zizmor が persist-credentials: false のない checkout を見つけること", () => {
    workflow("      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1");
    expect(lint().status).toBe(1);
  }, 300_000);

  // An attacker-controlled value expanded into a shell script. Both tools report it.
  it("run: に展開された PR title を見つけること", () => {
    workflow('      - run: echo "${{ github.event.pull_request.title }}"');
    expect(lint().status).toBe(1);
  }, 300_000);

  it("追跡されていない workflow を無視すること", () => {
    workflow("      - run: echo ok");
    writeFileSync(
      join(repo, ".github/workflows/scratch.yml"),
      "name: Scratch\non:\n  pull_request:\njobs:\n  x:\n    runs-on: ubuntu-26.04\n    steps:\n      - run: echo $HOME\n",
    );
    expect(lint().status).toBe(0);
  }, 300_000);
});
