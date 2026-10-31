// warn-unfinished-work: tell the agent, when it is about to end its turn, that this working tree holds
// changes that are not committed or commits that are not pushed. A report of "done" that leaves them out
// is wrong (a commit that commitlint refused stayed staged, and the push that followed had nothing to send).
// - Only informs: the agent answers by finishing the work or by saying in its report what is left.
// - Never changes the working tree.

// git <args> in the working tree: stdout, or "" when git fails.
export type Git = (args: readonly string[]) => string;

export interface UnfinishedWork {
  // Lines of `git status --porcelain`: staged, unstaged and untracked changes.
  readonly changes: readonly string[];
  // Commits of HEAD that no remote-tracking branch has.
  readonly unpushed: number;
  // The same value for the same state, so that one state is reported once (cli.ts).
  readonly key: string;
}

export function unfinishedWork(git: Git): UnfinishedWork | undefined {
  if (git(["rev-parse", "--is-inside-work-tree"]).trim() !== "true") return undefined;
  const changes = git(["status", "--porcelain"])
    .split("\n")
    .filter((line) => line !== "");
  // "" (no commit yet, or no remote) is 0: a repository with no remote has nothing to push to.
  const unpushed =
    git(["remote"]).trim() === ""
      ? 0
      : Number(git(["rev-list", "--count", "HEAD", "--not", "--remotes"]));
  if (changes.length === 0 && !(unpushed > 0)) return undefined;
  const head = git(["rev-parse", "--verify", "--quiet", "HEAD"]).trim();
  return { changes, unpushed: unpushed > 0 ? unpushed : 0, key: [head, ...changes].join("\n") };
}

// <here> is the working tree, as the warning names it.
export function unfinishedWorkWarning(work: UnfinishedWork, here: string): string {
  return [
    `WARNING: this working tree (${here}) has unfinished work.`,
    ...(work.changes.length > 0
      ? [`Not committed (${work.changes.length}, first 10):`, ...work.changes.slice(0, 10)]
      : []),
    ...(work.unpushed > 0
      ? [`Not pushed: ${work.unpushed} commit(s) that no remote branch has.`]
      : []),
    "Before you report the work as done: check the result of the last git command (a commit that a hook refused leaves its files staged),",
    "then commit or push, or say in your report what is left and why. Do not report a commit or a push you have not seen succeed.",
    "",
  ].join("\n");
}
