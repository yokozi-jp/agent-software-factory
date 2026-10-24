#!/usr/bin/env sh
# Warn when a change touches files that tend to carry a decision but adds no ADR (docs/adr/0015). Never fails.
#   scripts/adr-check.sh            compare HEAD with the base (CI, and by hand)
#   scripts/adr-check.sh pre-push   compare each commit being pushed with the base (pre-push hook; reads the refs from stdin)
# The base is origin/$GITHUB_BASE_REF in a pull request, and origin/main elsewhere. The diff runs from the merge base.
# ADR_ACK=1 silences the warning for a change that needs no ADR. In GitHub Actions the warning is a ::warning:: annotation.
# If the base cannot be compared (a shallow clone, or no fetch), it says why and passes.
set -u

mode="${1:-}"
# Git passes "<local ref> <local sha> <remote ref> <remote sha>" per ref to a pre-push hook. Read it before anything exits.
tips="HEAD"
if [ "$mode" = "pre-push" ]; then
  tips=""
  while read -r _local_ref local_sha _remote_ref _remote_sha; do
    # An all-zero sha is a deleted ref: nothing to compare.
    case "$local_sha" in *[!0]*) tips="$tips $local_sha" ;; esac
  done
fi

[ "${ADR_ACK:-}" = "1" ] && exit 0
# A push that only deletes refs has no commit to compare.
[ -n "$tips" ] || exit 0
cd "$(git rev-parse --show-toplevel)" || exit 0

# The one list of files whose change usually records a decision: dependencies, tool settings, workflows,
# the ruleset, Kiro hooks and settings. Tests and fixtures are never decisions, so they are checked first.
decision_path() {
  case "$1" in
    test/* | tests/* | __tests__/* | fixtures/* | __fixtures__/*) return 1 ;;
    */test/* | */tests/* | */__tests__/* | */fixtures/* | */__fixtures__/* | *.test.* | *.spec.*) return 1 ;;
  esac
  case "$1" in
    package.json | */package.json | pnpm-workspace.yaml | mise.toml) ;;
    nx.json | lefthook.yml | vite.config.ts | */vite.config.ts | commitlint.config.ts) ;;
    .node-version | .betterleaks.toml | .jscpd.json | .markdownlint-cli2.yaml) ;;
    .github/workflows/* | .github/rulesets/*) ;;
    .kiro/hooks/* | .kiro/settings/*) ;;
    *) return 1 ;;
  esac
}

in_ci=""
[ "${GITHUB_ACTIONS:-}" = "true" ] && in_ci=1
guide='docs/knowledge/documentation-authoring.md ("ADR を書くかどうか")'
guide_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-yokozi-jp/agent-software-factory}/blob/main/docs/knowledge/documentation-authoring.md#adr-を書くかどうか"

skip() {
  if [ -n "$in_ci" ]; then
    echo "::notice title=adr-check::skipped. $1"
  else
    echo "adr-check: skipped. $1" >&2
  fi
  exit 0
}

base="origin/${GITHUB_BASE_REF:-main}"
git rev-parse -q --verify "$base^{commit}" >/dev/null 2>&1 ||
  skip "$base does not exist here, so there is nothing to compare with. Run \`git fetch origin\`."

tab="$(printf '\t')"
changed=""
compared=0
for tip in $tips; do
  tip="$(git rev-parse -q --verify "$tip^{commit}" 2>/dev/null)" || continue
  git merge-base "$base" "$tip" >/dev/null 2>&1 || continue
  changes="$(git -c core.quotePath=false diff --name-status --no-renames "$base...$tip" 2>/dev/null)" || continue
  compared=$((compared + 1))
  # Each pushed commit is judged on its own: an ADR on one ref does not cover another.
  tip_changed=""
  tip_adds_adr=""
  while IFS="$tab" read -r status path; do
    [ -n "$path" ] || continue
    case "$status:$path" in
      A:docs/adr/[0-9][0-9][0-9][0-9]-*.md) tip_adds_adr=1 ;;
    esac
    decision_path "$path" && tip_changed="$tip_changed$path
"
  done <<EOF
$changes
EOF
  [ -n "$tip_adds_adr" ] || changed="$changed$tip_changed"
done
[ "$compared" -gt 0 ] ||
  skip "Could not compare $base with the commits (a shallow clone has no shared history). Run \`git fetch --unshallow\`, or fetch more history."

changed="$(printf '%s' "$changed" | sort -u)"
[ -n "$changed" ] || exit 0

if [ -n "$in_ci" ]; then
  echo "This change touches files that often record a decision, and adds no ADR (docs/adr/NNNN-*.md):"
  printf '%s\n' "$changed" | sed 's/^/  - /'
  echo "Whether to write an ADR: $guide_url"
  list="$(printf '%s' "$changed" | tr '\n' ',' | sed 's/,/, /g; s/, $//; s/%/%25/g')"
  echo "::warning title=adr-check::Changed files that often record a decision, with no ADR added: $list. Whether to write an ADR: $guide_url"
else
  {
    echo "adr-check: warning: this change touches files that often record a decision, and adds no ADR (docs/adr/NNNN-*.md):"
    printf '%s\n' "$changed" | sed 's/^/  - /'
    echo "Write an ADR if the decision is hard to reverse, surprising without context, and a real trade-off. See $guide."
    echo "If this change needs no ADR, silence the warning with ADR_ACK=1 (for example: ADR_ACK=1 git push)."
  } >&2
fi
exit 0
