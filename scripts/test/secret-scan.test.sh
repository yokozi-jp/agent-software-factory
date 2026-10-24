#!/usr/bin/env sh
# Tests for scripts/secret-scan.sh in a sandboxed repository with a generated token.
# Needs mise with the tools in mise.lock installed (the Secret scan workflow installs them).
# Every git command here runs through in_sandbox_repo, and pushes go to a sandbox path, never to a named remote.
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

make_sandbox
repo="$sandbox/repo"
remote="$sandbox/remote.git"
git init -q --bare "$remote"
git init -q "$repo"
cp "$repo_root/.betterleaks.toml" "$repo_root/mise.toml" "$repo_root/mise.lock" "$repo/"
# `mise exec` installs every missing tool in mise.toml, and Semgrep installs from its dependency graph in .mise/locks/.
cp -R "$repo_root/.mise" "$repo/"
mkdir "$repo/scripts"
cp "$repo_root/scripts/secret-scan.sh" "$repo/scripts/"
scan="$repo/scripts/secret-scan.sh"
r() { in_sandbox_repo "$repo" "$@"; }
r git add .
r git commit -qm base
r git push -q "$remote" HEAD:refs/heads/main
# pre-push treats commits on remote-tracking branches as already pushed.
r git fetch -q "$remote" "+refs/heads/*:refs/remotes/sandbox/*"
base="$(r git rev-parse HEAD)"
zero=0000000000000000000000000000000000000000

# Clean history.
expect_exit 0 "all passes on clean history" r sh "$scan" all
expect_exit 0 "worktree passes on clean files" r sh "$scan" worktree
expect_exit 0 "empty range is skipped" r sh "$scan" range "$base" "$base"
expect_exit 2 "unknown target prints usage" r sh "$scan" nonsense
expect_exit 2 "range needs two revisions" r sh "$scan" range "$base"

# A GitHub token that is generated here, never committed to this repo.
token="ghp_$(head -c 300 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c 36)"
printf 'export const key = "%s";\n' "$token" > "$repo/leak.ts"
r git add leak.ts
expect_exit 1 "staged finds the token" r sh "$scan" staged
r git commit -qm leak
head="$(r git rev-parse HEAD)"
expect_exit 1 "range finds the token" r sh "$scan" range "$base" "$head"
expect_exit 1 "all finds the token" r sh "$scan" all
expect_exit 1 "pre-push finds the token on an existing branch" r sh -c "echo 'refs/heads/main $head refs/heads/main $base' | sh '$scan' pre-push"
expect_exit 1 "pre-push finds the token on a new branch" r sh -c "echo 'refs/heads/x $head refs/heads/x $zero' | sh '$scan' pre-push"
expect_exit 0 "pre-push skips branch deletion" r sh -c "echo '(delete) $zero refs/heads/x $base' | sh '$scan' pre-push"
expect_exit 1 "pre-push fails when the remote commit is unknown" r sh -c "echo 'refs/heads/main $head refs/heads/main 1111111111111111111111111111111111111111' | sh '$scan' pre-push"

# Without mise the scan fails instead of passing unscanned.
bin="$sandbox/bin"
mkdir "$bin"
for tool in git sh cat tr sed wc mktemp dirname basename head; do
  ln -s "$(command -v "$tool")" "$bin/$tool"
done
expect_exit 1 "fails without mise" r env PATH="$bin" sh "$scan" all

finish
