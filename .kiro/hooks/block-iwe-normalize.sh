#!/usr/bin/env sh
# Kiro PreToolUse hook: refuse `iwe normalize` (docs/adr/0006).
# normalize rewrites every document under docs/ into IWE's Markdown style, which conflicts with oxfmt.
# The subcommand position is matched (flags may come first), so `iwe find normalize` is allowed.
# Covers the shell path (a command string running `iwe ... normalize`) and the MCP path (an iwe tool named *normalize*).
# Contract: hook event JSON on stdin; exit 2 refuses (stderr goes back to the agent), exit 0 allows.
# Fail-open: anything that cannot be parsed is allowed. Override with IWE_ALLOW_NORMALIZE=1.
set -u

[ "${IWE_ALLOW_NORMALIZE:-}" = "1" ] && exit 0

payload="$(cat 2>/dev/null || true)"
[ -n "$payload" ] || exit 0

tool_name=""
command_str=""
if command -v jq >/dev/null 2>&1; then
  tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"
  command_str="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
fi

refuse() {
  echo "block-iwe-normalize: refused. \`iwe normalize\` rewrites every document under docs/ (docs/adr/0006). Edit files directly instead; see docs/knowledge/documentation-authoring.md." >&2
  exit 2
}

lc_tool="$(printf '%s' "$tool_name" | tr '[:upper:]' '[:lower:]')"
case "$lc_tool" in
  *iwe*normalize* | *normalize*iwe*) refuse ;;
esac

haystack="${command_str:-$payload}"
if printf '%s' "$haystack" | tr '[:upper:]' '[:lower:]' \
  | grep -Eq '(^|[^[:alnum:]_.-])iwe([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+normalize([^[:alnum:]_-]|$)'; then
  refuse
fi

exit 0
