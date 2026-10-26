#!/usr/bin/env sh
# Tests for scripts/renovate.sh in a sandboxed repository. The preview output is tested in
# tools/scripts/src/checks/renovate-preview/ (#165).
# `validate` runs Renovate through `pnpm dlx`, so this test needs the network (CI has it).
# Every git command here runs through in_sandbox_repo.
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

make_sandbox
repo="$sandbox/repo"
git init -q "$repo"
mkdir -p "$repo/scripts"
cp "$repo_root/scripts/renovate.sh" "$repo/scripts/"
r() { in_sandbox_repo "$repo" "$@"; }

expect_exit 2 "renovate.sh: a missing subcommand is a usage error" r sh scripts/renovate.sh

# validate: renovate-config-validator --strict reads the config of the repository it runs in.
cp "$repo_root/renovate.jsonc" "$repo/renovate.jsonc"
expect_exit 0 "validate: passes this repository's renovate.jsonc" r sh scripts/renovate.sh validate

printf '{ "extends": ["config:best-practices"], "notAnOption": true }\n' >"$repo/renovate.jsonc"
expect_exit 1 "validate: fails on an unknown option" r sh scripts/renovate.sh validate

printf '{ "extends": ["config:best-practices"], "semanticCommits": "sometimes" }\n' >"$repo/renovate.jsonc"
expect_exit 1 "validate: fails on a bad value" r sh scripts/renovate.sh validate

finish
