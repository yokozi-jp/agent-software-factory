// Process tests for the secret-scan entry point: a real git repository in the sandbox and a stub mise on
// PATH, which records how betterleaks would run and exits with STUB_EXIT. Whether the real betterleaks
// finds a secret with this repository's .betterleaks.toml is in cli.tools.test.ts.
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");
const zero = "0".repeat(40);
const flags = "--redact --no-banner --config .betterleaks.toml";

let box: Sandbox;
let repo: string;
let bin: string;
let calls: string;
let base: string;
let head: string;

const git = (...args: string[]): string => gitIn(repo, args).trim();
const scan = (args: string[], options: { input?: string; exit?: number; dir?: string } = {}) =>
  runIn(options.dir ?? repo, process.execPath, [cli, ...args], {
    input: options.input ?? "",
    env: { PATH: `${bin}:${process.env.PATH}`, STUB_EXIT: String(options.exit ?? 0) },
  });
// One line per betterleaks run: the directory it ran in, then the arguments of mise.
const recorded = (): string[] => {
  try {
    return readFileSync(calls, "utf8").split("\n").slice(0, -1);
  } catch {
    return [];
  }
};

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  bin = join(box.root, "bin");
  calls = join(box.root, "calls");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "mise"),
    `#!/bin/sh\n[ "$1" = --version ] && exit 0\necho "$PWD $*" >>'${calls}'\nexit "$STUB_EXIT"\n`,
  );
  chmodSync(join(bin, "mise"), 0o755);
  gitIn(repo, ["init", "-q", "-b", "main"]);
  mkdirSync(join(repo, "sub"));
  writeFileSync(join(repo, "sub/a.txt"), "a\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  base = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/sandbox/main", "HEAD");
  writeFileSync(join(repo, "b.txt"), "b\n");
  git("add", "-A");
  git("commit", "-qm", "head");
  head = git("rev-parse", "HEAD");
});
beforeEach(() => {
  rmSync(calls, { force: true });
});
afterAll(() => {
  box.remove();
});

describe("secret-scan", () => {
  it("scans the whole history from the repository top, and passes betterleaks' exit code on", () => {
    const result = scan(["all"], { dir: join(repo, "sub"), exit: 1 });
    expect(result).toEqual({
      status: 1,
      stdout: "secret-scan: all: scanning 2 commit(s) (full history)\n",
      stderr: "",
    });
    expect(recorded()).toEqual([`${repo} exec -- betterleaks git ${flags} .`]);
  });

  it("scans the working tree files", () => {
    expect(scan(["worktree"])).toEqual({
      status: 0,
      stdout: "secret-scan: worktree: scanning working tree files\n",
      stderr: "",
    });
    expect(recorded()).toEqual([`${repo} exec -- betterleaks dir ${flags} .`]);
  });

  it("scans a range of commits, and skips an empty one", () => {
    expect(scan(["range", base, head])).toEqual({
      status: 0,
      stdout: `secret-scan: range: scanning 1 commit(s) (${base}..${head})\n`,
      stderr: "",
    });
    expect(recorded()).toEqual([
      `${repo} exec -- betterleaks git ${flags} --log-opts=${base}..${head} .`,
    ]);
    rmSync(calls);
    expect(scan(["range", head, head])).toEqual({
      status: 0,
      stdout: "secret-scan: range: 0 commits, skipped (nothing new to scan)\n",
      stderr: "",
    });
    expect(recorded()).toEqual([]);
  });

  it("scans the staged files, and skips when nothing is staged", () => {
    expect(scan(["staged"]).stdout).toBe(
      "secret-scan: staged: 0 files, skipped (nothing staged)\n",
    );
    expect(recorded()).toEqual([]);
    writeFileSync(join(repo, "c.txt"), "c\n");
    writeFileSync(join(repo, "d.txt"), "d\n");
    git("add", "c.txt", "d.txt");
    const result = scan(["staged"], { exit: 1 });
    git("reset", "-q");
    expect(result).toEqual({
      status: 1,
      stdout: "secret-scan: staged: scanning 2 file(s)\n",
      stderr: "",
    });
    expect(recorded()).toEqual([`${repo} exec -- betterleaks git ${flags} --staged .`]);
  });

  it("pre-push scans each pushed ref from stdin, and fails if any scan fails", () => {
    const input = [
      `(delete) ${zero} refs/heads/gone ${base}`,
      `refs/heads/x ${head} refs/heads/x ${zero}`,
      `refs/heads/main ${head} refs/heads/main ${base}`,
      `refs/heads/same ${head} refs/heads/same ${head}`,
      "",
    ].join("\n");
    const result = scan(["pre-push"], { input, exit: 1 });
    expect(result).toEqual({
      status: 1,
      stdout: [
        "secret-scan: refs/heads/gone: branch deletion, nothing to scan",
        `secret-scan: refs/heads/x -> refs/heads/x: scanning 1 commit(s) (${head} --not --remotes)`,
        `secret-scan: refs/heads/main -> refs/heads/main: scanning 1 commit(s) (${base}..${head})`,
        "secret-scan: refs/heads/same -> refs/heads/same: 0 commits, skipped (nothing new to scan)",
        "",
      ].join("\n"),
      stderr: "",
    });
    expect(recorded()).toEqual([
      `${repo} exec -- betterleaks git ${flags} --log-opts=${head} --not --remotes .`,
      `${repo} exec -- betterleaks git ${flags} --log-opts=${base}..${head} .`,
    ]);
  });

  it("pre-push fails when the remote's commit is not in this clone, and asks for a fetch", () => {
    const unknown = "1".repeat(40);
    const result = scan(["pre-push"], {
      input: `refs/heads/main ${head} refs/heads/main ${unknown}\n`,
    });
    expect(result).toEqual({
      status: 1,
      stdout: "",
      stderr: [
        `secret-scan: refs/heads/main is at ${unknown}, which is not in this clone.`,
        "Run `git fetch` and push again, so the scan can tell which commits are new.",
        "",
      ].join("\n"),
    });
    expect(recorded()).toEqual([]);
  });

  it.each([[[]], [["nonsense"]], [["range", "x"]], [["all", "--config", "x.toml"]]])(
    "prints the usage and exits 2 for %j",
    (args) => {
      const result = scan(args);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(
        /^Usage:\n {2}node tools\/scripts\/src\/checks\/secret-scan\/cli\.ts staged/,
      );
      expect(recorded()).toEqual([]);
    },
  );

  it("fails without mise, instead of passing unscanned", () => {
    const noMise = join(box.root, "no-mise");
    mkdirSync(noMise);
    symlinkSync(join(gitIn(repo, ["--exec-path"]).trim(), "git"), join(noMise, "git"));
    const result = runIn(repo, process.execPath, [cli, "staged"], { env: { PATH: noMise } });
    expect(result).toEqual({
      status: 1,
      stdout: "",
      stderr:
        'secret-scan: mise is not installed, so the secret scan cannot run. See docs/local-env-setup/setup.md ("Ubuntu の初期セットアップ").\n',
    });
  });
});
