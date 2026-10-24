#!/usr/bin/env sh
# Mechanical checks for decisions recorded in docs/adr/. Run by the pre-commit hook and CI.
#   scripts/check-repo-policy.sh          check the working tree (CI, and by hand)
#   scripts/check-repo-policy.sh staged   check what is staged (pre-commit). Unstaged edits to other files,
#                                         such as a doc someone is still rewriting, cannot fail a commit.
set -eu

cd "$(git rev-parse --show-toplevel)"
root="$(pwd)"
if [ "${1:-}" = "staged" ]; then
  # Write the index into a temporary tree and run the same checks there.
  # `git ls-files` there still lists the index of this repository, and the tree holds exactly those files.
  tree="$(mktemp -d)"
  trap 'rm -rf "$tree"' EXIT
  git checkout-index --all --prefix="$tree/"
  # Kiro loads untracked steering files too, so they are checked even when not staged.
  git ls-files --others --exclude-standard -- '.kiro/steering/*.md' | while IFS= read -r file; do
    mkdir -p "$tree/$(dirname "$file")"
    cp "$file" "$tree/$file"
  done
  export GIT_WORK_TREE="$tree"
  export GIT_DIR="${GIT_DIR:-$(git rev-parse --absolute-git-dir)}"
  cd "$tree"
fi
status=0
fail() {
  echo "repo-policy: $1" >&2
  status=1
}

# ADR 0002: Nx runs tasks; Vite+ is toolchain only.
for manifest in $(git ls-files '*package.json'); do
  if grep -q '"@nx/vite"' "$manifest"; then
    fail "$manifest depends on @nx/vite. Targets come from package.json scripts (docs/adr/0002)."
  fi
done
for config in $(git ls-files '*vite.config.ts'); do
  if grep -qE '^  run[[:space:]]*:' "$config"; then
    fail "$config has a \`run\` block. Task running and caching belong to Nx (docs/adr/0002)."
  fi
done

# ADR 0001: lefthook owns Git hooks. `vp` creates .vite-hooks without committing it, so look at the real tree.
if [ -n "$(git ls-files .vite-hooks)" ] || [ -d "$root/.vite-hooks" ]; then
  fail ".vite-hooks exists. Git hooks are managed by lefthook.yml (docs/adr/0001)."
fi

# ADR 0003, 0009: one betterleaks version, pinned in mise.toml.
version="$(sed -n 's/^betterleaks[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' mise.toml)"
if [ -z "$version" ]; then
  fail "mise.toml must pin betterleaks to an exact version (docs/adr/0009)."
elif ! grep -qE "^betterleaksMinVersion[[:space:]]*=[[:space:]]*\"$version\"" .betterleaks.toml; then
  fail ".betterleaks.toml betterleaksMinVersion must equal the betterleaks version in mise.toml ($version)."
fi

# ADR 0007: apps/api/src uses Web standard APIs only, enforced by lint.overrides in vite.config.ts.
for rule in import/no-nodejs-modules no-restricted-imports no-restricted-globals; do
  # The severity is either on the rule line (`"rule": "error"`, `"rule": ["error", ...]`) or on the next line.
  if ! grep -A1 -E "\"$rule\":" vite.config.ts | tr -d '\n' | grep -qE "\"$rule\":[[:space:]]*\\[?[[:space:]]*\"error\""; then
    fail "vite.config.ts must set $rule to error for apps/api/src (docs/adr/0007)."
  fi
done

