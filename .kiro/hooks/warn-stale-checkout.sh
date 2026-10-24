#!/usr/bin/env sh
# Kiro hook (SessionStart): warn when the main branch of this working tree is behind origin/main.
# A stale tree makes the agent read old docs, ADRs and configs: it researches and decides on a
# repository that no longer exists (docs/tooling/worktrees.md "古い作業ツリー").
# - Only the main branch is checked. A feature branch is behind origin/main in the normal course of work,
#   and `scripts/worktree.sh add` starts new branches from origin/main.
# - Fetches origin/main first (5 seconds at most, `timeout` is skipped when it is not installed), then falls
#   back to the origin/main ref already in the clone. No network, no origin or no main: silent.
# - Never changes the working tree. A `git pull` here could pull the files out from under another session.
# stdout of a SessionStart hook is added to the agent's context. Always exits 0: this hook only informs.
set -u

base="${KIRO_STALE_CHECKOUT_BASE:-origin/main}"
remote="${base%%/*}"
branch="${base#*/}"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
[ "$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" = "$branch" ] || exit 0

if command -v timeout >/dev/null 2>&1; then
  timeout 5 git fetch --quiet "$remote" "$branch" >/dev/null 2>&1 || true
fi

behind="$(git rev-list --count "HEAD..$base" 2>/dev/null)" || exit 0
[ "${behind:-0}" -gt 0 ] || exit 0

here="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
changed="$(git diff --name-only "HEAD" "$base" 2>/dev/null | head -n 10)"

cat <<EOM
WARNING: this working tree ($here) is on $branch, $behind commit(s) behind $base.
The files here are out of date. Before you research or decide on anything, read them from $base
(git show $base:<path>, git diff --stat HEAD $base), or work in a worktree made by scripts/worktree.sh add,
which starts from $base (docs/tooling/worktrees.md).
Do not run git pull or git merge in this tree without telling the user: other sessions may be using its files.
Files that differ from $base (first 10):
$changed
EOM
exit 0
