#!/usr/bin/env sh
# Mechanical checks for decisions recorded in docs/adr/. Run by the pre-commit hook and CI.
set -eu

cd "$(git rev-parse --show-toplevel)"
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

# ADR 0001: lefthook owns Git hooks.
if [ -n "$(git ls-files .vite-hooks)" ] || [ -d .vite-hooks ]; then
  fail ".vite-hooks exists. Git hooks are managed by lefthook.yml (docs/adr/0001)."
fi

# ADR 0003: one betterleaks version, defined in .betterleaks-version.
version="$(tr -d '[:space:]' < .betterleaks-version)"
if ! grep -qE "^betterleaksMinVersion[[:space:]]*=[[:space:]]*\"$version\"" .betterleaks.toml; then
  fail ".betterleaks.toml betterleaksMinVersion must equal .betterleaks-version ($version)."
fi

# ADR 0007: apps/api/src uses Web standard APIs only, enforced by lint.overrides in vite.config.ts.
for rule in import/no-nodejs-modules no-restricted-imports no-restricted-globals; do
  # Matches `"rule": "error"` and `"rule": [` (options on the following lines).
  if ! grep -qE "\"$rule\": (\"error\"|\\[)" vite.config.ts; then
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

exit "$status"
