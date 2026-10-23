#!/usr/bin/env sh
# pre-push hook: refuse pushes that update or delete the remote main branch.
# main changes only through squash-merged PRs (docs/adr/0004) and the Release workflow, which runs with LEFTHOOK=0.
# A direct push to main once came from a test that ran inside a Git hook and pushed this repository by mistake.
# Git writes one line per ref to stdin: "<local ref> <local sha> <remote ref> <remote sha>".
# Override for a deliberate fix (for example restoring main): ALLOW_PUSH_TO_MAIN=1 git push ...
set -eu

[ "${ALLOW_PUSH_TO_MAIN:-}" = "1" ] && exit 0

status=0
while read -r _local_ref _local_sha remote_ref _remote_sha; do
  if [ "$remote_ref" = "refs/heads/main" ]; then
    cat >&2 <<EOF
guard-push: refusing to push to main. Open a pull request instead (docs/repository/commit-conventions.md).
To restore or fix main on purpose, run the push yourself with ALLOW_PUSH_TO_MAIN=1.
EOF
    status=1
  fi
done
exit "$status"
