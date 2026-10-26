#!/usr/bin/env sh
# Tests for scripts/check-repo-policy.sh and scripts/docs-check.sh.
# Each case breaks one thing and expects the check to fail; the untouched tree must pass.
#   repo-policy: one throwaway copy of this repo, put back to its first commit between cases.
#   docs-check:  this repo's docs/ is checked once; the failure cases run against a small docs/ fixture,
#                because iwe reads every document and the real docs/ takes seconds per run.
# Needs node_modules (pnpm install) for node_modules/.bin/iwe.
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

make_sandbox

# Copy the working tree into a sandbox repo and commit it; reuse node_modules via a symlink.
# Untracked files that are not ignored are copied too, so a new file counts before it is staged.
# The file list is read from this repo before the copy is touched; every git command after that runs in the copy.
copy="$sandbox/copy"
mkdir "$copy"
(cd "$repo_root" && git ls-files -z -co --exclude-standard | xargs -0 tar -cf - 2>/dev/null) | tar -xf - -C "$copy"
ln -s "$repo_root/node_modules" "$copy/node_modules"
git init -q "$copy"
in_sandbox_repo "$copy" sh -c 'git add -A && git commit -qm base --no-verify'
# Put the copy back to the base commit, dropping untracked files except the node_modules link.
reset() { in_sandbox_repo "$copy" sh -c 'git reset -q --hard && git clean -qfd -e node_modules'; }
stage() { in_sandbox_repo "$copy" git add -A; }
policy() { in_sandbox_repo "$copy" sh scripts/check-repo-policy.sh; }
staged_policy() { in_sandbox_repo "$copy" sh scripts/check-repo-policy.sh staged; }

expect_exit 0 "repo-policy passes on this repo" policy
expect_exit 0 "repo-policy staged: passes on this repo" staged_policy
expect_exit 0 "docs-check passes on this repo" in_sandbox_repo "$copy" sh scripts/docs-check.sh

# check-repo-policy: references to docs/ from outside docs/.
reset
echo "# see docs/tooling/missing.md" >> "$copy/lefthook.yml" && stage
expect_exit 1 "repo-policy: cited docs file must exist" policy
reset
echo "# see docs/local-env-setup/setup.md (\"No such heading\")" >> "$copy/lefthook.yml" && stage
expect_exit 1 "repo-policy: cited heading must exist" policy
reset
echo "# see docs/local-env-setup/setup.md (\"VS Code で開く\")" >> "$copy/lefthook.yml" && stage
expect_exit 0 "repo-policy: a heading is matched without its number" policy
reset
echo "# docs/adr/9999" >> "$copy/lefthook.yml" && stage
expect_exit 1 "repo-policy: cited ADR number must exist" policy
reset
# Two branches each took the next free number; both ADRs reached main.
cp "$copy/docs/adr/0001-lefthook-for-git-hooks.md" "$copy/docs/adr/0001-duplicate.md" && stage
expect_exit 1 "repo-policy: two ADRs cannot share a number" policy

# check-repo-policy staged: only what is staged counts.
reset
# Someone is rewriting setup.md and has not staged it: the heading that scripts cite is gone from the working tree.
sed -i.bak 's/^## 3\. Ubuntu の初期セットアップ$/## 3. 書き直し中/' "$copy/docs/local-env-setup/setup.md"
expect_exit 1 "repo-policy: the working tree check sees the unstaged edit" policy
expect_exit 0 "repo-policy staged: an unstaged edit to another file does not fail" staged_policy
stage
expect_exit 1 "repo-policy staged: the same edit fails once it is staged" staged_policy

# check-repo-policy: ADR decisions.
reset
sed -i.bak 's/"nx": "catalog:",/"nx": "catalog:", "@nx\/vite": "24.0.0",/' "$copy/package.json" && stage
expect_exit 1 "repo-policy: @nx/vite is refused (ADR 0002)" policy
reset
mkdir "$copy/.vite-hooks"
expect_exit 1 "repo-policy: .vite-hooks is refused (ADR 0001)" policy
reset
sed -i.bak 's/^betterleaks = .*/betterleaks = "9.9.9"/' "$copy/mise.toml" && stage
expect_exit 1 "repo-policy: betterleaks versions must agree (ADR 0003)" policy
reset
printf 'no frontmatter\n' > "$copy/.kiro/steering/broken.md"
expect_exit 1 "repo-policy: steering frontmatter is required" policy

