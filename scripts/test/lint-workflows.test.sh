#!/usr/bin/env sh
# Tests for scripts/lint-workflows.sh in a sandboxed repository with workflows written here.
# Needs mise with the tools in mise.lock installed (CI installs them before the script tests).
# Every git command here runs through in_sandbox_repo.
# The workflows below hold literal $VAR and ${{ }} text for the linters, so nothing may expand.
# shellcheck disable=SC2016
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

make_sandbox
repo="$sandbox/repo"
git init -q "$repo"
cp "$repo_root/mise.toml" "$repo_root/mise.lock" "$repo/"
# `mise exec` installs every missing tool in mise.toml, and Semgrep installs from its dependency graph in .mise/locks/.
cp -R "$repo_root/.mise" "$repo/"
mkdir -p "$repo/scripts" "$repo/.github/workflows"
cp "$repo_root/scripts/lint-workflows.sh" "$repo/scripts/"
lint="$repo/scripts/lint-workflows.sh"
workflow="$repo/.github/workflows/test.yml"
r() { in_sandbox_repo "$repo" "$@"; }

# write_workflow <steps>: a workflow that passes both tools, with <steps> as its job's steps.
write_workflow() {
  cat >"$workflow" <<EOF
name: Test
on:
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
$1
EOF
  r git add .github/workflows/test.yml
}

r git add mise.toml mise.lock scripts
r git commit -qm base
expect_exit 0 "passes when no workflow is tracked" r sh "$lint"

write_workflow '      - run: echo ok'
expect_exit 0 "passes a clean workflow" r sh "$lint"

# actionlint: an expression that refers to a step that does not exist.
write_workflow '      - run: echo "$OUT"
        env:
          OUT: ${{ steps.missing.outputs.value }}'
expect_exit 1 "actionlint finds an undefined step in an expression" r sh "$lint"

# actionlint runs the pinned shellcheck on run: scripts.
write_workflow '      - run: echo $HOME'
expect_exit 1 "shellcheck finds an unquoted variable in run:" r sh "$lint"

# zizmor (artipacked): checkout leaves the token in .git/config without persist-credentials: false.
write_workflow '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1'
expect_exit 1 "zizmor finds checkout without persist-credentials: false" r sh "$lint"

# Script injection: an attacker-controlled value expanded into a shell script.
# Both tools report it (actionlint: expression, zizmor: template-injection).
write_workflow '      - run: echo "${{ github.event.pull_request.title }}"'
expect_exit 1 "finds a PR title expanded into run:" r sh "$lint"

# Only tracked workflows are checked, so a scratch file cannot fail the check.
write_workflow '      - run: echo ok'
cp "$workflow" "$repo/.github/workflows/scratch.yml"
printf '      - run: echo $HOME\n' >>"$repo/.github/workflows/scratch.yml"
expect_exit 0 "ignores an untracked workflow" r sh "$lint"
rm "$repo/.github/workflows/scratch.yml"

# Without mise the check fails instead of passing unchecked.
bin="$sandbox/bin"
mkdir "$bin"
for tool in git sh xargs; do
  ln -s "$(command -v "$tool")" "$bin/$tool"
done
expect_exit 1 "fails without mise" r env PATH="$bin" sh "$lint"

finish
