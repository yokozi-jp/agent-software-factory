// warn-stale-checkout: warn when the main branch of this working tree is behind origin/main. A stale tree
// makes the agent read old docs, ADRs and configs: it researches and decides on a repository that no
// longer exists (docs/tooling/worktrees.md ("作業ツリーが古いと警告されたとき")).
// - Only the main branch is checked. A feature branch is behind origin/main in the normal course of
//   work, and `scripts/worktree.sh add` starts new branches from origin/main.
// - Fetches the base first (cli.ts gives git 5 seconds), then falls back to the ref already in the clone.
//   No network, no remote or no main: silent.
// - Never changes the working tree. A `git pull` here could pull the files out from under another session.

// git <args> in the working tree: stdout, or "" when git fails.
export type Git = (args: readonly string[]) => string;

// <setting> is $KIRO_STALE_CHECKOUT_BASE (<remote>/<branch>, origin/main when unset). <here> is the
// working tree, as the warning names it.
export function staleCheckoutWarning(
  git: Git,
  setting: string | undefined,
  here: string,
): string | undefined {
  const base = setting || "origin/main";
  const remote = base.slice(0, base.indexOf("/"));
  const branch = base.slice(remote.length + 1);
  if (git(["symbolic-ref", "--quiet", "--short", "HEAD"]).trim() !== branch) return undefined;
  git(["fetch", "--quiet", remote, branch]);
  // "" (the base does not exist) is 0.
  const behind = Number(git(["rev-list", "--count", `HEAD..${base}`]));
  if (!(behind > 0)) return undefined;
  const changed = git(["diff", "--name-only", "HEAD", base])
    .split("\n")
    .filter((line) => line !== "")
    .slice(0, 10);
  return [
    `WARNING: this working tree (${here}) is on ${branch}, ${behind} commit(s) behind ${base}.`,
    `The files here are out of date. Before you research or decide on anything, read them from ${base}`,
    `(git show ${base}:<path>, git diff --stat HEAD ${base}), or work in a worktree made by scripts/worktree.sh add,`,
    `which starts from ${base} (docs/tooling/worktrees.md).`,
    "Do not run git pull or git merge in this tree without telling the user: other sessions may be using its files.",
    `Files that differ from ${base} (first 10):`,
    ...changed,
    "",
  ].join("\n");
}