# check-repo-policy: one Node.js major version (ADR 0013). .node-version decides; the others must agree.
node_major="$(sed -n 's/^v\{0,1\}\([0-9][0-9]*\).*/\1/p' "$repo_root/.node-version" | head -n 1)"
other_major=$((node_major + 1))
reset
printf 'v%s.1.2\n' "$node_major" > "$copy/.node-version" && stage
expect_exit 0 "repo-policy: .node-version may be an exact version with a v" policy
reset
printf '%s\n' "$other_major" > "$copy/.node-version" && stage
expect_exit 1 "repo-policy: .node-version moving alone is refused (ADR 0013)" policy
reset
printf 'lts\n' > "$copy/.node-version" && stage
expect_exit 1 "repo-policy: .node-version must start with a version (ADR 0013)" policy
reset
sed -i.bak "s/\"node\": \"[^\"]*\"/\"node\": \">=$other_major\"/" "$copy/package.json" && stage
expect_exit 1 "repo-policy: engines.node must follow .node-version (ADR 0013)" policy
reset
sed -i.bak "s/\"@types\/node\": [^ ]*/\"@types\/node\": ^$other_major/" "$copy/pnpm-workspace.yaml" && stage
expect_exit 1 "repo-policy: the @types/node catalog must follow .node-version (ADR 0013)" policy
reset
sed -i.bak "s/target: \"node[0-9]*\"/target: \"node$other_major\"/" "$copy/apps/api/vite.config.ts" && stage
expect_exit 1 "repo-policy: the API build target must follow .node-version (ADR 0013)" policy

# check-repo-policy: git on another repository only from tests isolated by lib.sh.
# Each new script is executable, and the new test is listed, so only the git rule can fail the case.
reset
printf '#!/bin/sh\ngit init -q /tmp/x\n' > "$copy/scripts/make-repo.sh" && chmod +x "$copy/scripts/make-repo.sh" && stage
expect_exit 1 "repo-policy: git init outside scripts/test is refused" policy
reset
# $1 belongs to the generated script.
# shellcheck disable=SC2016
printf '#!/bin/sh\ngit -C "$1" commit -m x\n' > "$copy/.kiro/hooks/other.sh" && chmod +x "$copy/.kiro/hooks/other.sh" && stage
expect_exit 1 "repo-policy: git -C outside scripts/test is refused" policy
reset
printf '#!/bin/sh\nset -u\ngit clone -q a b\n' > "$copy/scripts/test/bare.test.sh" && chmod +x "$copy/scripts/test/bare.test.sh"
sed -i.bak 's|tests="|tests="scripts/test/bare.test.sh |' "$copy/.github/workflows/ci.yml"
printf '    - name: bare\n      run: sh scripts/test/run.sh scripts/test/bare.test.sh\n' >> "$copy/lefthook.yml" && stage
expect_exit 1 "repo-policy: a test that does not source lib.sh is refused" policy
reset
# TypeScript in tools/scripts is guarded by the lint rule on child_process and by isolation.test.ts instead.
printf '// git -C dir, git init, GIT_DIR=x\nexport const x = 1;\n' > "$copy/tools/scripts/src/checks/other.ts" && stage
expect_exit 0 "repo-policy: the git pattern does not apply to the TypeScript in tools/scripts/src" policy
reset
# The tests of adr-check name ADRs that do not exist on purpose, as the sh tests in scripts/test/ do.
printf '// docs/adr/9999\n' > "$copy/tools/scripts/src/checks/adr-check/other.test.ts" && stage
expect_exit 0 "repo-policy: docs cited by the tests of adr-check are not checked" policy
reset
printf '// docs/adr/9999\n' > "$copy/tools/scripts/src/checks/other.test.ts" && stage
expect_exit 1 "repo-policy: docs cited by the other tests of tools/scripts must exist" policy
reset
printf '// docs/tooling/missing.md\nexport const x = 1;\n' > "$copy/tools/scripts/src/checks/other.ts" && stage
expect_exit 1 "repo-policy: docs cited by the other code of tools/scripts must exist" policy

# check-repo-policy: every script test runs in a workflow and in the pre-commit hook.
listed_test() {
  printf '#!/bin/sh\n' > "$copy/scripts/test/new.test.sh" && chmod +x "$copy/scripts/test/new.test.sh"
}
reset
listed_test
sed -i.bak 's|tests="|tests="scripts/test/new.test.sh |' "$copy/.github/workflows/ci.yml"
printf '    - name: new\n      run: sh scripts/test/run.sh scripts/test/new.test.sh\n' >> "$copy/lefthook.yml" && stage
expect_exit 0 "repo-policy: a test listed in ci.yml and lefthook.yml passes" policy
reset
listed_test
printf '    - name: new\n      run: sh scripts/test/run.sh scripts/test/new.test.sh\n' >> "$copy/lefthook.yml" && stage
expect_exit 1 "repo-policy: a test that no workflow runs is refused" policy
reset
listed_test
sed -i.bak 's|tests="|tests="scripts/test/new.test.sh |' "$copy/.github/workflows/ci.yml" && stage
expect_exit 1 "repo-policy: a test that the pre-commit hook does not run is refused" policy
reset
listed_test
sed -i.bak 's|tests="|tests="scripts/test/new.test.sh |' "$copy/.github/workflows/ci.yml"
printf '    # scripts/test/new.test.sh\n' >> "$copy/lefthook.yml" && stage
expect_exit 1 "repo-policy: a test named only in a comment is refused" policy

