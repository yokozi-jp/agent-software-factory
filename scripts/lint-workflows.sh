#!/usr/bin/env sh
# Lint the tracked GitHub Actions workflows with the pinned actionlint and zizmor (docs/adr/0012).
# actionlint checks syntax and expression types, and runs the pinned shellcheck on run: scripts.
# zizmor checks for security problems (template injection, excessive permissions, persisted credentials).
# zizmor runs --offline, so the result does not depend on whether a GitHub token is set.
# The linters run through `mise exec`, so the versions are the ones pinned in mise.toml and mise.lock (docs/adr/0009).
# Fails (instead of silently skipping) when mise is missing. Exits 1 when either tool reports a finding.
# Run by the pre-commit hook (when a workflow changes) and by CI.
set -eu

cd "$(git rev-parse --show-toplevel)"

if ! command -v mise >/dev/null 2>&1; then
  echo "lint-workflows: mise is not installed, so workflows cannot be linted. See docs/local-env-setup/setup.md (\"Ubuntu の初期セットアップ\")." >&2
  exit 1
fi

workflows() {
  git ls-files -z -- '.github/workflows/*.yml' '.github/workflows/*.yaml'
}

if [ -z "$(workflows | tr -d '\000')" ]; then
  exit 0
fi

status=0
workflows | xargs -0 mise exec -- actionlint || status=1
workflows | xargs -0 mise exec -- zizmor --offline || status=1
exit "$status"
