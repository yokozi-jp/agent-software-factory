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

exit "$status"