# check-repo-policy: every job of ci.yml other than `main` is in the needs of `main`.
# Once ci.yml is split, `main` already has a needs line. Add `extra` to it; otherwise write the line.
reset
printf '  extra:\n    runs-on: ubuntu-26.04\n    steps: []\n' >> "$copy/.github/workflows/ci.yml" && stage
expect_exit 1 "repo-policy: a ci.yml job that main does not need is refused" policy
reset
printf '  extra:\n    runs-on: ubuntu-26.04\n    steps: []\n' >> "$copy/.github/workflows/ci.yml"
if grep -q '^    needs: \[' "$copy/.github/workflows/ci.yml"; then
  sed -i.bak 's|^    needs: \[|    needs: [extra, |' "$copy/.github/workflows/ci.yml"
else
  sed -i.bak 's|^  main:$|  main:\n    needs: [extra]|' "$copy/.github/workflows/ci.yml"
fi
stage
expect_exit 0 "repo-policy: a ci.yml job that main needs passes" policy
reset
printf '  extra:\n    runs-on: ubuntu-26.04\n    steps: []\n' >> "$copy/.github/workflows/ci.yml"
sed -i.bak '/^    needs:/d' "$copy/.github/workflows/ci.yml"
sed -i.bak 's|^  main:$|  main:\n    needs:\n      - extra|' "$copy/.github/workflows/ci.yml" && stage
expect_exit 1 "repo-policy: needs of main in a block list is refused" policy

# check-repo-policy: shell scripts are executable in git. The staged mode counts, not the file on disk.
reset
chmod -x "$copy/scripts/guard-push.sh" && stage
expect_exit 1 "repo-policy: a non-executable shell script is refused" policy
expect_exit 1 "repo-policy staged: a non-executable shell script is refused" staged_policy

# docs-check against a small docs/ fixture: the repo's schemas and scripts, and a few documents.
#   tooling/index.md -> a.md (Reference), b.md (has "## 見出し")
#   guide/index.md   -> about.md (cites the imported forLog), page.md
fixture="$sandbox/fixture"
fixture_doc() {
  mkdir -p "$fixture/docs/$(dirname "$1")"
  printf -- '---\ntype: %s\ntitle: %s\ndescription: d\ntags: [t]\n%b---\n\n# %s\n\n%s\n' "$2" "$1" "${4:-}" "$1" "$3" > "$fixture/docs/$1"
}
fresh_fixture() {
  rm -rf "$fixture"
  mkdir -p "$fixture/scripts" "$fixture/docs/tooling" "$fixture/docs/guide"
  cp -R "$repo_root/docs/.iwe" "$fixture/docs/.iwe"
  cp "$repo_root/scripts/docs-check.sh" "$repo_root/scripts/docs-links.mjs" "$fixture/scripts/"
  ln -s "$repo_root/node_modules" "$fixture/node_modules"
  printf -- '---\nokf_version: "0.2"\n---\n\n# Docs\n\n- [Tooling](tooling/index.md)：t\n- [Guide](guide/index.md)：t\n' > "$fixture/docs/index.md"
  printf '# Tooling\n\n- [A](a.md)：t\n- [B](b.md)：t\n' > "$fixture/docs/tooling/index.md"
  printf '# Guide\n\n- [About](about.md)：t\n- [Page](page.md)：t\n' > "$fixture/docs/guide/index.md"
  fixture_doc tooling/a.md Reference "See [b](b.md#見出し)."
  fixture_doc tooling/b.md Reference "## 見出し"
  fixture_doc guide/about.md Reference "[原文](https://future-architect.github.io/arch-guidelines/documents/forLog/)" \
    'sources:\n  - resource: https://future-architect.github.io/arch-guidelines/documents/forLog/\n'
  fixture_doc guide/page.md Convention "p"
  git init -q "$fixture"
}
docs() { in_sandbox_repo "$fixture" sh scripts/docs-check.sh; }

