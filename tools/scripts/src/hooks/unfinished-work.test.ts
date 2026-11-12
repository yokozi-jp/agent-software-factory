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
  it("すべてを push したきれいなツリーでは、何も見つけないこと", () => {
    expect(unfinishedWork(git)).toBeUndefined();
  });

  it("git リポジトリの外では、何も見つけないこと", () => {
    expect(unfinishedWork(() => "")).toBeUndefined();
  });

  it("ステージしたファイル、ステージしていない変更、追跡されていないファイルを見つけること", () => {
    writeFileSync(join(clone, "staged.txt"), "a\n");
    gitIn(clone, ["add", "staged.txt"]);
    writeFileSync(join(clone, "untracked.txt"), "b\n");
    expect(unfinishedWork(git)).toMatchObject({
      changes: ["A  staged.txt", "?? untracked.txt"],
      unpushed: 0,
    });
  });

  it("どの remote ブランチにもない commit を数えること", () => {
    gitIn(clone, ["commit", "-q", "--allow-empty", "-m", "two"]);
    gitIn(clone, ["commit", "-q", "--allow-empty", "-m", "three"]);
    expect(unfinishedWork(git)).toMatchObject({ changes: [], unpushed: 2 });
  });

  it("remote がないとき、または git が数えられないとき、未 push の commit を数えないこと", () => {
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

  it("git が作業ツリーの中ではないと言ったとき、ほかの答えにかかわらず何も見つけないこと", () => {
    const git = answering({ ...inTree, "rev-parse --is-inside-work-tree": "false\n" });
    expect(unfinishedWork(git)).toBeUndefined();
  });

  it("rev-list が何と答えても、リポジトリに remote がないとき、未 push の commit を数えないこと", () => {
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

  it("git が数ではない答えを返したとき、未 push の commit を数えないこと", () => {
    const git = answering({
      ...inTree,
      remote: "origin\n",
      "rev-list --count HEAD --not --remotes": "oops\n",
    });
    expect(unfinishedWork(git)).toMatchObject({ unpushed: 0 });
  });

  it("HEAD と変更から、1 行に 1 つずつ key を作ること", () => {
    const git = answering({
      ...inTree,
      "status --porcelain": "?? a.txt\n M b.txt\n",
      "rev-parse --verify --quiet HEAD": "abc123\n",
    });
    expect(unfinishedWork(git)?.key).toBe("abc123\n?? a.txt\n M b.txt");
  });

  it("状態が変わったとき、別の key にすること", () => {
    writeFileSync(join(clone, "a.txt"), "a\n");
    const first = unfinishedWork(git)?.key;
    writeFileSync(join(clone, "b.txt"), "b\n");
    expect(unfinishedWork(git)?.key).not.toBe(first);
  });
});

describe("unfinishedWorkWarning", () => {
  it("ツリー、最初の 10 件の変更、未 push の commit を挙げること", () => {
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

  it("当てはまらない部分を省き、助言と改行で終えること", () => {
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
