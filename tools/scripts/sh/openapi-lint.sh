#!/usr/bin/env sh
# Lint the OpenAPI spec of the API with the pinned Spectral (docs/adr/0047, Issue #190).
# Paths are relative to the repository root.
# Usage: openapi-lint.sh [spec [ruleset]]   (default: apps/api/openapi.json, .spectral.yaml)
# --fail-severity=warn makes a warning of spectral:oas fail like an error. The messages of the rules say how to fix.
# Spectral runs through `mise exec`, so the version is the one pinned in mise.toml and mise.lock (docs/adr/0009).
# Fails (instead of silently skipping) when mise is missing. Run by the contract-lint target of apps/api and by CI.
set -eu

cd "$(git rev-parse --show-toplevel)"

spec=${1:-apps/api/openapi.json}
ruleset=${2:-.spectral.yaml}

if ! command -v mise >/dev/null 2>&1; then
  echo "openapi-lint: mise is not installed, so the spec cannot be linted. See docs/local-env-setup/setup.md (\"Ubuntu の初期セットアップ\")." >&2
  exit 1
fi

mise exec -- spectral lint "$spec" --ruleset "$ruleset" --fail-severity=warn
