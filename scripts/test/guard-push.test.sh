#!/usr/bin/env sh
# Tests for scripts/guard-push.sh (the pre-push hook that refuses pushes to main).
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

guard="$repo_root/scripts/guard-push.sh"
a=1111111111111111111111111111111111111111
b=2222222222222222222222222222222222222222
zero=0000000000000000000000000000000000000000
push() { printf '%s\n' "$@" | sh "$guard"; }

expect_exit 1 "refuses a fast-forward to main" push "refs/heads/x $a refs/heads/main $b"
expect_exit 1 "refuses creating main" push "refs/heads/x $a refs/heads/main $zero"
expect_exit 1 "refuses deleting main" push "(delete) $zero refs/heads/main $b"
expect_exit 1 "refuses main among other refs" push "refs/heads/x $a refs/heads/x $zero" "refs/heads/x $a refs/heads/main $b"
expect_exit 0 "allows a feature branch" push "refs/heads/x $a refs/heads/x $zero"
expect_exit 0 "allows a branch named like main" push "refs/heads/x $a refs/heads/main-fix $zero"
expect_exit 0 "allows tags" push "refs/tags/api@1.0.0 $a refs/tags/api@1.0.0 $zero"
expect_exit 0 "allows an empty push" push ""
expect_exit 0 "override" sh -c "echo 'refs/heads/x $a refs/heads/main $b' | ALLOW_PUSH_TO_MAIN=1 sh '$guard'"

finish
