import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, sandbox, type Sandbox } from "../test/sandbox.ts";
import { staleCheckoutWarning } from "./stale-checkout.ts";

let box: Sandbox;
let seed: string;
let clone: string;
const git = (dir: string) => (args: readonly string[]) => {
  try {
    return gitIn(dir, args);
  } catch {
    return "";
  }
};
// One commit on origin/main that adds <files>.
const commit = (...files: string[]) => {
  for (const file of files) writeFileSync(join(seed, file), `${file}\n`);
  gitIn(seed, ["add", ...files]);
  gitIn(seed, ["commit", "-qm", files.join(" ")]);
  gitIn(seed, ["push", "-q", "origin", "main"]);
};

beforeAll(() => {
  box = sandbox();
  const origin = join(box.root, "origin.git");
  seed = join(box.root, "seed");
  clone = join(box.root, "clone");
  gitIn(origin, ["init", "-q", "--bare", "-b", "main"]);
  gitIn(seed, ["clone", "-q", origin, "."]);
  gitIn(seed, ["checkout", "-q", "-b", "main"]);
  commit("a.txt");
  gitIn(clone, ["clone", "-q", origin, "."]);
});
afterAll(() => {
  box.remove();
});

describe("staleCheckoutWarning", () => {
  it("is silent when main is up to date", () => {
    expect(staleCheckoutWarning(git(clone), undefined, clone)).toBeUndefined();
  });

  it("fetches first, then names how far behind main is and the files that differ", () => {
    commit("b.txt");
    commit("c.txt");
    expect(staleCheckoutWarning(git(clone), undefined, clone)).toBe(
      [
        `WARNING: this working tree (${clone}) is on main, 2 commit(s) behind origin/main.`,
        "The files here are out of date. Before you research or decide on anything, read them from origin/main",
        "(git show origin/main:<path>, git diff --stat HEAD origin/main), or work in a worktree made by tools/scripts/sh/worktree.sh add,",
        "which starts from origin/main (docs/tooling/worktrees.md).",
        "Do not run git pull or git merge in this tree without telling the user: other sessions may be using its files.",
        "Files that differ from origin/main (first 10):",
        "b.txt",
        "c.txt",
        "",
      ].join("\n"),
    );
  });

  it("leaves the working tree alone", () => {
    expect(existsSync(join(clone, "b.txt"))).toBe(false);
  });

  it("lists at most 10 files", () => {
    commit(...Array.from({ length: 11 }, (_, i) => `f${String(i).padStart(2, "0")}.txt`));
    const warning = staleCheckoutWarning(git(clone), undefined, clone) ?? "";
    expect(warning).toContain("3 commit(s) behind");
    expect(warning).toMatch(/\(first 10\):\nb\.txt\nc\.txt\nf00\.txt\n(f0[1-7]\.txt\n){7}$/);
  });

  it("reads another base from the setting, and uses the ref already here when the fetch fails", () => {
    // There is no remote named upstream, so only the ref is there.
    gitIn(clone, ["update-ref", "refs/remotes/upstream/main", "origin/main"]);
    const warning = staleCheckoutWarning(git(clone), "upstream/main", clone) ?? "";
    expect(warning).toMatch(/^WARNING: .* is on main, 3 commit\(s\) behind upstream\/main\.\n/);
  });

  it("is silent when the base does not exist", () => {
    expect(staleCheckoutWarning(git(clone), "nowhere/main", clone)).toBeUndefined();
  });

  it("is silent for a base without a remote", () => {
    expect(staleCheckoutWarning(git(clone), "main", clone)).toBeUndefined();
  });

  it("is silent on a feature branch", () => {
    gitIn(clone, ["checkout", "-q", "-b", "feature"]);
    expect(staleCheckoutWarning(git(clone), undefined, clone)).toBeUndefined();
    gitIn(clone, ["checkout", "-q", "main"]);
  });

  it("is silent outside a git repository", () => {
    expect(staleCheckoutWarning(git(box.root), undefined, box.root)).toBeUndefined();
  });
});
