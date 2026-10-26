// Regression test for test isolation (docs/tooling/ci.md ("スクリプトのテスト")).
// Git hooks run with GIT_DIR and GIT_INDEX_FILE exported, and from the working tree of the repository.
// A test that acts on either one changes the repository that runs the hook: on 2026-10-23 a test run from
// a pre-commit hook committed into this repository and pushed main (PR #10, commit 575c03a, describes it).
// This test reproduces that environment against a decoy repository with its own remote: it runs the
// other test files of this project with the hook variables pointing at the decoy and the decoy as the
// working directory, then checks that the decoy's refs, index, config and remote did not change. It
// fingerprints only the decoy, so a test that names another repository by absolute path (for example
// `git -C <this repository>` after a dynamic import of child_process) is not detected here; the lint
// rule on static imports and review guard that case (ADR 0024, "隔離"). The child runs only the `unit`
// project (vite.config.ts), so it cannot start this test again. A broken setup.ts or sandbox.ts damages
// only the sandbox. The child runs Vitest directly, the runner that `vp test` re-exports, because `vp`
// only starts inside a pnpm workspace and the working directory here is the decoy.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "./sandbox.ts";

const project = join(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const vitest = join(
  dirname(createRequire(require.resolve("vite-plus/package.json")).resolve("vitest/package.json")),
  "vitest.mjs",
);

let box: Sandbox;
let decoy: string;
let remote: string;

function fingerprint(): string {
  return [
    gitIn(decoy, ["for-each-ref", "--format=%(refname) %(objectname)"]),
    gitIn(decoy, ["rev-parse", "HEAD"]),
    gitIn(decoy, ["config", "--local", "--list"]),
    createHash("sha256")
      .update(readFileSync(join(decoy, ".git/index")))
      .digest("hex"),
    gitIn(remote, ["for-each-ref", "--format=%(refname) %(objectname)"]),
  ].join("\n");
}

beforeAll(() => {
  box = sandbox();
  decoy = join(box.root, "decoy");
  remote = join(box.root, "decoy-remote.git");
  gitIn(remote, ["init", "-q", "--bare"]);
  gitIn(decoy, ["init", "-q", "-b", "main"]);
  writeFileSync(join(decoy, "README.md"), "decoy\n");
  gitIn(decoy, ["add", "README.md"]);
  gitIn(decoy, ["commit", "-qm", "decoy"]);
  gitIn(decoy, ["remote", "add", "origin", remote]);
  gitIn(decoy, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
});
afterAll(() => {
  box.remove();
});

it("the other tests leave the repository they run from untouched, with Git hook variables set", () => {
  const before = fingerprint();
  // The same variables git exports to a pre-commit hook, pointing at the decoy instead of this repository.
  const hook = {
    GIT_DIR: join(decoy, ".git"),
    GIT_INDEX_FILE: join(decoy, ".git/index"),
    GIT_PREFIX: "",
  };
  const run = runIn(
    decoy,
    process.execPath,
    [vitest, "run", "--root", project, "--project", "unit", "--coverage.enabled=false"],
    { env: hook },
  );
  // On failure the diff shows the output of the child.
  expect(run).toMatchObject({ status: 0 });
  // Tests ran: a child that found no test files would leave the decoy untouched too.
  expect(stripVTControlCharacters(run.stdout)).toMatch(/Test Files\s+\d+ passed/);
  expect(fingerprint()).toBe(before);
}, 120_000);
