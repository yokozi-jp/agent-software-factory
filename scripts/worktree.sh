#!/usr/bin/env sh
# Where this repository's worktrees live, and how to add one (docs/tooling/worktrees.md).
# Worktrees go in the sibling directory <main checkout>-worktrees/<branch>, outside the repository, so Nx,
# vp check and IWE do not pick up their files. The main checkout is found from git's common directory, so the
# path is the same from the main checkout, from another worktree, and from any subdirectory of either.
#   scripts/worktree.sh path <branch>                print the worktree's absolute path
#   scripts/worktree.sh add <branch> [--no-install]  fetch origin, add <branch> from origin/main, pnpm install
# `add` prints only the path on stdout (progress goes to stderr), so `cd "$(scripts/worktree.sh add x)"` works.
#   exit 0  done
#   exit 1  the worktree directory already exists, or a git or pnpm command failed
#   exit 2  wrong arguments
set -eu

usage() {
  echo "usage: scripts/worktree.sh path <branch> | add <branch> [--no-install]" >&2
  exit 2
}
[ $# -ge 2 ] || usage
command="$1"
branch="$2"
shift 2
[ -n "$branch" ] || usage

common="$(git rev-parse --path-format=absolute --git-common-dir)"
main="$(dirname "$common")"
dir="$(dirname "$main")/$(basename "$main")-worktrees/$branch"

case "$command" in
  path)
    printf '%s\n' "$dir"
    ;;
  add)
    install=1
    case "${1:-}" in
      "") ;;
      --no-install) install=0 ;;
      *) usage ;;
    esac
    if [ -e "$dir" ]; then
      echo "worktree: $dir already exists. Pick another branch name, or remove it (docs/tooling/worktrees.md)." >&2
      exit 1
    fi
    git fetch origin >&2
    git worktree add -b "$branch" "$dir" origin/main >&2
    # node_modules is per worktree. The Git hooks are shared by every worktree.
    if [ "$install" = 1 ]; then
      (cd "$dir" && pnpm install --frozen-lockfile) >&2
    fi
    printf '%s\n' "$dir"
    ;;
  *)
    usage
    ;;
esac
