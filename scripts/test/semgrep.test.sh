#!/usr/bin/env sh
# Tests for scripts/semgrep.sh in a sandboxed repository, with local rules (SEMGREP_RULES) instead of the Registry,
# so the result depends only on the script and the pinned Semgrep. Needs mise with the tools in mise.lock installed.
# Every git command here runs through in_sandbox_repo.
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

make_sandbox
repo="$sandbox/repo"
git init -q -b main "$repo"
cp "$repo_root/mise.toml" "$repo_root/mise.lock" "$repo/"
cp -R "$repo_root/.mise" "$repo/"
mkdir -p "$repo/scripts" "$repo/src"
cp "$repo_root/scripts/semgrep.sh" "$repo/scripts/"
rules="$sandbox/rules.yml"
cat >"$rules" <<'EOF'
rules:
  - id: test-no-eval
    pattern: eval(...)
    message: eval runs a string as code
    languages: [typescript]
    severity: ERROR
  - id: test-no-console
    pattern: console.log(...)
    message: console.log is a warning only
    languages: [typescript]
    severity: WARNING
EOF
echo 'export const ok = 1;' >"$repo/src/ok.ts"
r() { in_sandbox_repo "$repo" "$@"; }
r git add -A
r git commit -qm base
r git update-ref refs/remotes/origin/main "$(r git rev-parse HEAD)"

scan() { r env -u GITHUB_BASE_REF SEMGREP_RULES="$rules" sh scripts/semgrep.sh; }
n=0
# change <file> <line>: a new branch from origin/main with one commit that writes <line> to src/<file>.
change() {
  n=$((n + 1))
  r git switch -q -C "case-$n" origin/main
  printf '%s\n' "$2" >"$repo/src/$1"
  r git add -A
  r git commit -qm "case $n"
}

change clean.ts 'export const x = 2;'
expect_exit 0 "passes a branch without findings" scan

change bad.ts 'export const run = (s: string) => eval(s);'
expect_exit 1 "fails on an ERROR finding that the branch adds" scan

change warn.ts 'console.log("hi");'
expect_exit 0 "passes a WARNING finding (CodeQL covers it)" scan

change ignored.ts 'export const run = (s: string) => eval(s); // nosemgrep: test-no-eval -- reason: test fixture'
expect_exit 0 "passes a finding silenced with nosemgrep" scan

# A finding that is already on the base is left to the code scanning alerts.
r git switch -q main
printf '%s\n' 'export const old = (s: string) => eval(s);' >"$repo/src/old.ts"
r git add -A
r git commit -qm "finding on main"
r git update-ref refs/remotes/origin/main "$(r git rev-parse HEAD)"
change other.ts 'export const y = 3;'
expect_exit 0 "passes when the finding is already on the base" scan

# In a pull request, the base is origin/$GITHUB_BASE_REF.
r git update-ref refs/remotes/origin/release "$(r git rev-parse case-2)"
r git switch -q -C case-release case-2
expect_exit 0 "compares with origin/\$GITHUB_BASE_REF" r env GITHUB_BASE_REF=release SEMGREP_RULES="$rules" sh scripts/semgrep.sh
expect_exit 2 "cannot scan when origin/\$GITHUB_BASE_REF does not exist" r env GITHUB_BASE_REF=missing SEMGREP_RULES="$rules" sh scripts/semgrep.sh

# Without mise the check reports that it cannot scan (exit 2), so CI fails instead of passing unchecked.
bin="$sandbox/bin"
mkdir "$bin"
for tool in git sh; do
  ln -s "$(command -v "$tool")" "$bin/$tool"
done
expect_exit 2 "cannot scan without mise" r env PATH="$bin" SEMGREP_RULES="$rules" sh scripts/semgrep.sh

# A broken rule file is a Semgrep error, not a finding, so the pre-push hook does not mistake it for one.
echo 'rules: [' >"$sandbox/broken.yml"
r git switch -q case-2
expect_exit 7 "reports a Semgrep error with Semgrep's exit code" r env -u GITHUB_BASE_REF SEMGREP_RULES="$sandbox/broken.yml" sh scripts/semgrep.sh

finish
