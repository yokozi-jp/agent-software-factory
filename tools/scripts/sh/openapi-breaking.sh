#!/usr/bin/env sh
# Fail on a breaking change of the OpenAPI spec against the spec on the base branch (docs/adr/0047, Issue #190).
# Paths are relative to the repository root.
# Usage: openapi-breaking.sh [base-ref [spec]]   (default: origin/main, apps/api/openapi.json)
# oasdiff reads the base spec from git as <base-ref>:<spec>. It fails on ERR and only reports WARN.
# There is no file of exceptions. A breaking change goes in two steps (docs/web-api/versioning.md): add the new shape
# and mark the old one `deprecated: true` with `x-sunset`; remove the old one in a later pull request after the sunset date.
# oasdiff runs through `mise exec`, so the version is the one pinned in mise.toml and mise.lock (docs/adr/0009).
# Fails (instead of silently skipping) when mise is missing. Run by the contract-breaking target of apps/api and by CI.
# In GitHub Actions the result is also written to the job summary.
set -eu

cd "$(git rev-parse --show-toplevel)"

base=${1:-origin/main}
spec=${2:-apps/api/openapi.json}

if ! command -v mise >/dev/null 2>&1; then
  echo "openapi-breaking: mise is not installed, so the spec cannot be compared. See docs/local-env-setup/setup.md (\"Ubuntu の初期セットアップ\")." >&2
  exit 1
fi

report=$(mktemp)
trap 'rm -f "$report"' EXIT

status=0
mise exec -- oasdiff breaking "$base:$spec" "$spec" --fail-on ERR >"$report" 2>&1 || status=$?
cat "$report"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### oasdiff breaking ($base:$spec → $spec)"
    echo
    echo '```'
    cat "$report"
    echo '```'
  } >>"$GITHUB_STEP_SUMMARY"
fi

if [ "$status" -ne 0 ]; then
  echo "openapi-breaking: breaking change of $spec against $base. Do not remove or narrow it in this pull request." >&2
  echo "Add the new shape, mark the old one deprecated: true with x-sunset, and remove it in a later pull request after the sunset date (docs/web-api/versioning.md)." >&2
fi
exit "$status"
