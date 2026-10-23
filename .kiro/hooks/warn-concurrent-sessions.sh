#!/usr/bin/env sh
# Kiro SessionStart hook: warn when another live Kiro session works in the same directory.
# Two sessions sharing one working tree overwrite each other's index and files; use a worktree instead
# (docs/tooling/worktrees.md). stdout of a SessionStart hook is added to the agent's context.
# Sessions are read from ~/.kiro/sessions/cli: <id>.lock holds the pid, <id>.json holds the cwd.
# Stale locks are skipped (pid not running, or not a kiro process), and so are sessions in this process.
# Always exits 0: this hook only informs.
set -u

sessions="${KIRO_SESSIONS_DIR:-$HOME/.kiro/sessions/cli}"
[ -d "$sessions" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

here="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
own_pid=""
if [ -n "${KIRO_SESSION_ID:-}" ] && [ -f "$sessions/$KIRO_SESSION_ID.lock" ]; then
  own_pid="$(jq -r '.pid // empty' "$sessions/$KIRO_SESSION_ID.lock" 2>/dev/null || true)"
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
done

[ -n "$others" ] || exit 0

cat <<EOF
WARNING: other Kiro sessions are running in this working tree (${here}):
${others}They share this index and these files. Before editing, committing, or switching branches,
tell the user, and work in a separate git worktree (docs/tooling/worktrees.md).
EOF
exit 0
