import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { gitIn, sandbox, type Sandbox } from "../test/sandbox.ts";
import { unfinishedWork, unfinishedWorkWarning } from "./unfinished-work.ts";

let box: Sandbox;
let clone: string;
const git = (args: readonly string[]) => {
  try {
    return gitIn(clone, args);
  } catch {
    return "";
  }
};

beforeAll(() => {
  box = sandbox();
  const origin = join(box.root, "origin.git");
  const seed = join(box.root, "seed");
  clone = join(box.root, "clone");
  gitIn(origin, ["init", "-q", "--bare", "-b", "main"]);
  gitIn(seed, ["clone", "-q", origin, "."]);
  gitIn(seed, ["checkout", "-q", "-b", "main"]);
  gitIn(seed, ["commit", "-q", "--allow-empty", "-m", "one"]);
  gitIn(seed, ["push", "-q", "origin", "main"]);
  gitIn(clone, ["clone", "-q", origin, "."]);
});
afterAll(() => {
  box.remove();
});
// Every test starts from the clean clone.
beforeEach(() => {
  gitIn(clone, ["reset", "-q", "--hard", "origin/main"]);
  gitIn(clone, ["clean", "-qfd"]);
});

describe("unfinishedWork", () => {
  it("finds nothing in a clean tree that has pushed everything", () => {
    expect(unfinishedWork(git)).toBeUndefined();
  });

  it("finds nothing outside a git repository", () => {
    expect(unfinishedWork(() => "")).toBeUndefined();
  });

  it("finds a staged file, an unstaged change and an untracked file", () => {
    writeFileSync(join(clone, "staged.txt"), "a\n");
    gitIn(clone, ["add", "staged.txt"]);
    writeFileSync(join(clone, "untracked.txt"), "b\n");
    expect(unfinishedWork(git)).toMatchObject({
      changes: ["A  staged.txt", "?? untracked.txt"],
      unpushed: 0,
    });
  });

  it("counts the commits that no remote branch has", () => {
    gitIn(clone, ["commit", "-q", "--allow-empty", "-m", "two"]);
    gitIn(clone, ["commit", "-q", "--allow-empty", "-m", "three"]);
    expect(unfinishedWork(git)).toMatchObject({ changes: [], unpushed: 2 });
  });

  it("counts no unpushed commit when there is no remote, or when git cannot count them", () => {
    const answers: Record<string, string> = {
      "rev-parse --is-inside-work-tree": "true\n",
      "status --porcelain": "?? a.txt\n",
    };
    const fake = (remote: string) => (args: readonly string[]) =>
      args[0] === "remote" ? remote : (answers[args.join(" ")] ?? "");
    expect(unfinishedWork(fake(""))).toMatchObject({ unpushed: 0 });
    expect(unfinishedWork(fake("origin\n"))).toMatchObject({ unpushed: 0 });
  });

  // A git that answers only the commands it is asked, by their arguments: `undefined` answers "" as a failing git does.
  const answering =
    (answers: Record<string, string>) =>
    (args: readonly string[]): string =>
      answers[args.join(" ")] ?? "";
  const inTree = {
    "rev-parse --is-inside-work-tree": "true\n",
    "status --porcelain": "?? a.txt\n",
  };

  it("finds nothing when git says it is not inside a work tree, whatever else it answers", () => {
    const git = answering({ ...inTree, "rev-parse --is-inside-work-tree": "false\n" });
    expect(unfinishedWork(git)).toBeUndefined();
  });

  it("counts no unpushed commit when the repository has no remote, whatever rev-list says", () => {
    const rev = { "rev-list --count HEAD --not --remotes": "3\n" };
    expect(unfinishedWork(answering({ ...inTree, ...rev, remote: "" }))).toMatchObject({
      unpushed: 0,
    });
    expect(unfinishedWork(answering({ ...inTree, ...rev, remote: "\n" }))).toMatchObject({
      unpushed: 0,
    });
    expect(unfinishedWork(answering({ ...inTree, ...rev, remote: "origin\n" }))).toMatchObject({
      unpushed: 3,
    });
  });

  it("counts no unpushed commit when git answers with something that is not a number", () => {
    const git = answering({
      ...inTree,
      remote: "origin\n",
      "rev-list --count HEAD --not --remotes": "oops\n",
    });
    expect(unfinishedWork(git)).toMatchObject({ unpushed: 0 });
  });

  it("builds the key from HEAD and the changes, one to a line", () => {
    const git = answering({
      ...inTree,
      "status --porcelain": "?? a.txt\n M b.txt\n",
      "rev-parse --verify --quiet HEAD": "abc123\n",
    });
    expect(unfinishedWork(git)?.key).toBe("abc123\n?? a.txt\n M b.txt");
  });

  it("gives another key when the state changes", () => {
    writeFileSync(join(clone, "a.txt"), "a\n");
    const first = unfinishedWork(git)?.key;
    writeFileSync(join(clone, "b.txt"), "b\n");
    expect(unfinishedWork(git)?.key).not.toBe(first);
  });
});

describe("unfinishedWorkWarning", () => {
  it("names the tree, the first 10 changes and the unpushed commits", () => {
    const changes = Array.from({ length: 12 }, (_, i) => `?? f${i}.txt`);
    const text = unfinishedWorkWarning({ changes, unpushed: 3, key: "k" }, "/tree");
    expect(text).toContain("this working tree (/tree) has unfinished work");
    expect(text).toContain("Not committed (12, first 10):");
    expect(text).toContain("?? f9.txt");
    expect(text).not.toContain("f10.txt");
    expect(text).toContain("Not pushed: 3 commit(s)");
  });

  const advice = [
    "Before you report the work as done: check the result of the last git command (a commit that a hook refused leaves its files staged),",
    "then commit or push, or say in your report what is left and why. Do not report a commit or a push you have not seen succeed.",
  ];

  it("leaves out the part that does not apply, and ends with the advice and a newline", () => {
    expect(unfinishedWorkWarning({ changes: [], unpushed: 1, key: "k" }, "/tree")).toBe(
      [
        "WARNING: this working tree (/tree) has unfinished work.",
        "Not pushed: 1 commit(s) that no remote branch has.",
        ...advice,
        "",
      ].join("\n"),
    );
    expect(
      unfinishedWorkWarning({ changes: ["?? a", " M b"], unpushed: 0, key: "k" }, "/tree"),
    ).toBe(
      [
        "WARNING: this working tree (/tree) has unfinished work.",
        "Not committed (2, first 10):",
        "?? a",
        " M b",
        ...advice,
        "",
      ].join("\n"),
    );
  });
});
