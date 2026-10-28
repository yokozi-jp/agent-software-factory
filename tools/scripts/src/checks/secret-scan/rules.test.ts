import { describe, expect, it } from "vite-plus/test";
import {
  betterleaks,
  exitStatus,
  gitFailed,
  parseTarget,
  plan,
  pushedRefs,
  usage,
  type Repo,
} from "./rules.ts";

const zero = "0".repeat(40);
const a = "a".repeat(40);
const b = "b".repeat(40);

// A repository with the given commits and counts. Records what plan() asked, so a test can tell that a
// question was not asked.
function fakeRepo(facts: { commits?: string[]; counts?: Record<string, number>; staged?: number }) {
  const asked: string[] = [];
  const repo: Repo = {
    hasCommit: (sha) => {
      asked.push(`hasCommit ${sha}`);
      return (facts.commits ?? []).includes(sha);
    },
    countCommits: (revs) => {
      asked.push(`countCommits ${revs.join(" ")}`);
      return facts.counts?.[revs.join(" ")] ?? 0;
    },
    countStaged: () => {
      asked.push("countStaged");
      return facts.staged ?? 0;
    },
  };
  return { repo, asked };
}

const report = (stdout: string, stderr = "", status: 0 | 1 = 0) => ({
  kind: "report",
  stdout,
  stderr,
  status,
});

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
      "--verbose",
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
      "--verbose",
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

describe("plan", () => {
  it("scans the staged files, and skips when nothing is staged", () => {
    expect(plan({ name: "staged" }, [], fakeRepo({ staged: 2 }).repo)).toEqual([
      {
        kind: "scan",
        stdout: "secret-scan: staged: scanning 2 file(s)\n",
        mode: "git",
        options: ["--staged"],
      },
    ]);
    expect(plan({ name: "staged" }, [], fakeRepo({ staged: 0 }).repo)).toEqual([
      report("secret-scan: staged: 0 files, skipped (nothing staged)\n"),
    ]);
  });

  it("scans the commits of a range, and skips an empty range", () => {
    const range = { name: "range", base: "x", head: "y" } as const;
    expect(plan(range, [], fakeRepo({ counts: { "x..y": 3 } }).repo)).toEqual([
      {
        kind: "scan",
        stdout: "secret-scan: range: scanning 3 commit(s) (x..y)\n",
        mode: "git",
        options: ["--log-opts=x..y"],
      },
    ]);
    expect(plan(range, [], fakeRepo({}).repo)).toEqual([
      report("secret-scan: range: 0 commits, skipped (nothing new to scan)\n"),
    ]);
  });

  it("scans the full history and the working tree", () => {
    expect(plan({ name: "all" }, [], fakeRepo({ counts: { "--all": 5 } }).repo)).toEqual([
      {
        kind: "scan",
        stdout: "secret-scan: all: scanning 5 commit(s) (full history)\n",
        mode: "git",
        options: [],
      },
    ]);
    const { repo, asked } = fakeRepo({});
    expect(plan({ name: "worktree" }, [], repo)).toEqual([
      {
        kind: "scan",
        stdout: "secret-scan: worktree: scanning working tree files\n",
        mode: "dir",
        options: [],
      },
    ]);
    expect(asked).toEqual([]);
  });

  it("pre-push takes each pushed ref in turn: deleted, new, not in this clone, empty, and new commits", () => {
    const refs = pushedRefs(
      [
        `(delete) ${zero} refs/heads/gone ${a}`,
        `refs/heads/new ${a} refs/heads/new ${zero}`,
        `refs/heads/far ${b} refs/heads/far ${zero.replaceAll("0", "1")}`,
        `refs/heads/same ${a} refs/heads/same ${a}`,
        `refs/heads/main ${b} refs/heads/main ${a}`,
      ].join("\n"),
    );
    const { repo, asked } = fakeRepo({
      commits: [a],
      counts: { [`${a} --not --remotes`]: 1, [`${a}..${b}`]: 2 },
    });
    const one = "1".repeat(40);
    expect(plan({ name: "pre-push" }, refs, repo)).toEqual([
      report("secret-scan: refs/heads/gone: branch deletion, nothing to scan\n"),
      {
        kind: "scan",
        stdout: `secret-scan: refs/heads/new -> refs/heads/new: scanning 1 commit(s) (${a} --not --remotes)\n`,
        mode: "git",
        options: [`--log-opts=${a} --not --remotes`],
      },
      report(
        "",
        `secret-scan: refs/heads/far is at ${one}, which is not in this clone.\n` +
          "Run `git fetch` and push again, so the scan can tell which commits are new.\n",
        1,
      ),
      report(
        "secret-scan: refs/heads/same -> refs/heads/same: 0 commits, skipped (nothing new to scan)\n",
      ),
      {
        kind: "scan",
        stdout: `secret-scan: refs/heads/main -> refs/heads/main: scanning 2 commit(s) (${a}..${b})\n`,
        mode: "git",
        options: [`--log-opts=${a}..${b}`],
      },
    ]);
    // A new branch has no remote commit to look for; a commit not in this clone is not counted.
    expect(asked).toEqual([
      `countCommits ${a} --not --remotes`,
      `hasCommit ${one}`,
      `hasCommit ${a}`,
      `countCommits ${a}..${a}`,
      `hasCommit ${a}`,
      `countCommits ${a}..${b}`,
    ]);
  });

  it("pre-push with nothing on stdin has nothing to do", () => {
    expect(plan({ name: "pre-push" }, [], fakeRepo({}).repo)).toEqual([]);
  });
});

describe("exitStatus", () => {
  it("passes the one scan's exit code on, and takes a scan that did not start as a failure", () => {
    expect(exitStatus({ name: "all" }, [0])).toBe(0);
    expect(exitStatus({ name: "range", base: "x", head: "y" }, [1])).toBe(1);
    expect(exitStatus({ name: "staged" }, [7])).toBe(7);
    expect(exitStatus({ name: "worktree" }, [null])).toBe(1);
    expect(exitStatus({ name: "all" }, [])).toBe(0);
  });

  it("fails a push with 1 when any ref fails, and passes one with nothing to scan", () => {
    const push = { name: "pre-push" } as const;
    expect(exitStatus(push, [])).toBe(0);
    expect(exitStatus(push, [0, 0])).toBe(0);
    expect(exitStatus(push, [0, 1, 0])).toBe(1);
    expect(exitStatus(push, [7])).toBe(1);
    expect(exitStatus(push, [0, null])).toBe(1);
  });
});

describe("gitFailed", () => {
  it("passes git's own code on, so that a git error is not taken for a finding (1)", () => {
    expect(gitFailed(128)).toBe(128);
    expect(gitFailed(129)).toBe(129);
    expect(gitFailed(2)).toBe(2);
  });

  it("is 128, git's code for a fatal error, when git gave none or gave 0 or 1", () => {
    expect(gitFailed(undefined)).toBe(128);
    expect(gitFailed(null)).toBe(128);
    expect(gitFailed(0)).toBe(128);
    expect(gitFailed(1)).toBe(128);
  });
});
