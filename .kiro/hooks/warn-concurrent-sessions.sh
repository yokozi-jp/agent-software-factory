#!/usr/bin/env sh
# Kiro hook: warn when another live Kiro session works in the same directory.
# Two sessions sharing one working tree overwrite each other's index and files; use a worktree instead
# (docs/tooling/worktrees.md).
# - SessionStart (no argument): print a warning. stdout of a SessionStart hook is added to the agent's context.
# - PreToolUse (--pre-tool-use): before a write or shell tool, ask the user to confirm. Catches sessions that
#   started after this one. stdout of a PreToolUse hook is read as a permissionDecision, not added to the context.
#   Asks once per set of other sessions: a marker in $KIRO_HOOK_STATE_DIR remembers the sets already asked about.
#
# Session records are not a documented interface. Two layouts are read (checked against Kiro 2.33.1):
# - V3: ~/.kiro/sessions/<workspace hash>/sess_<id>/. An interactive session writes .lock with its pid;
#   `kiro-cli chat --no-interactive` writes only session.json, so this session is found by either file,
#   but another session is detected only by its .lock. One directory per workspace root,
#   so every other live session in the same <workspace hash> directory works in this working tree.
# - Older: ~/.kiro/sessions/cli/<id>.lock holds the pid and <id>.json holds the cwd.
# This session is found by $KIRO_SESSION_ID. When its record is in neither layout, the layout has probably
# changed and no session would be detected, so the hook says so instead of staying silent.
# Stale locks are skipped (pid not running, or not a kiro process), and so are sessions in this process.
# Always exits 0: this hook only informs.
set -u

mode="session-start"
[ "${1:-}" = "--pre-tool-use" ] && mode="pre-tool-use"

root="${KIRO_SESSIONS_ROOT:-$HOME/.kiro/sessions}"
legacy="${KIRO_SESSIONS_DIR:-$root/cli}"
[ -d "$root" ] || [ -d "$legacy" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

here="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
self="${KIRO_SESSION_ID:-}"
state="${KIRO_HOOK_STATE_DIR:-${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/kiro-hooks}"

# ask_once <key> <reason>: print a PreToolUse "ask" unless this key was already asked about.
ask_once() {
  mkdir -p "$state" 2>/dev/null || true
  marker="$state/concurrent-sessions-$(printf '%s' "$1" | cksum | cut -d ' ' -f 1)"
  [ -e "$marker" ] && return 0
  : > "$marker" 2>/dev/null || true
  jq -cn --arg reason "$2" '{hookSpecificOutput: {permissionDecision: "ask", permissionDecisionReason: $reason}}'
}

is_kiro_process() {
  # /proc on Linux, ps elsewhere.
  if [ -r "/proc/$1/cmdline" ]; then
    tr '\0' ' ' < "/proc/$1/cmdline" | grep -q kiro
  else
    ps -p "$1" -o command= 2>/dev/null | grep -q kiro
  fi
}

lock_pid() {
  jq -r '.pid // empty' "$1" 2>/dev/null || true
}

# Find this session's own record.
own_pid=""
own_workspace=""
if [ -n "$self" ]; then
  for dir in "$root"/*/"$self" "$root"/*/"sess_$self"; do
    # Interactive sessions write .lock; `kiro-cli chat --no-interactive` writes only session.json (Kiro 2.33.1).
    [ -f "$dir/.lock" ] || [ -f "$dir/session.json" ] || continue
    own_pid="$(lock_pid "$dir/.lock")"
    own_workspace="$(dirname "$dir")"
    break
  done
  if [ -z "$own_workspace" ]; then
    own_pid="$(lock_pid "$legacy/$self.lock")"
    own_cwd="$(jq -r '.cwd // empty' "$legacy/$self.json" 2>/dev/null || true)"
    if [ -z "$own_pid" ] || [ -z "$own_cwd" ]; then
      note="warn-concurrent-sessions could not find this session's record ($self) in $root/<workspace>/sess_<id>/.lock or $legacy/<id>.lock. The Kiro session file layout may have changed, so concurrent sessions are not detected. Fix .kiro/hooks/warn-concurrent-sessions.sh."
      if [ "$mode" = "pre-tool-use" ]; then
        ask_once "unreadable $self" "$note"
      else
        echo "NOTE: $note"
      fi
      exit 0
    fi
  fi
fi

others=""
ids=""
add_other() {
  others="${others}- session $1 (pid $2): $3
"
  ids="${ids} $1"
}

# V3: the other sessions in this session's workspace directory.
if [ -n "$own_workspace" ]; then
  for dir in "$own_workspace"/*/; do
    dir="${dir%/}"
    id="$(basename "$dir")"
    [ "$id" = "$self" ] || [ "$id" = "sess_$self" ] && continue
    pid="$(lock_pid "$dir/.lock")"
    [ -n "$pid" ] || continue
    [ "$pid" = "$own_pid" ] && continue
    kill -0 "$pid" 2>/dev/null || continue
    is_kiro_process "$pid" || continue
    title="$(jq -r '.title // "" | split("\n")[0] | .[0:60]' "$dir/session.json" 2>/dev/null || true)"
    add_other "$id" "$pid" "$title"
  done
fi

# Older layout: sessions whose recorded cwd is this working tree.
for lock in "$legacy"/*.lock; do
  [ -f "$lock" ] || continue
  id="$(basename "$lock" .lock)"
  [ "$id" = "$self" ] && continue
  pid="$(lock_pid "$lock")"
  [ -n "$pid" ] || continue
  [ "$pid" = "$own_pid" ] && continue
  kill -0 "$pid" 2>/dev/null || continue
  is_kiro_process "$pid" || continue
  cwd="$(jq -r '.cwd // empty' "$legacy/$id.json" 2>/dev/null || true)"
  [ "$cwd" = "$here" ] || continue
  title="$(jq -r '.title // "" | split("\n")[0] | .[0:60]' "$legacy/$id.json" 2>/dev/null || true)"
  add_other "$id" "$pid" "$title"
done

[ -n "$others" ] || exit 0

if [ "$mode" = "pre-tool-use" ]; then
  ask_once "${self:-unknown} $ids" "$(printf 'Other Kiro sessions are running in this working tree (%s):\n%sThey share this index and these files. Work in a separate git worktree (docs/tooling/worktrees.md). File tools resolve a relative path against this working tree, not the worktree: pass absolute paths.' "$here" "$others")"
  exit 0
fi

cat <<EOF
WARNING: other Kiro sessions are running in this working tree (${here}):
${others}They share this index and these files. Before editing, committing, or switching branches,
tell the user, and work in a separate git worktree (docs/tooling/worktrees.md).
File tools (read, write, edit) resolve a relative path against this working tree, not against the worktree,
so pass them absolute paths inside the worktree.
EOF
exit 0
