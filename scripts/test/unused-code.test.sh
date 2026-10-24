#!/usr/bin/env sh
# Tests for the Knip check (`pnpm lint:unused`, knip.jsonc) on a sandboxed copy of this repository.
# Each case adds one unused thing and expects the check to fail; the untouched copy must pass.
# Needs node_modules (pnpm install); the copy links to this repository's node_modules.
# Every git command here runs through in_sandbox_repo.
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

make_sandbox

# Copy the working tree (tracked files and untracked ones that are not ignored) into a sandbox repo.
# The file list is read from this repository before the copy is touched.
copy="$sandbox/copy"
mkdir "$copy"
(cd "$repo_root" && git ls-files -z -co --exclude-standard | xargs -0 tar -cf - 2>/dev/null) | tar -xf - -C "$copy"
ln -s "$repo_root/node_modules" "$copy/node_modules"
for dir in "$repo_root"/apps/* "$repo_root"/packages/* "$repo_root"/tools/*; do
  [ -d "$dir/node_modules" ] || continue
  ln -s "$dir/node_modules" "$copy/${dir#"$repo_root"/}/node_modules"
done
git init -q "$copy"
in_sandbox_repo "$copy" sh -c 'git add -A && git commit -qm base --no-verify'
reset() { in_sandbox_repo "$copy" sh -c 'git reset -q --hard && git clean -qfd -e node_modules'; }
knip() { in_sandbox_repo "$copy" "$repo_root/node_modules/.bin/knip" --no-progress; }

expect_exit 0 "passes on this repository" knip

reset
echo 'export const unusedValue = 1;' >>"$copy/apps/api/src/app.ts"
expect_exit 1 "fails on an export nothing imports" knip

reset
echo 'export const orphan = 1;' >"$copy/apps/web/src/orphan.ts"
expect_exit 1 "fails on a file nothing imports" knip

reset
sed -i.bak 's/"vite-plus": "catalog:"/"vite-plus": "catalog:", "jscpd": "catalog:"/' "$copy/apps/web/package.json"
expect_exit 1 "fails on a dependency the project does not use" knip

# treatConfigHintsAsErrors: an exception that is no longer needed fails, so it gets removed.
reset
sed -i.bak 's|"apps/api": {|"apps/api": { "ignoreDependencies": ["hono"],|' "$copy/knip.jsonc"
expect_exit 1 "fails on an ignoreDependencies entry for a dependency that is used" knip

# An export tagged @public (see apps/api/src/app.ts) is kept on purpose.
reset
printf '/** @public */\nexport const keptValue = 1;\n' >>"$copy/apps/api/src/app.ts"
expect_exit 0 "passes an unused export tagged @public" knip

# The agent skills under .agents/ are installed from upstream and are not this repository's code.
reset
mkdir -p "$copy/.agents/skills/example"
echo 'module.exports = {};' >"$copy/.agents/skills/example/unused.cjs"
expect_exit 0 "ignores a file under .agents/" knip

finish
