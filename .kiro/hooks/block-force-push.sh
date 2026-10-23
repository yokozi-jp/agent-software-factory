#!/usr/bin/env sh
# Kiro PreToolUse hook: refuse `git push` with --force, --force-with-lease, -f or a `+refspec`.
# A force push rewrites a shared branch; the user runs it themselves after reviewing the history.
# Contract: hook event JSON on stdin; exit 2 refuses (stderr goes back to the agent), exit 0 allows.
# Fail-open: anything that cannot be parsed is allowed. Override with KIRO_ALLOW_FORCE_PUSH=1.
set -u

[ "${KIRO_ALLOW_FORCE_PUSH:-}" = "1" ] && exit 0

payload="$(cat 2>/dev/null || true)"
[ -n "$payload" ] || exit 0

command_str=""
if command -v jq >/dev/null 2>&1; then
  command_str="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
fi
haystack="${command_str:-$payload}"

# Look at each `git ... push ...` segment up to the next shell separator.
if printf '%s' "$haystack" | tr ';&|\n' '\n\n\n\n' \
  | grep -E '(^|[[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+push([[:space:]]|$)' \
  | grep -Eq '[[:space:]](--force(-with-lease|-if-includes)?(=[^[:space:]]*)?|-[[:alnum:]]*f[[:alnum:]]*|\+[^[:space:]]+)([[:space:]]|$)'; then
  echo "block-force-push: refused. Force push rewrites the remote branch. Ask the user to run it, or merge without rewriting history (PRs are squash merged, docs/adr/0004)." >&2
  exit 2
fi

exit 0
