#!/usr/bin/env sh
# Regression test for test isolation (docs/tooling/ci.md ("スクリプトのテスト")).
# Git hooks run with GIT_DIR and GIT_INDEX_FILE exported. A test that leaves them set acts on the repository
# that runs the hook: once, a pre-commit hook ran secret-scan.test.sh, which committed into this repo and pushed main.
# This test reproduces that environment against a decoy repository with its own remote, runs the other test
# files, and checks that the decoy's refs, index, config and remote did not change. The decoy stands in for
# this repository, so a broken lib.sh damages only the sandbox.
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

make_sandbox
decoy="$sandbox/decoy"
decoy_remote="$sandbox/decoy-remote.git"
git init -q --bare "$decoy_remote"
git init -q "$decoy"
echo decoy > "$decoy/README.md"
in_sandbox_repo "$decoy" git add README.md
in_sandbox_repo "$decoy" git commit -qm decoy
in_sandbox_repo "$decoy" git remote add origin "$decoy_remote"
in_sandbox_repo "$decoy" git push -q origin HEAD:refs/heads/main
# The other test files touch the index; give the decoy one so a leak is visible.
in_sandbox_repo "$decoy" git status >/dev/null

fingerprint() {
  # $1 is expanded by the inner shell.
  # shellcheck disable=SC2016
  in_sandbox_repo "$decoy" sh -c '
    git for-each-ref --format="%(refname) %(objectname)"
    git rev-parse HEAD
    git config --local --list
    sha256sum .git/index
    git --git-dir="$1" for-each-ref --format="%(refname) %(objectname)"
  ' fingerprint "$decoy_remote"
}
before="$(fingerprint)"

# The test files to run under hook variables. Each CI job passes the ones it can run: secret-scan.test.sh
# needs betterleaks. Without arguments, every other test file runs.
if [ $# -gt 0 ]; then
  tests="$*"
else
  tests=""
  for file in "$repo_root"/scripts/test/*.test.sh; do
    case "$file" in */isolation.test.sh) continue ;; esac
    tests="$tests scripts/test/${file##*/}"
  done
fi

for test in $tests; do
  # Same variables git exports to a pre-commit hook, pointing at the decoy instead of this repository.
  # cwd stays this repository, as in a hook, so the tests still copy this repository's files.
  [ -f "$repo_root/$test" ] || {
    echo "FAIL: $test does not exist" >&2
    failures=$((failures + 1))
    continue
  }
  expect_exit 0 "$test passes with hook variables set" \
    env GIT_DIR="$decoy/.git" GIT_INDEX_FILE="$decoy/.git/index" GIT_PREFIX="" sh "$repo_root/$test"
  after="$(fingerprint)"
  if [ "$after" = "$before" ]; then
    passes=$((passes + 1))
  else
    echo "FAIL: $test changed the repository it was run from:" >&2
    printf '%s\n' "$before" > "$sandbox/before"
    printf '%s\n' "$after" > "$sandbox/after"
    diff "$sandbox/before" "$sandbox/after" >&2
    failures=$((failures + 1))
    before="$after"
  fi
done

finish