# docs/knowledge/steering-authoring.md: steering frontmatter. Malformed frontmatter is silently loaded as `always`.
for file in $(git ls-files '.kiro/steering/*.md') $(git ls-files --others --exclude-standard '.kiro/steering/*.md'); do
  problem="$(awk -v name="$(basename "$file" .md)" '
    NR == 1 { if ($0 != "---") { print "must start with a frontmatter block"; exit } next }
    /^---$/ { closed = 1; exit }
    /^inclusion:/ { inclusion = $2 }
    /^name:/ { n = $2 }
    /^description:[[:space:]]*[^[:space:]]/ { description = 1 }
    /^fileMatchPattern:/ { pattern = 1; if ($2 !~ /^\[/) array = "no" }
    END {
      if (!closed && NR > 1) { print "frontmatter is not closed"; exit }
      if (inclusion !~ /^(always|fileMatch|manual|auto)$/) print "inclusion must be always, fileMatch, manual or auto"
      if (n != name) print "name must be \"" name "\""
      if (!description) print "description is required"
      if (inclusion == "fileMatch" && !pattern) print "fileMatchPattern is required for inclusion: fileMatch"
      if (inclusion != "fileMatch" && pattern) print "fileMatchPattern is only for inclusion: fileMatch"
      if (array == "no") print "fileMatchPattern must be a one-line array"
    }' "$file")"
  if [ -n "$problem" ]; then
    echo "$problem" | while IFS= read -r line; do echo "repo-policy: $file: $line (docs/knowledge/steering-authoring.md)" >&2; done
    status=1
  fi
done

# Scripts that create or point git at another repository (git init / clone, git -C, --git-dir, GIT_DIR=).
# Run from a Git hook, such a script inherits GIT_DIR and GIT_INDEX_FILE and acts on this repository instead
# (docs/tooling/ci.md ("スクリプトのテスト")). Only tests isolated by scripts/test/lib.sh may do this.
# This file holds the pattern, and lib.sh is the isolation itself, so both are skipped.
other_repo_git='(^|[^[:alnum:]_-])git[[:space:]]+(init|clone)([[:space:]]|$)|git[[:space:]]+-C[[:space:]]|--git-dir|GIT_DIR='
for file in $(git ls-files -- '*.sh' '*.mjs' '*.js' '*.cjs' '*.ts' ':!.agents/' ':!.kiro/skills/' ':!scripts/test/lib.sh' ':!scripts/check-repo-policy.sh'); do
  grep -qE "$other_repo_git" "$file" || continue
  case "$file" in
    scripts/test/*.test.sh)
      # The pattern matches the literal line `. "$(dirname "$0")/lib.sh"`.
      # shellcheck disable=SC2016
      grep -qE '^\. "\$\(dirname "\$0"\)/lib\.sh"' "$file" && continue
      fail "$file runs git on another repository but does not source scripts/test/lib.sh."
      ;;
    *)
      fail "$file runs git on another repository. Move that code into a scripts/test/*.test.sh that sources lib.sh, or run git only on this repository."
      ;;
  esac
done

# ADR numbers are unique. Two branches can each take the next free number, and both ADRs can reach main
# without a merge conflict (docs/tooling/worktrees.md ("PR を出す")).
for number in $(git ls-files 'docs/adr/[0-9][0-9][0-9][0-9]-*.md' | sed 's|^docs/adr/\([0-9]\{4\}\)-.*|\1|' | sort | uniq -d); do
  fail "ADR $number is used by more than one file: $(git ls-files "docs/adr/$number-*.md" | tr '\n' ' ')"
done

# References to docs/ from outside docs/ (scripts, configs, AGENTS.md, steering, workflows).
# docs-check.sh only follows Markdown links inside docs/, so these plain-text paths are checked here.
#   docs/<path>.md               the file must exist
#   docs/<path>.md ("Heading")   the file must have a heading with that text (cite headings without numbers)
#   docs/adr/NNNN                an ADR with that number must exist
# .agents/ and .kiro/skills/ hold upstream skills; docs/ itself is covered by docs-check.sh;
# scripts/test/ cites missing docs on purpose.
refs="$(git ls-files -- ':!docs/' ':!.agents/' ':!.kiro/skills/' ':!scripts/test/' ':!pnpm-lock.yaml' |
  xargs grep -HoE '(^|[^A-Za-z0-9_./-])docs/([A-Za-z0-9_./-]+\.md( \(\\?"[^"\\]+\\?"\))?|adr/[0-9]{4}([^0-9-]|$))' 2>/dev/null || true)"
printf '%s\n' "$refs" | while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  source="${ref%%:*}"
  match="docs/${ref#*docs/}"
  case "$match" in
    docs/adr/[0-9][0-9][0-9][0-9]*.md*) path="${match%%.md*}.md" ;;
    docs/adr/[0-9][0-9][0-9][0-9]*)
      number="$(printf '%s' "$match" | cut -c10-13)"
      if ! ls docs/adr/"$number"-*.md >/dev/null 2>&1; then
        echo "repo-policy: $source cites docs/adr/$number, which does not exist." >&2
        echo fail
      fi
      continue
      ;;
    *) path="${match%%.md*}.md" ;;
  esac
  if [ ! -f "$path" ]; then
    echo "repo-policy: $source cites $path, which does not exist." >&2
    echo fail
    continue
  fi
  heading="$(printf '%s' "$match" | sed -n 's/^[^(]*(\\\{0,1\}"\([^"\\]*\)\\\{0,1\}")$/\1/p')"
  [ -n "$heading" ] || continue
  if ! grep -qxE "#+ ([0-9]+\. )?$(printf '%s' "$heading" | sed 's/[][\.*^$+?(){}|/]/\\&/g')" "$path"; then
    echo "repo-policy: $source cites the heading \"$heading\" in $path, which has no such heading." >&2
    echo fail
  fi
done | grep -q fail && status=1

exit "$status"
