#!/usr/bin/env sh
# Tests for scripts/worktree.sh in a sandboxed main checkout with a local bare origin.
# Every git command here runs through in_sandbox_repo.
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

make_sandbox
script="$repo_root/scripts/worktree.sh"
origin="$sandbox/origin.git"
main="$sandbox/app"
base="$sandbox/app-worktrees"
git init -q --bare -b main "$origin"
git init -q -b main "$main"
mkdir -p "$main/sub/deeper"
echo a >"$main/sub/deeper/a"
r() { in_sandbox_repo "$main" "$@"; }
r git add -A
r git commit -qm base
r git remote add origin "$origin"
r git push -q origin main

# path_is <dir> <branch> <want>: `path <branch>`, run from <dir>, prints <want>.
path_is() {
  got="$(in_sandbox_repo "$1" sh "$script" path "$2")" || return 1
  echo "got $got, want $3"
  [ "$got" = "$3" ]
}
# branch_is <dir> <branch>: <dir> is a worktree with <branch> checked out.
branch_is() {
  [ -d "$1" ] || return 1
  [ "$(in_sandbox_repo "$1" git branch --show-current)" = "$2" ]
}

expect_exit 0 "path from the main checkout" path_is "$main" feat/a "$base/feat/a"
expect_exit 0 "path from a subdirectory of the main checkout" path_is "$main/sub/deeper" feat/a "$base/feat/a"

expect_exit 0 "add creates the worktree from origin/main" r sh "$script" add feat/a --no-install
expect_exit 0 "add checks out the new branch" branch_is "$base/feat/a" feat/a

# From inside another worktree, a relative ../<base> would land inside that worktree.
expect_exit 0 "path from another worktree" path_is "$base/feat/a" feat/b "$base/feat/b"
expect_exit 0 "path from a subdirectory of another worktree" path_is "$base/feat/a/sub/deeper" feat/b "$base/feat/b"
expect_exit 0 "add from a subdirectory of another worktree" in_sandbox_repo "$base/feat/a/sub" sh "$script" add feat/b --no-install
expect_exit 0 "add from another worktree puts it beside the first" branch_is "$base/feat/b" feat/b
expect_exit 1 "add from another worktree creates nothing inside it" test -e "$base/feat/a/sub/app-worktrees"

add_prints_path() {
  got="$(r sh "$script" add feat/c --no-install 2>/dev/null)" || return 1
  [ "$got" = "$base/feat/c" ]
}
expect_exit 0 "add prints only the path on stdout" add_prints_path

expect_exit 1 "add refuses an existing directory" r sh "$script" add feat/a --no-install
expect_exit 2 "refuses missing arguments" r sh "$script" path
expect_exit 2 "refuses an unknown command" r sh "$script" remove feat/a
expect_exit 2 "refuses an unknown option" r sh "$script" add feat/d --install

finish
