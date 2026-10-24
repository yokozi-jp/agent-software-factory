#!/usr/bin/env sh
# SAST with the pinned Semgrep CE (docs/adr/0021). Fails only on ERROR findings that the base does not have:
# the findings that this branch adds. Findings already on the base are left to the code scanning alerts (CodeQL).
# The base is origin/$GITHUB_BASE_REF in a pull request, and origin/main elsewhere. The comparison starts at the merge base.
# The rules are the Semgrep Registry rulesets below, fetched on every run (their license does not allow copying
# them into this repository), so the check needs the network. SEMGREP_RULES replaces them (the tests use local rules).
# Semgrep runs through `mise exec`, so the version is the one pinned in mise.toml and mise.lock (docs/adr/0009).
# Silence a finding with `nosemgrep: <rule-id>` followed by the reason, on the line of the finding.
# Exit 1: a new finding. Exit 2 or more: the scan could not run (no mise, no base, no network, a Semgrep error).
# Run by the pre-push hook (which stops only on exit 1, so being offline does not block a push) and by CI (which fails on both).
set -eu

cd "$(git rev-parse --show-toplevel)"

if ! command -v mise >/dev/null 2>&1; then
  echo "semgrep: mise is not installed, so the code cannot be scanned. See docs/local-env-setup/setup.md (\"Ubuntu の初期セットアップ\")." >&2
  exit 2
fi

base="origin/${GITHUB_BASE_REF:-main}"
if ! git rev-parse -q --verify "$base^{commit}" >/dev/null 2>&1; then
  echo "semgrep: $base does not exist here, so new findings cannot be told apart. Run \`git fetch origin\`." >&2
  exit 2
fi
if ! merge_base="$(git merge-base "$base" HEAD 2>/dev/null)"; then
  echo "semgrep: HEAD shares no history with $base (a shallow clone?). Run \`git fetch --unshallow\`." >&2
  exit 2
fi

if [ -n "${SEMGREP_RULES:-}" ]; then
  set -- --config "$SEMGREP_RULES"
else
  set -- --config p/typescript --config p/react
fi

# --error: exit 1 on a finding. --metrics off: send no usage data. --severity ERROR: CodeQL covers the rest (docs/adr/0021).
exec mise exec -- semgrep scan "$@" \
  --baseline-commit "$merge_base" \
  --severity ERROR \
  --error \
  --metrics off \
  --disable-version-check \
  --quiet
