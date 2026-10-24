#!/usr/bin/env sh
# Tests for scripts/check-adr-number.sh in a sandboxed repository, with a fake gh that lists the open PRs.
# Every git command here runs through in_sandbox_repo.
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

make_sandbox
repo="$sandbox/repo"
git init -q -b main "$repo"
mkdir -p "$repo/scripts" "$repo/docs/adr" "$sandbox/bin"
cp "$repo_root/scripts/check-adr-number.sh" "$repo/scripts/"
check="$repo/scripts/check-adr-number.sh"
r() { in_sandbox_repo "$repo" "$@"; }

# The fake gh prints $sandbox/prs.json, or fails like a dropped connection when the file is missing.
cat >"$sandbox/bin/gh" <<EOF
#!/bin/sh
[ -f "$sandbox/prs.json" ] || { echo 'Post "https://api.github.com/graphql": EOF' >&2; exit 1; }
cat "$sandbox/prs.json"
EOF
chmod +x "$sandbox/bin/gh"
PATH="$sandbox/bin:$PATH"
export PATH
prs() { printf '%s\n' "$1" >"$sandbox/prs.json"; }
none='[]'
other_0002='[{"number":7,"headRefName":"docs/other","files":[{"path":"docs/adr/0002-other.md"}]}]'
own_0002='[{"number":8,"headRefName":"docs/mine","files":[{"path":"docs/adr/0002-mine.md"}]}]'

echo a >"$repo/docs/adr/0001-a.md"
r git add -A
r git commit -qm base
r git update-ref refs/remotes/origin/main HEAD
r git switch -qc docs/mine

prs "$none"
expect_exit 0 "passes when the branch adds no ADR" r sh "$check"

echo b >"$repo/docs/adr/0002-mine.md"
expect_exit 0 "passes an untracked ADR with a free number" r sh "$check"
expect_exit 0 "prints the next number after it" r sh -c "sh '$check' | grep -qx 'next free ADR number: 0003'"

prs "$other_0002"
expect_exit 1 "fails when another open PR adds the same number" r sh "$check"

r git add -A
r git commit -qm mine
prs "$own_0002"
expect_exit 0 "ignores this branch's own PR" r sh "$check"

prs "$none"
echo c >"$repo/docs/adr/0001-again.md"
expect_exit 1 "fails when origin/main has the number" r sh "$check"
rm "$repo/docs/adr/0001-again.md"

rm -f "$sandbox/prs.json"
expect_exit 2 "fails, without checking, when gh cannot list the PRs" r sh "$check"

finish
