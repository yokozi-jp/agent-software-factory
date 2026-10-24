#!/usr/bin/env sh
# Tests for scripts/adr-check.sh in a sandboxed repository. Every git command here runs through in_sandbox_repo,
# except the clone that creates the shallow repository (its source is in the sandbox).
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

make_sandbox
repo="$sandbox/repo"
git init -q -b main "$repo"
mkdir -p "$repo/scripts" "$repo/docs/adr"
cp "$repo_root/scripts/adr-check.sh" "$repo/scripts/"
echo '{}' >"$repo/package.json"
echo base >"$repo/docs/adr/0001-a.md"
r() { in_sandbox_repo "$repo" "$@"; }
r git add -A
r git commit -qm base
base_sha="$(r git rev-parse HEAD)"
r git update-ref refs/remotes/origin/main "$base_sha"

# check_in <dir> [VAR=value...] <command...>: run a command with the variables the check reads cleared, as on a developer machine.
check_in() {
  where="$1"
  shift
  in_sandbox_repo "$where" env -u ADR_ACK -u GITHUB_ACTIONS -u GITHUB_BASE_REF "$@"
}
check() { check_in "$repo" "$@"; }
contains() { printf '%s\n' "$1" | grep -qF -- "$2"; }

n=0
# change <path>...: a new branch from origin/main with one commit that changes (or adds) each path.
change() {
  n=$((n + 1))
  r git switch -q -C "case-$n" origin/main
  for file in "$@"; do
    mkdir -p "$(dirname "$repo/$file")"
    echo "$n" >>"$repo/$file"
  done
  r git add -A
  r git commit -qm "case $n"
}

change README.md
out="$(check sh scripts/adr-check.sh 2>&1)"
expect_exit 0 "exits 0 when nothing decision-related changed" check sh scripts/adr-check.sh
expect_exit 0 "is silent when nothing decision-related changed" test -z "$out"

change apps/web/src/index.ts apps/web/src/index.test.ts
out="$(check sh scripts/adr-check.sh 2>&1)"
expect_exit 0 "is silent for source and test changes" test -z "$out"

change scripts/test/fixtures/package.json apps/api/fixtures/package.json apps/api/__fixtures__/vite.config.ts scripts/test/lefthook.yml \
  fixtures/package.json test/vite.config.ts tests/package.json __tests__/package.json __fixtures__/package.json
out="$(check sh scripts/adr-check.sh 2>&1)"
expect_exit 0 "is silent for changes under test and fixture directories, nested or at the root" test -z "$out"

change package.json
out="$(check sh scripts/adr-check.sh 2>&1)"
expect_exit 0 "exits 0 when it warns" check sh scripts/adr-check.sh
expect_exit 0 "warns about a dependency change without an ADR" contains "$out" "adr-check: warning"
expect_exit 0 "lists the changed file" contains "$out" "  - package.json"
expect_exit 0 "links to the criteria for writing an ADR" contains "$out" 'docs/knowledge/documentation-authoring.md ("ADR を書くかどうか")'
expect_exit 0 "tells how to silence the warning" contains "$out" "ADR_ACK=1"

decision_files=".github/workflows/ci.yml lefthook.yml nx.json mise.toml pnpm-workspace.yaml apps/api/vite.config.ts .kiro/hooks/x.sh .kiro/settings/mcp.json .github/rulesets/protect-main.json"
# shellcheck disable=SC2086 # word splitting of $decision_files is intended
change $decision_files
out="$(check sh scripts/adr-check.sh 2>&1)"
for file in $decision_files; do
  expect_exit 0 "warns about $file" contains "$out" "  - $file"
done

change package.json docs/adr/0002-new.md
adr_tip="$(r git rev-parse HEAD)"
out="$(check sh scripts/adr-check.sh 2>&1)"
expect_exit 0 "is silent when the change adds an ADR" test -z "$out"

change package.json docs/adr/0001-a.md
out="$(check sh scripts/adr-check.sh 2>&1)"
expect_exit 0 "warns when the change only edits an existing ADR" contains "$out" "adr-check: warning"

