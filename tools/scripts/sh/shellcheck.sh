#!/usr/bin/env sh
# Lint the repo's shell scripts with the pinned shellcheck (docs/adr/0008).
# Checks every tracked or staged *.sh except .agents/, which holds upstream skills that must stay byte-identical.
# The linter runs through `mise exec`, so the version is the one pinned in mise.toml and mise.lock (docs/adr/0009).
# Fails (instead of silently skipping) when mise is missing.
# Run by the pre-commit hook (when a *.sh file changes) and by CI.
set -eu

cd "$(git rev-parse --show-toplevel)"

if ! command -v mise >/dev/null 2>&1; then
  echo "shellcheck: mise is not installed, so shell scripts cannot be linted. See docs/local-env-setup/setup.md (\"Ubuntu の初期セットアップ\")." >&2
  exit 1
fi

git ls-files -z -- '*.sh' ':!.agents/' | xargs -0 mise exec -- shellcheck
