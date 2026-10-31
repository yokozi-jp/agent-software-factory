#!/usr/bin/env sh
# Run a hook command, show its output as usual, and keep the same output (stdout and stderr) in a log file.
# A pre-push job that fails after minutes prints a summary that can be cut short by a pipe or a tool; with the log
# the cause is read without running the push again. Usage: tee-log.sh <name> <command> [args...]
# The log is <HOOK_LOG_DIR>/<name>.log; HOOK_LOG_DIR defaults to hook-logs in the git directory of this worktree,
# which git does not track. The next run of the same name overwrites it.
set -u

if [ "$#" -lt 2 ]; then
  echo "usage: tee-log.sh <name> <command> [args...]" >&2
  exit 2
fi

name=$1
shift
dir=${HOOK_LOG_DIR:-$(git rev-parse --git-path hook-logs)}
mkdir -p "$dir"
log=$dir/$name.log
status_file=$dir/$name.status

# A pipe returns the status of its last command, so the status of the command goes through a file.
{ "$@" 2>&1; echo "$?" >"$status_file"; } | tee "$log"
status=$(cat "$status_file")
rm -f "$status_file"

if [ "$status" -ne 0 ]; then
  echo "tee-log: $name failed (exit $status). Output: $log" >&2
fi
exit "$status"
