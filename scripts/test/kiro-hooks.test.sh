#!/usr/bin/env sh
# Tests for the Kiro hooks in .kiro/hooks/ (docs/tooling/git-hooks.md "Kiro の hook").
# Needs jq.
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

force="$repo_root/.kiro/hooks/block-force-push.sh"
normalize="$repo_root/.kiro/hooks/block-iwe-normalize.sh"
sessions="$repo_root/.kiro/hooks/warn-concurrent-sessions.sh"

# block-force-push: refuse rewriting pushes, allow ordinary ones.
for cmd in \
  "git push --force" \
  "git push -f origin main" \
  "git push --force-with-lease origin HEAD" \
  "git push --force-with-lease=main:abc origin main" \
  "git push origin +main" \
  "git -C repo push -uf origin x" \
  "pnpm test && git push --force"; do
  expect_hook 2 "block-force-push refuses: $cmd" "$force" shell "$cmd"
done
for cmd in \
  "git push" \
  "git push -u origin feature" \
  "git push origin --delete old" \
  "git status && echo --force" \
  "git log --format=%f"; do
  expect_hook 0 "block-force-push allows: $cmd" "$force" shell "$cmd"
done
expect_exit 0 "block-force-push override" sh -c "printf '%s' '{\"tool_input\":{\"command\":\"git push -f\"}}' | KIRO_ALLOW_FORCE_PUSH=1 sh '$force'"
expect_exit 0 "block-force-push fails open on garbage" sh -c "printf 'not json' | sh '$force'"

# block-iwe-normalize: refuse the normalize subcommand (CLI and MCP), allow everything else.
for cmd in \
  "iwe normalize" \
  "cd docs && pnpm exec iwe normalize" \
  "iwe -v 1 normalize --dry-run" \
  "iwe --verbose normalize"; do
  expect_hook 2 "block-iwe-normalize refuses: $cmd" "$normalize" shell "$cmd"
done
expect_hook 2 "block-iwe-normalize refuses the MCP tool" "$normalize" "@iwe/iwe_normalize" ""
for cmd in "pnpm exec iwe find normalize" "iwe stats" "iwe schema validate"; do
  expect_hook 0 "block-iwe-normalize allows: $cmd" "$normalize" shell "$cmd"
done
expect_exit 0 "block-iwe-normalize override" sh -c "printf '%s' '{\"tool_input\":{\"command\":\"iwe normalize\"}}' | IWE_ALLOW_NORMALIZE=1 sh '$normalize'"

# warn-concurrent-sessions: warn only for a live kiro process in the same directory.
make_sandbox
tmp="$sandbox"
trap 'kill "$live" 2>/dev/null; rm -rf "$sandbox"' EXIT
cp "$(command -v sleep)" "$tmp/kiro-fake"
"$tmp/kiro-fake" 60 &
live=$!
sleep 30 &
not_kiro=$!
write_session() {
  printf '{"pid":%s}' "$2" > "$tmp/$1.lock"
  jq -n --arg cwd "$3" '{cwd: $cwd, title: "test session"}' > "$tmp/$1.json"
}
warns() {
  out="$(cd "$repo_root" && KIRO_SESSIONS_DIR="$tmp" KIRO_SESSION_ID=self sh "$sessions")"
  case "$out" in *WARNING*) return 0 ;; *) return 1 ;; esac
}
write_session self "$$" "$repo_root"
write_session other-dir "$live" /somewhere/else
write_session stale 999999 "$repo_root"
write_session not-kiro "$not_kiro" "$repo_root"
expect_exit 1 "warn-concurrent-sessions is silent without a live kiro session here" warns
write_session live "$live" "$repo_root"
expect_exit 0 "warn-concurrent-sessions warns for a live kiro session here" warns
expect_exit 0 "warn-concurrent-sessions exits 0 without a sessions dir" sh -c "KIRO_SESSIONS_DIR=/nonexistent sh '$sessions'"
kill "$not_kiro" 2>/dev/null

finish
