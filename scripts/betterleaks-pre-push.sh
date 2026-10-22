#!/usr/bin/env sh
# pre-push hook: scan only the commits that are about to be pushed.
# Git writes one line per ref to stdin: "<local ref> <local sha> <remote ref> <remote sha>".
set -eu

script_dir="$(dirname "$0")"
zero="0000000000000000000000000000000000000000"
status=0

while read -r local_ref local_sha remote_ref remote_sha; do
  # Deleting a remote branch pushes no commits.
  if [ "$local_sha" = "$zero" ]; then
    continue
  fi

  if [ "$remote_sha" = "$zero" ]; then
    # New branch: scan commits not already on any remote-tracking branch.
    range="$local_sha --not --remotes"
  else
    range="$remote_sha..$local_sha"
  fi

  echo "betterleaks: scanning $range ($local_ref -> $remote_ref)"
  "$script_dir/betterleaks.sh" git --redact --no-banner --config .betterleaks.toml \
    --log-opts="$range" . || status=1
done

exit "$status"
