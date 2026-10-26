import { describe, expect, it } from "vite-plus/test";
import { betterleaks, parseTarget, pushedRefs, usage } from "./rules.ts";

const zero = "0".repeat(40);
const a = "a".repeat(40);
const b = "b".repeat(40);

describe("parseTarget", () => {
  it.each([
    [["staged"], { name: "staged" }],
    [["pre-push"], { name: "pre-push" }],
    [["range", "base", "head"], { name: "range", base: "base", head: "head" }],
    [["all"], { name: "all" }],
    [["worktree"], { name: "worktree" }],
  ])("reads %j", (argv, target) => {
    expect(parseTarget(argv)).toEqual(target);
  });

  it.each([
    [[]],
    [["nonsense"]],
    [["staged", "x"]],
    [["pre-push", "x"]],
    [["all", "x"]],
    [["worktree", "x"]],
    [["range", "base"]],
    [["range", "base", "head", "x"]],
    [["--config", "other.toml"]],
  ])("rejects %j, so that only the scan target can be chosen", (argv) => {
    expect(parseTarget(argv)).toBeUndefined();
  });
});

describe("usage", () => {
  it("lists every target and what runs it", () => {
    expect(usage).toBe(
      [
        "Usage:",
        "  node tools/scripts/src/checks/secret-scan/cli.ts staged               # pre-commit: staged changes",
        "  node tools/scripts/src/checks/secret-scan/cli.ts pre-push             # pre-push: refs from git on stdin",
        "  node tools/scripts/src/checks/secret-scan/cli.ts range <base> <head>  # CI pull request: base..head",
        "  node tools/scripts/src/checks/secret-scan/cli.ts all                  # CI push to main, manual: full history",
        "  node tools/scripts/src/checks/secret-scan/cli.ts worktree             # manual: working tree files",
        "",
      ].join("\n"),
    );
  });
});

describe("betterleaks", () => {
  it("runs the pinned betterleaks with the fixed flags, the mode options, and the current directory", () => {
    expect(betterleaks("git", ["--staged"])).toEqual([
      "exec",
      "--",
      "betterleaks",
      "git",
      "--redact",
      "--no-banner",
      "--config",
      ".betterleaks.toml",
      "--staged",
      ".",
    ]);
    expect(betterleaks("dir", [])).toEqual([
      "exec",
      "--",
      "betterleaks",
      "dir",
      "--redact",
      "--no-banner",
      "--config",
      ".betterleaks.toml",
      ".",
    ]);
  });
});

describe("pushedRefs", () => {
  it("scans the commits of a new branch that no remote-tracking branch has", () => {
    expect(pushedRefs(`refs/heads/x ${a} refs/heads/x ${zero}\n`)).toEqual([
      {
        kind: "scan",
        remoteRef: "refs/heads/x",
        label: "refs/heads/x -> refs/heads/x",
        revs: [a, "--not", "--remotes"],
      },
    ]);
  });

  it("scans the commits after the remote's commit on an existing branch", () => {
    expect(pushedRefs(`refs/heads/main ${b} refs/heads/main ${a}\n`)).toEqual([
      {
        kind: "scan",
        remoteRef: "refs/heads/main",
        label: "refs/heads/main -> refs/heads/main",
        remote: a,
        revs: [`${a}..${b}`],
      },
    ]);
  });

  it("skips a deleted branch, and reads every line", () => {
    expect(
      pushedRefs(`(delete) ${zero} refs/heads/x ${a}\nrefs/heads/y ${b} refs/heads/z ${zero}\n`),
    ).toEqual([
      { kind: "deleted", remoteRef: "refs/heads/x" },
      {
        kind: "scan",
        remoteRef: "refs/heads/z",
        label: "refs/heads/y -> refs/heads/z",
        revs: [b, "--not", "--remotes"],
      },
    ]);
  });

  it("knows the all-zero object name of a SHA-256 repository", () => {
    const zero64 = "0".repeat(64);
    expect(pushedRefs(`(delete) ${zero64} refs/heads/x ${zero64}`)).toEqual([
      { kind: "deleted", remoteRef: "refs/heads/x" },
    ]);
  });

  it("takes an object name that only starts or ends with zeros for a commit", () => {
    const starts = `${"0".repeat(39)}1`;
    const ends = `1${"0".repeat(39)}`;
    expect(pushedRefs(`r ${starts} r ${ends}\n`)).toEqual([
      { kind: "scan", remoteRef: "r", label: "r -> r", remote: ends, revs: [`${ends}..${starts}`] },
    ]);
  });

  it("ignores empty lines, nothing on stdin, and lines that are not four fields", () => {
    expect(pushedRefs("")).toEqual([]);
    expect(pushedRefs("\n\n")).toEqual([]);
    expect(
      pushedRefs(`refs/heads/x ${a} refs/heads/x\nrefs/heads/x ${a} refs/heads/x ${zero} x\n`),
    ).toEqual([]);
  });
});
