#!/usr/bin/env sh
# Where this repository's worktrees live, and how to add one (docs/tooling/worktrees.md).
# Worktrees go in the sibling directory <main checkout>-worktrees/<branch>, outside the repository, so Nx,
# vp check and IWE do not pick up their files. The main checkout is found from git's common directory, so the
# path is the same from the main checkout, from another worktree, and from any subdirectory of either.
#   tools/scripts/sh/worktree.sh path <branch>                print the worktree's absolute path
#   tools/scripts/sh/worktree.sh add <branch> [--no-install]  fetch origin, add <branch> from origin/main, assign dev-server ports, pnpm install
# `add` prints only the path on stdout (progress goes to stderr), so `cd "$(tools/scripts/sh/worktree.sh add x)"` works.
#   exit 0  done (failing to assign ports only warns)
#   exit 1  the worktree directory already exists, or a git or pnpm command failed
#   exit 2  wrong arguments
set -eu

usage() {
  echo "usage: tools/scripts/sh/worktree.sh path <branch> | add <branch> [--no-install]" >&2
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
    # Give the worktree its own dev-server ports (Issue #184). A failure only warns: the worktree still works,
    # and strictPort turns a clash into a failed start instead of a silent fall-through to another port.
    # The path is made absolute before the cd: $0 may be relative, and would then point inside the new worktree.
    ports="$(cd "$(dirname "$0")" && pwd)/../src/dev-ports/cli.ts"
    if ! (cd "$dir" && node "$ports" assign "$dir") >&2; then
      echo "warning: dev-ports could not assign ports to $dir (docs/tooling/worktrees.md)." >&2
    fi
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
