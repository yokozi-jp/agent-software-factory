#!/usr/bin/env sh
# Before a PR: is each ADR number this branch adds still free? Prints the next free number.
# Numbers are taken by origin/main and by the other open PRs (gh). Run `git fetch origin` first.
# check-repo-policy.sh only sees the numbers in one tree, so two open PRs can pick the same number
# (docs/tooling/worktrees.md ("PR を出す")).
#   exit 0  every ADR the branch adds has a free number
#   exit 1  an added ADR uses a number that origin/main or another open PR uses
#   exit 2  the open PRs could not be read (gh failed), so nothing was checked
set -u

cd "$(git rev-parse --show-toplevel)" || exit 2
branch="$(git branch --show-current)"
adr_number() { sed -n 's|^docs/adr/\([0-9]\{4\}\)-.*\.md$|\1|p'; }

# gh sometimes fails with a dropped connection (EOF); try again before giving up.
prs=""
for attempt in 1 2 3; do
  if prs="$(gh pr list --state open --limit 200 --json number,headRefName,files 2>/dev/null)"; then
    break
  fi
  prs=""
  [ "$attempt" -lt 3 ] && sleep 2
done
if [ -z "$prs" ]; then
  echo "check-adr-number: could not list the open PRs with gh. Check \`gh auth status\` and try again." >&2
  exit 2
fi

# "<number> <who>" for every ADR outside this branch.
taken="$(
  git ls-tree --name-only origin/main docs/adr/ | adr_number | sed 's/$/ origin\/main/'
  printf '%s' "$prs" | jq -r --arg branch "$branch" '
    .[] | select(.headRefName != $branch) | .number as $pr | .files[].path
    | select(test("^docs/adr/[0-9]{4}-.*\\.md$")) | "\(.[9:13]) PR #\($pr)"'
)"

status=0
# ADRs this branch adds: committed since origin/main, staged, or not yet added.
added="$(
  {
    git diff --name-only --diff-filter=AR origin/main...HEAD -- docs/adr/
    git diff --name-only --diff-filter=AR --cached -- docs/adr/
    git ls-files --others --exclude-standard -- docs/adr/
  } | adr_number | sort -u
)"
for number in $added; do
  users="$(printf '%s\n' "$taken" | awk -v n="$number" '$1 == n { $1 = ""; sub(/^ /, ""); print }' | sort -u | tr '\n' ',' | sed 's/,$//; s/,/, /g')"
  if [ -n "$users" ]; then
    echo "check-adr-number: ADR $number is also used by $users. Renumber this branch's ADR and the places that cite it." >&2
    status=1
  fi
done

last="$(printf '%s\n%s\n' "$taken" "$added" | awk 'NF { print $1 }' | sort -n | tail -n 1)"
# Strip the leading zeros first: POSIX sh arithmetic may read 0013 as octal.
last="$(printf '%s' "${last:-0}" | sed 's/^0*//')"
printf 'next free ADR number: %04d\n' "$((${last:-0} + 1))"
exit "$status"