change package.json
no_adr_tip="$(r git rev-parse HEAD)"
out="$(check ADR_ACK=1 sh scripts/adr-check.sh 2>&1)"
expect_exit 0 "exits 0 with ADR_ACK=1" check ADR_ACK=1 sh scripts/adr-check.sh
expect_exit 0 "is silent with ADR_ACK=1" test -z "$out"

out="$(check GITHUB_ACTIONS=true GITHUB_BASE_REF=main sh scripts/adr-check.sh 2>&1)"
expect_exit 0 "exits 0 in GitHub Actions" check GITHUB_ACTIONS=true GITHUB_BASE_REF=main sh scripts/adr-check.sh
expect_exit 0 "writes a ::warning:: annotation in GitHub Actions" contains "$out" "::warning title=adr-check::"
expect_exit 0 "names the file in the annotation" contains "$out" "package.json"
expect_exit 0 "links to the criteria in the annotation" contains "$out" "documentation-authoring.md#adr-を書くかどうか"

# pre-push: the refs come from stdin, and the commits being pushed are compared, not HEAD.
zero="0000000000000000000000000000000000000000"
r git switch -q main
out="$(printf 'refs/heads/case-x %s refs/heads/case-x %s\n' "$no_adr_tip" "$zero" | check sh scripts/adr-check.sh pre-push 2>&1)"
expect_exit 0 "pre-push warns about the pushed commit, not HEAD" contains "$out" "adr-check: warning"
out="$(printf '(delete) %s refs/heads/case-x %s\n' "$zero" "$no_adr_tip" | check sh scripts/adr-check.sh pre-push 2>&1)"
expect_exit 0 "pre-push is silent when a ref is deleted" test -z "$out"
out="$(printf 'refs/heads/case-x %s refs/heads/case-x %s\n' "$no_adr_tip" "$zero" | check ADR_ACK=1 sh scripts/adr-check.sh pre-push 2>&1)"
expect_exit 0 "pre-push is silent with ADR_ACK=1" test -z "$out"
out="$(printf 'refs/heads/a %s refs/heads/a %s\nrefs/heads/b %s refs/heads/b %s\n' "$adr_tip" "$zero" "$no_adr_tip" "$zero" | check sh scripts/adr-check.sh pre-push 2>&1)"
expect_exit 0 "pre-push: an ADR on one ref does not cover another ref" contains "$out" "adr-check: warning"
out="$(printf 'refs/heads/a %s refs/heads/a %s\n' "$adr_tip" "$zero" | check sh scripts/adr-check.sh pre-push 2>&1)"
expect_exit 0 "pre-push is silent when the pushed commit adds an ADR" test -z "$out"

# No base to compare with.
r git update-ref -d refs/remotes/origin/main
r git switch -q case-1
out="$(check sh scripts/adr-check.sh 2>&1)"
expect_exit 0 "passes when origin/main does not exist" check sh scripts/adr-check.sh
expect_exit 0 "says why it skipped when origin/main does not exist" contains "$out" "adr-check: skipped"
out="$(check GITHUB_ACTIONS=true sh scripts/adr-check.sh 2>&1)"
expect_exit 0 "says why it skipped in GitHub Actions, as a notice" contains "$out" "::notice title=adr-check::skipped"

# A shallow clone: origin/main moved on, and the branch's parent commit was not fetched.
r git switch -q main
echo more >"$repo/more.txt"
r git add -A
r git commit -qm advance
r git update-ref refs/remotes/origin/main "$base_sha"
change package.json
git clone -q --depth 1 --no-single-branch "file://$repo" "$sandbox/shallow"
in_sandbox_repo "$sandbox/shallow" git switch -q "case-$n"
out="$(check_in "$sandbox/shallow" sh scripts/adr-check.sh 2>&1)"
expect_exit 0 "passes in a shallow clone" check_in "$sandbox/shallow" sh scripts/adr-check.sh
expect_exit 0 "says why it skipped in a shallow clone" contains "$out" "adr-check: skipped"
expect_exit 0 "does not warn in a shallow clone" test "$(printf '%s' "$out" | grep -c 'warning')" -eq 0

finish
