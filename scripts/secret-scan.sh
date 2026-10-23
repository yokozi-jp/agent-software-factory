#!/usr/bin/env sh
# Secret scan: run the pinned betterleaks with the repo's fixed flags over one scan target.
# Callers choose only what to scan. Flags (--redact, --config) are not overridable.
#
# Usage:
#   scripts/secret-scan.sh staged               # pre-commit: staged changes
#   scripts/secret-scan.sh pre-push             # pre-push: refs from git on stdin
#   scripts/secret-scan.sh range <base> <head>  # CI pull request: base..head
#   scripts/secret-scan.sh all                  # CI push to main, manual: full history
#   scripts/secret-scan.sh worktree             # manual: working tree files
#
# betterleaks runs through `mise exec`, so the version is the one pinned in mise.toml and mise.lock
# (docs/adr/0009). Fails (instead of silently skipping) when mise is missing, so nobody commits unscanned.
# Prints how many commits/files each scan covers, so an empty scan is visible instead of passing silently.
set -eu

cd "$(git rev-parse --show-toplevel)"

usage() {
  sed -n '5,10p' "$0" | sed 's/^# //' >&2
  exit 2
}

require_mise() {
  if ! command -v mise >/dev/null 2>&1; then
    echo "secret-scan: mise is not installed, so the secret scan cannot run. See docs/local-env-setup/setup.md (\"Ubuntu の初期セットアップ\")." >&2
    exit 1
  fi
}

# The only place betterleaks is invoked. $1 is the betterleaks mode (git / dir); the rest are mode options.
run_betterleaks() {
  mode="$1"
  shift
  mise exec -- betterleaks "$mode" --redact --no-banner --config .betterleaks.toml "$@" .
}

# Scan commits selected by rev-list arguments, e.g. "base..head" or "sha --not --remotes".
# $1 is a label for the log line; the rest are passed to both rev-list and --log-opts.
scan_commits() {
  label="$1"
  shift
  count="$(git rev-list --count "$@")"
  if [ "$count" -eq 0 ]; then
    echo "secret-scan: $label: 0 commits, skipped (nothing new to scan)"
    return 0
  fi
  echo "secret-scan: $label: scanning $count commit(s) ($*)"
  run_betterleaks git --log-opts="$*"
}

scan_pre_push() {
  zero="0000000000000000000000000000000000000000"
  status=0
  # Git writes one line per ref: "<local ref> <local sha> <remote ref> <remote sha>".
  while read -r local_ref local_sha remote_ref remote_sha; do
    if [ "$local_sha" = "$zero" ]; then
      echo "secret-scan: $remote_ref: branch deletion, nothing to scan"
      continue
    fi
    if [ "$remote_sha" = "$zero" ]; then
      # New branch: commits not already on any remote-tracking branch.
      scan_commits "$local_ref -> $remote_ref" "$local_sha" --not --remotes || status=1
    elif ! git cat-file -e "${remote_sha}^{commit}" 2>/dev/null; then
      cat >&2 <<EOF
secret-scan: $remote_ref is at ${remote_sha}, which is not in this clone.
Run \`git fetch\` and push again, so the scan can tell which commits are new.
EOF
      status=1
    else
      scan_commits "$local_ref -> $remote_ref" "${remote_sha}..${local_sha}" || status=1
    fi
  done
  return "$status"
}

[ $# -ge 1 ] || usage
target="$1"
shift

case "$target" in
  staged)
    [ $# -eq 0 ] || usage
    require_mise
    count="$(git diff --cached --name-only | wc -l | tr -d ' ')"
    if [ "$count" -eq 0 ]; then
      echo "secret-scan: staged: 0 files, skipped (nothing staged)"
      exit 0
    fi
    echo "secret-scan: staged: scanning $count file(s)"
    run_betterleaks git --staged
    ;;
  pre-push)
    [ $# -eq 0 ] || usage
    require_mise
    scan_pre_push
    ;;
  range)
    [ $# -eq 2 ] || usage
    require_mise
    scan_commits "range" "$1..$2"
    ;;
  all)
    [ $# -eq 0 ] || usage
    require_mise
    echo "secret-scan: all: scanning $(git rev-list --count --all) commit(s) (full history)"
    run_betterleaks git
    ;;
  worktree)
    [ $# -eq 0 ] || usage
    require_mise
    echo "secret-scan: worktree: scanning working tree files"
    run_betterleaks dir
    ;;
  *)
    usage
    ;;
esac
