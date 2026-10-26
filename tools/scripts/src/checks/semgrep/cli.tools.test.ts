// The real Semgrep pinned in mise.toml, on a repository in the sandbox, with local rules (SEMGREP_RULES)
// instead of the Registry, so the result depends only on the flags in rules.ts and the pinned Semgrep.
// Reads mise.toml, mise.lock and .mise/locks/ of the workspace, the inputs of the test-tools target
// (tools/scripts/package.json). How the arguments are built is in cli.test.ts.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, miseDirs, runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");
const workspace = join(import.meta.dirname, "../../../../..");

let box: Sandbox;
let repo: string;
let rules: string;
let n = 0;

const git = (...args: string[]): string => gitIn(repo, args).trim();
// A new branch from origin/main with one commit that writes each file under src/.
const change = (files: Record<string, string>): void => {
  n += 1;
  git("switch", "-q", "-C", `case-${n}`, "origin/main");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, "src", name), text);
  git("add", "-A");
  git("commit", "-qm", `case ${n}`);
};
const scan = (rulesFile = rules) =>
  runIn(repo, process.execPath, [cli], {
    env: { ...miseDirs(), GITHUB_BASE_REF: "", SEMGREP_RULES: rulesFile },
  });

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  rules = join(box.root, "rules.yml");
  writeFileSync(
    rules,
    [
      "rules:",
      "  - id: test-no-eval",
      "    pattern: eval(...)",
      "    message: eval runs a string as code",
      "    languages: [typescript]",
      "    severity: ERROR",
      "  - id: test-no-console",
      "    pattern: console.log(...)",
      "    message: console.log is a warning only",
      "    languages: [typescript]",
      "    severity: WARNING",
      "",
    ].join("\n"),
  );
  gitIn(repo, ["init", "-q", "-b", "main"]);
  for (const file of ["mise.toml", "mise.lock"]) cpSync(join(workspace, file), join(repo, file));
  cpSync(join(workspace, ".mise/locks"), join(repo, ".mise/locks"), { recursive: true });
  mkdirSync(join(repo, "src"));
  // A finding that is already on the base: left to the code scanning alerts.
  writeFileSync(join(repo, "src/old.ts"), "export const old = (s: string) => eval(s);\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
}, 300_000);
afterAll(() => {
  box.remove();
});

describe("semgrep with the real Semgrep", () => {
  it("fails on an ERROR finding that the branch adds", () => {
    change({ "bad.ts": "export const run = (s: string) => eval(s);\n" });
    expect(scan()).toMatchObject({ status: 1 });
  }, 300_000);

  it("passes a WARNING finding, a finding silenced with nosemgrep, and a finding already on the base", () => {
    change({
      "warn.ts": 'console.log("hi");\n',
      "ignored.ts":
        "export const run = (s: string) => eval(s); // nosemgrep: test-no-eval -- reason: test fixture\n",
    });
    expect(scan()).toMatchObject({ status: 0 });
  }, 300_000);

  it("reports a broken rule file with Semgrep's exit code, which the pre-push hook does not take for a finding", () => {
    const broken = join(box.root, "broken.yml");
    writeFileSync(broken, "rules: [\n");
    expect(scan(broken)).toMatchObject({ status: 7 });
  }, 300_000);
});
