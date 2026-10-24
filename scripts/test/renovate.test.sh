#!/usr/bin/env sh
# Tests for scripts/renovate.sh and scripts/renovate-preview.mjs in a sandboxed repository.
# `validate` runs Renovate through `pnpm dlx`, so this test needs the network (CI has it).
# Every git command here runs through in_sandbox_repo.
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

make_sandbox
repo="$sandbox/repo"
git init -q "$repo"
mkdir -p "$repo/scripts"
cp "$repo_root/scripts/renovate.sh" "$repo_root/scripts/renovate-preview.mjs" "$repo/scripts/"
r() { in_sandbox_repo "$repo" "$@"; }

expect_exit 2 "renovate.sh: a missing subcommand is a usage error" r sh scripts/renovate.sh

# validate: renovate-config-validator --strict reads the config of the repository it runs in.
cp "$repo_root/renovate.jsonc" "$repo/renovate.jsonc"
expect_exit 0 "validate: passes this repository's renovate.jsonc" r sh scripts/renovate.sh validate

printf '{ "extends": ["config:best-practices"], "notAnOption": true }\n' >"$repo/renovate.jsonc"
expect_exit 1 "validate: fails on an unknown option" r sh scripts/renovate.sh validate

printf '{ "extends": ["config:best-practices"], "semanticCommits": "sometimes" }\n' >"$repo/renovate.jsonc"
expect_exit 1 "validate: fails on a bad value" r sh scripts/renovate.sh validate

# preview prints the PRs from a Renovate log; the log below is the shape of the trace-level "branches" entry.
log="$sandbox/renovate.log"
preview() { r node scripts/renovate-preview.mjs "$log"; }
expect_exit 2 "preview: needs a log file" r node scripts/renovate-preview.mjs

printf 'not json\n{"msg":"other"}\n' >"$log"
expect_exit 1 "preview: fails when the log has no branch list" preview

cat >"$log" <<'EOF'
not json
{"msg":"branches","branches":[{"branchName":"renovate/betterleaks","prTitle":"chore(deps): update betterleaks to v1.9.0","upgrades":[{"depName":"betterleaks","currentVersion":"1.8.0","newVersion":"1.9.0","updateType":"minor"}]}]}
EOF
expect_exit 0 "preview: prints the branches of a log" preview
if r node scripts/renovate-preview.mjs "$log" | grep -q "chore(deps): update betterleaks to v1.9.0"; then
  passes=$((passes + 1))
else
  echo "FAIL: preview: the PR title is printed" >&2
  failures=$((failures + 1))
fi

finish
