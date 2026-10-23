#!/usr/bin/env sh
# Tests for scripts/check-repo-policy.sh and scripts/docs-check.sh against a throwaway copy of this repo.
# Each case breaks one thing in the copy and expects the check to fail; the untouched copy must pass.
# Needs node_modules (pnpm install) for node_modules/.bin/iwe.
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

make_sandbox

# Copy tracked files (including staged ones) into a fresh sandbox repo; reuse node_modules via a symlink.
# The file list is read from this repo before the copy is touched; every git command after that runs in the copy.
files="$sandbox/files"
(cd "$repo_root" && git ls-files -z) > "$files"
fresh_copy() {
  copy="$sandbox/copy"
  rm -rf "$copy"
  mkdir "$copy"
  (cd "$repo_root" && xargs -0 tar -cf - < "$files" 2>/dev/null) | tar -xf - -C "$copy"
  ln -s "$repo_root/node_modules" "$copy/node_modules"
  git init -q "$copy"
  stage
}
stage() { in_sandbox_repo "$copy" git add -A; }
policy() { in_sandbox_repo "$copy" sh scripts/check-repo-policy.sh; }
docs() { in_sandbox_repo "$copy" sh scripts/docs-check.sh; }

fresh_copy
expect_exit 0 "repo-policy passes on this repo" policy
expect_exit 0 "docs-check passes on this repo" docs

# check-repo-policy: references to docs/ from outside docs/.
fresh_copy
echo "# see docs/tooling/missing.md" >> "$copy/lefthook.yml" && stage
expect_exit 1 "repo-policy: cited docs file must exist" policy
fresh_copy
echo "# see docs/local-env-setup/setup.md (\"No such heading\")" >> "$copy/lefthook.yml" && stage
expect_exit 1 "repo-policy: cited heading must exist" policy
fresh_copy
echo "# see docs/local-env-setup/setup.md (\"betterleaks\")" >> "$copy/lefthook.yml" && stage
expect_exit 0 "repo-policy: a heading is matched without its number" policy
fresh_copy
echo "# docs/adr/9999" >> "$copy/lefthook.yml" && stage
expect_exit 1 "repo-policy: cited ADR number must exist" policy

# check-repo-policy: ADR decisions.
fresh_copy
sed -i.bak 's/"nx": "catalog:",/"nx": "catalog:", "@nx\/vite": "24.0.0",/' "$copy/package.json" && stage
expect_exit 1 "repo-policy: @nx/vite is refused (ADR 0002)" policy
fresh_copy
mkdir "$copy/.vite-hooks"
expect_exit 1 "repo-policy: .vite-hooks is refused (ADR 0001)" policy
fresh_copy
echo "9.9.9" > "$copy/.betterleaks-version"
expect_exit 1 "repo-policy: betterleaks versions must agree (ADR 0003)" policy
fresh_copy
printf 'no frontmatter\n' > "$copy/.kiro/steering/broken.md"
expect_exit 1 "repo-policy: steering frontmatter is required" policy

# check-repo-policy: git on another repository only from tests isolated by lib.sh.
fresh_copy
printf '#!/bin/sh\ngit init -q /tmp/x\n' > "$copy/scripts/make-repo.sh" && stage
expect_exit 1 "repo-policy: git init outside scripts/test is refused" policy
fresh_copy
# $1 belongs to the generated script.
# shellcheck disable=SC2016
printf '#!/bin/sh\ngit -C "$1" commit -m x\n' > "$copy/.kiro/hooks/other.sh" && stage
expect_exit 1 "repo-policy: git -C outside scripts/test is refused" policy
fresh_copy
printf '#!/bin/sh\nset -u\ngit clone -q a b\n' > "$copy/scripts/test/bare.test.sh" && stage
expect_exit 1 "repo-policy: a test that does not source lib.sh is refused" policy

# docs-check: OKF schema, links, orphans.
fresh_copy
sed -i.bak 's/^type: Reference$/type: Guide/' "$copy/docs/tooling/ci.md"
expect_exit 1 "docs-check: type must be in the vocabulary" docs
fresh_copy
printf -- '---\ntype: Reference\ntitle: x\n---\n\n# x\n' > "$copy/docs/tooling/stray.md"
expect_exit 1 "docs-check: missing frontmatter fields and orphans fail" docs
fresh_copy
echo "See [missing](missing.md)." >> "$copy/docs/tooling/ci.md"
expect_exit 1 "docs-check: broken links fail" docs
fresh_copy
# Over 250 lines is a review reminder, not an error: the check still passes (warning only).
{ cat "$copy/docs/tooling/ci.md"; yes '' | head -n 300; } > "$copy/docs/tooling/ci.md.big" && mv "$copy/docs/tooling/ci.md.big" "$copy/docs/tooling/ci.md"
expect_exit 0 "docs-check: over 250 lines warns but does not fail" docs
fresh_copy
# An index link line without a "：when to read" note fails.
echo '- [commands](commands.md)' >> "$copy/docs/tooling/index.md"
expect_exit 1 "docs-check: index link line needs a when-to-read note" docs
fresh_copy
# A half-width colon is not the full-width colon (：) the convention uses, so it also fails.
echo '- [commands](commands.md): foo' >> "$copy/docs/tooling/index.md"
expect_exit 1 "docs-check: index note must use the full-width colon" docs

finish
