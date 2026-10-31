// Process tests for the migration-compat entry point: a real git repository in the sandbox for the base and the pull
// request, and stub `pnpm` and `vp` that log what they are given. Which changes pass, fail or run is in rules.test.ts.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");
const migrations = "packages/db/migrations";
const seed = "packages/db/src/seed/index.ts";
const harness = "packages/db/src/testing/prepare-database.ts";
// The variables that cli.ts reads, cleared as on a developer machine (Vitest itself may run in CI).
const local = { GITHUB_ACTIONS: "", GITHUB_BASE_REF: "", RUNNER_TEMP: "" };

let box: Sandbox;
let repo: string;
let bin: string;
let temp: string;
let log: string;
let n = 0;

const git = (...args: string[]): string => gitIn(repo, args).trim();
const write = (path: string, content: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
};
// The stubs append one line per call: the command, its arguments, the directory, the variable, and whether the file
// that the pull request added is in the checkout that the command runs in (it must be the base's, where it is not).
const stub = (name: string): void => {
  const file = join(bin, name);
  writeFileSync(
    file,
    [
      "#!/bin/sh",
      `echo "${name} $* | cwd=$PWD | files=$MIGRATION_COMPAT_FILES | pr_file=$(ls $(git rev-parse --show-toplevel)/${migrations} | grep -c added)" >> "$STUB_LOG"`,
      `exit "\${STUB_${name.toUpperCase()}_STATUS:-0}"`,
    ].join("\n"),
  );
  chmodSync(file, 0o755);
};
// A new branch from origin/main with the given files written, as the pull request. Returns nothing; HEAD is the branch.
const pullRequest = (files: Record<string, string>): void => {
  n += 1;
  git("switch", "-q", "-C", `case-${n}`, "origin/main");
  for (const [path, content] of Object.entries(files)) write(path, content);
  git("add", "-A");
  git("commit", "-qm", `case ${n}`);
};
// origin/main becomes the full base minus the given files.
const baseWithout = (path: string): void => {
  n += 1;
  git("switch", "-q", "-C", `poor-${n}`, "main");
  git("rm", "-q", path);
  git("commit", "-qm", `without ${path}`);
  git("update-ref", "refs/remotes/origin/main", "HEAD");
};
const check = (status: Record<string, string> = {}) =>
  runIn(repo, process.execPath, [cli], {
    env: {
      ...local,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      STUB_LOG: log,
      TMPDIR: temp,
      ...status,
    },
  });
const calls = (): string[] =>
  existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  bin = join(box.root, "bin");
  temp = join(box.root, "tmp");
  log = join(box.root, "stub.log");
  mkdirSync(bin);
  mkdirSync(temp);
  stub("pnpm");
  stub("vp");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  write(`${migrations}/1_base.sql`, "base\n");
  write("apps/api/package.json", "{}\n");
  write(seed, "export {};\n");
  write(harness, 'const name = "MIGRATION_COMPAT_FILES";\n');
  git("add", "-A");
  git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
});
beforeEach(() => {
  writeFileSync(log, "");
  // Every case starts from the full base (the `main` branch); a case that needs a poorer base makes it with baseWithout.
  git("update-ref", "refs/remotes/origin/main", "refs/heads/main");
});
afterAll(() => {
  box.remove();
});

describe("migration-compat", () => {
  it("passes without running anything when the pull request adds no migration", () => {
    pullRequest({ "README.md": "x\n" });
    const result = check();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("adds no migration");
    expect(calls()).toEqual([]);
  });

  it("fails before running anything when a migration of the base is changed", () => {
    pullRequest({ [`${migrations}/1_base.sql`]: "changed\n" });
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${migrations}/1_base.sql (changed)`);
    expect(calls()).toEqual([]);
  });

  it("fails before running anything when a migration of the base is deleted", () => {
    n += 1;
    git("switch", "-q", "-C", `case-${n}`, "origin/main");
    git("rm", "-q", `${migrations}/1_base.sql`);
    git("commit", "-qm", "delete");
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("(deleted)");
    expect(calls()).toEqual([]);
  });

  it("passes with a ::notice:: in GitHub Actions when the base has no seed entry", () => {
    baseWithout(seed);
    pullRequest({ [`${migrations}/2_added.sql`]: "x\n" });
    const result = check({ GITHUB_ACTIONS: "true" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::notice title=migration-compat::");
    expect(result.stdout).toContain(seed);
    expect(calls()).toEqual([]);
  });

  it("passes with a notice when the base's harness does not read the variable", () => {
    baseWithout(harness);
    pullRequest({ [`${migrations}/2_added.sql`]: "x\n" });
    const result = check();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(harness);
    expect(calls()).toEqual([]);
  });
});

// The base has the seed and the harness, so the tests run.
describe("migration-compat with a base that has the seed and the harness", () => {
  it("installs in a worktree of the base, runs the integration project with the added files, and removes the worktree", () => {
    pullRequest({ [`${migrations}/2_added.sql`]: "x\n" });
    const result = check();
    expect(result).toMatchObject({ status: 0, stderr: "" });
    const [install, test] = calls();
    expect(install).toMatch(
      /^pnpm install --frozen-lockfile \| cwd=.*\/tmp\/migration-compat-[^/|]+ \|/,
    );
    expect(install).toContain("pr_file=0");
    expect(test).toMatch(
      /^vp test run --project integration \| cwd=.*\/tmp\/migration-compat-[^/]+\/apps\/api \|/,
    );
    expect(test).not.toContain("--coverage");
    expect(test).toContain(`files=${JSON.stringify([join(repo, `${migrations}/2_added.sql`)])} `);
    // The worktree is the base's: it does not have the added file.
    expect(test).toContain("pr_file=0");
    expect(calls()).toHaveLength(2);
    expect(readdirSync(temp)).toEqual([]);
    expect(git("worktree", "list").split("\n")).toHaveLength(1);
  });

  it("exits 1 and still removes the worktree when the integration tests fail", () => {
    pullRequest({ [`${migrations}/2_added.sql`]: "x\n" });
    const result = check({ STUB_VP_STATUS: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("would not work");
    expect(readdirSync(temp)).toEqual([]);
    expect(git("worktree", "list").split("\n")).toHaveLength(1);
  });

  it("exits 2 without running the tests when the install fails", () => {
    pullRequest({ [`${migrations}/2_added.sql`]: "x\n" });
    const result = check({ STUB_PNPM_STATUS: "1" });
    expect(result.status).toBe(2);
    expect(calls()).toHaveLength(1);
    expect(readdirSync(temp)).toEqual([]);
  });

  it("exits 2 when there is no base to compare with", () => {
    pullRequest({ [`${migrations}/2_added.sql`]: "x\n" });
    const result = check({ GITHUB_BASE_REF: "no-such-branch" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("merge base");
  });
});