fresh_fixture
expect_exit 0 "docs-check: the fixture passes" docs
fresh_fixture
sed -i.bak 's/^type: Reference$/type: Guide/' "$fixture/docs/tooling/a.md" && rm "$fixture/docs/tooling/a.md.bak"
expect_exit 1 "docs-check: type must be in the vocabulary" docs
fresh_fixture
printf -- '---\ntype: Reference\ntitle: x\n---\n\n# x\n' > "$fixture/docs/tooling/stray.md"
expect_exit 1 "docs-check: missing frontmatter fields and orphans fail" docs
fresh_fixture
# `javascript: x` in an unquoted value is invalid YAML; the check names the cause instead of leaving iwe's "required property".
sed -i.bak 's/^description: d$/description: javascript: x/' "$fixture/docs/tooling/a.md" && rm "$fixture/docs/tooling/a.md.bak"
expect_exit 1 "docs-check: an unquoted frontmatter value with a colon fails" docs
fresh_fixture
sed -i.bak 's/^description: d$/description: "javascript: x"/' "$fixture/docs/tooling/a.md" && rm "$fixture/docs/tooling/a.md.bak"
expect_exit 0 "docs-check: a quoted frontmatter value with a colon passes" docs
fresh_fixture
echo "See [missing](missing.md)." >> "$fixture/docs/tooling/a.md"
expect_exit 1 "docs-check: broken links fail" docs
fresh_fixture
echo "See [b](b.md#no-such-heading)." >> "$fixture/docs/tooling/a.md"
expect_exit 1 "docs-check: a link to a missing heading of another document fails" docs
fresh_fixture
echo "See [log](https://future-architect.github.io/arch-guidelines/documents/forLog/log_guidelines.html)." >> "$fixture/docs/guide/page.md"
expect_exit 1 "docs-check: a link to the site of an imported guideline fails" docs
fresh_fixture
echo "See [aws](https://future-architect.github.io/arch-guidelines/documents/forAWS/aws_guidelines.html)." >> "$fixture/docs/guide/page.md"
expect_exit 0 "docs-check: a link to the site of a guideline that is not imported passes" docs
fresh_fixture
# Over 250 lines is a review reminder, not an error: the check still passes (warning only).
yes '' | head -n 300 >> "$fixture/docs/tooling/a.md"
expect_exit 0 "docs-check: over 250 lines warns but does not fail" docs
fresh_fixture
# An index link line without a "：when to read" note fails.
echo '- [A](a.md)' >> "$fixture/docs/tooling/index.md"
expect_exit 1 "docs-check: index link line needs a when-to-read note" docs
fresh_fixture
# A half-width colon is not the full-width colon (：) the convention uses, so it also fails.
echo '- [A](a.md): foo' >> "$fixture/docs/tooling/index.md"
expect_exit 1 "docs-check: index note must use the full-width colon" docs
fresh_fixture
# `iwe create` writes links without the suffix; GitHub cannot follow them.
echo "See [b](b)." >> "$fixture/docs/tooling/a.md"
expect_exit 1 "docs-check: a link to a document without .md fails" docs
fresh_fixture
echo "See [b](b#見出し)." >> "$fixture/docs/tooling/a.md"
expect_exit 1 "docs-check: a link with a heading but without .md fails" docs
fresh_fixture
# Code is not a link: an example in a fenced block or in inline code passes.
# The backticks are literal text for the document, not a command substitution.
# shellcheck disable=SC2016
printf 'Use `[b](b)` like this:\n\n```md\n[b](b)\n```\n' >> "$fixture/docs/tooling/a.md"
expect_exit 0 "docs-check: a link example in code passes" docs

# docs-check staged: a staged change to an imported area (guide/, whose about.md cites forLog) needs its about.md.
staged_docs() { in_sandbox_repo "$fixture" sh scripts/docs-check.sh staged; }
fixture_base() { fresh_fixture && in_sandbox_repo "$fixture" sh -c 'git add -A && git commit -qm base --no-verify'; }
fixture_base
echo "more" >> "$fixture/docs/guide/page.md" && in_sandbox_repo "$fixture" git add -A
expect_exit 1 "docs-check staged: a change to an imported area without its about.md fails" staged_docs
expect_exit 0 "docs-check: without staged, the same change passes (CI)" docs
echo "- page.md を変えた。" >> "$fixture/docs/guide/about.md" && in_sandbox_repo "$fixture" git add -A
expect_exit 0 "docs-check staged: the change passes once about.md is staged too" staged_docs
fixture_base
echo "more" >> "$fixture/docs/tooling/a.md" && in_sandbox_repo "$fixture" git add -A
expect_exit 0 "docs-check staged: a change to an area that is not imported passes" staged_docs
fixture_base
echo "more" >> "$fixture/docs/guide/page.md"
expect_exit 0 "docs-check staged: an unstaged change to an imported area does not count" staged_docs

finish
