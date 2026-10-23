#!/usr/bin/env sh
# Run scripts/test/*.test.sh. With arguments, run only those test files.
# Run by CI and by the pre-commit hook when a tested script changes (docs/tooling/ci.md).
set -u

cd "$(git rev-parse --show-toplevel)" || exit 1
status=0
if [ $# -gt 0 ]; then
  tests="$*"
else
  tests="$(ls scripts/test/*.test.sh)"
fi
for test in $tests; do
  sh "$test" || status=1
done
exit "$status"
