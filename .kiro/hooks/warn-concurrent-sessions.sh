#!/usr/bin/env sh
# Kiro hook: warn when another live Kiro session works in the same directory.
# Two sessions sharing one working tree overwrite each other's index and files; use a worktree instead
# (docs/tooling/worktrees.md).
# - SessionStart (no argument): print a warning. stdout of a SessionStart hook is added to the agent's context.
# - PreToolUse (--pre-tool-use): before a write or shell tool, ask the user to confirm. Catches sessions that
#   started after this one. stdout of a PreToolUse hook is read as a permissionDecision, not added to the context.
#   Asks once per set of other sessions: a marker in $KIRO_HOOK_STATE_DIR remembers the sets already asked about.
# Sessions are read from ~/.kiro/sessions/cli: <id>.lock holds the pid, <id>.json holds the cwd.
# Stale locks are skipped (pid not running, or not a kiro process), and so are sessions in this process.
# Always exits 0: this hook only informs.
set -u

mode="session-start"
[ "${1:-}" = "--pre-tool-use" ] && mode="pre-tool-use"

sessions="${KIRO_SESSIONS_DIR:-$HOME/.kiro/sessions/cli}"
[ -d "$sessions" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

here="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
own_pid=""
if [ -n "${KIRO_SESSION_ID:-}" ]; then
  own_pid="$(jq -r '.pid // empty' "$sessions/$KIRO_SESSION_ID.lock" 2>/dev/null || true)"
  # The session files are not a documented interface. When this session's own record cannot be read,
  # the format has probably changed and no other session would be detected either, so say so.
  own_cwd="$(jq -r '.cwd // empty' "$sessions/$KIRO_SESSION_ID.json" 2>/dev/null || true)"
  if [ -z "$own_pid" ] || [ -z "$own_cwd" ]; then
    # SessionStart already reported this. A PreToolUse stdout must stay a permissionDecision or empty.
    [ "$mode" = "pre-tool-use" ] && exit 0
    echo "NOTE: warn-concurrent-sessions could not read this session's record in $sessions (pid in <id>.lock, cwd in <id>.json)."
    echo "The Kiro session file format may have changed, so concurrent sessions are not detected. Fix .kiro/hooks/warn-concurrent-sessions.sh."
    exit 0
  fi
fi

is_kiro_process() {
  # /proc on Linux, ps elsewhere.
  if [ -r "/proc/$1/cmdline" ]; then
    tr '\0' ' ' < "/proc/$1/cmdline" | grep -q kiro
  else
    ps -p "$1" -o command= 2>/dev/null | grep -q kiro
  fi
}

others=""
ids=""
for lock in "$sessions"/*.lock; do
  [ -f "$lock" ] || continue
  id="$(basename "$lock" .lock)"
  [ "$id" = "${KIRO_SESSION_ID:-}" ] && continue
  pid="$(jq -r '.pid // empty' "$lock" 2>/dev/null || true)"
  [ -n "$pid" ] || continue
  [ "$pid" = "$own_pid" ] && continue
  kill -0 "$pid" 2>/dev/null || continue
  is_kiro_process "$pid" || continue
  cwd="$(jq -r '.cwd // empty' "$sessions/$id.json" 2>/dev/null || true)"
  [ "$cwd" = "$here" ] || continue
  title="$(jq -r '.title // "" | split("\n")[0] | .[0:60]' "$sessions/$id.json" 2>/dev/null || true)"
  others="${others}- session ${id} (pid ${pid}): ${title}
"
  ids="${ids} ${id}"
done

[ -n "$others" ] || exit 0

if [ "$mode" = "pre-tool-use" ]; then
  state="${KIRO_HOOK_STATE_DIR:-${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/kiro-hooks}"
  mkdir -p "$state" 2>/dev/null || true
  key="$(printf '%s %s' "${KIRO_SESSION_ID:-unknown}" "$ids" | cksum | cut -d ' ' -f 1)"
  marker="$state/concurrent-sessions-$key"
  [ -e "$marker" ] && exit 0
  : > "$marker" 2>/dev/null || true
  reason="$(printf 'Other Kiro sessions are running in this working tree (%s):\n%sThey share this index and these files. Work in a separate git worktree (docs/tooling/worktrees.md).' "$here" "$others")"
  jq -cn --arg reason "$reason" '{hookSpecificOutput: {permissionDecision: "ask", permissionDecisionReason: $reason}}'
  exit 0
fi

cat <<EOF
WARNING: other Kiro sessions are running in this working tree (${here}):
${others}They share this index and these files. Before editing, committing, or switching branches,
tell the user, and work in a separate git worktree (docs/tooling/worktrees.md).
EOF
exit 0
