#!/usr/bin/env sh
# Tests for the Kiro hooks in .kiro/hooks/ (docs/tooling/git-hooks.md "Kiro の hook").
# Needs jq.
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

force="$repo_root/.kiro/hooks/block-force-push.sh"
normalize="$repo_root/.kiro/hooks/block-iwe-normalize.sh"
generated="$repo_root/.kiro/hooks/block-generated-writes.sh"
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

# block-generated-writes: refuse file tools that write generated files, allow other files and every read.
# run_file_hook <tool name> <tool_input JSON> [cwd]: feed a PreToolUse event for a file tool. stderr goes to stdout.
run_file_hook() {
  jq -cn --arg tool "$1" --argjson input "$2" --arg cwd "${3:-$repo_root}" \
    '{hook_event_name: "PreToolUse", cwd: $cwd, tool_name: $tool, tool_input: $input}' \
    | (cd "${3:-$repo_root}" && sh "$generated" 2>&1)
}
# refuses_with <text> <run_file_hook arguments...>: exit 2 and stderr mentions <text>.
refuses_with() {
  rw_text="$1"
  shift
  rw_out="$(run_file_hook "$@")"
  rw_status=$?
  printf '%s\n' "$rw_out"
  [ "$rw_status" -eq 2 ] || return "$rw_status"
  case "$rw_out" in *"$rw_text"*) return 0 ;; *) return 1 ;; esac
}
expect_exit 0 "block-generated-writes refuses fs_write to pnpm-lock.yaml" refuses_with "pnpm install" fs_write '{"path":"pnpm-lock.yaml","text":"x"}'
expect_exit 0 "block-generated-writes refuses fs_append to mise.lock" refuses_with "mise lock" fs_append '{"path":"mise.lock","text":"x"}'
expect_exit 0 "block-generated-writes refuses str_replace in routeTree.gen.ts (absolute path)" refuses_with "nx build web" str_replace "{\"path\":\"$repo_root/apps/web/src/routeTree.gen.ts\",\"oldStr\":\"a\",\"newStr\":\"b\"}"
expect_exit 0 "block-generated-writes refuses delete_file of skills-lock.json" refuses_with "skills update" delete_file '{"targetFile":"skills-lock.json","explanation":"x"}'
expect_exit 0 "block-generated-writes refuses fs_write to an upstream skill" refuses_with "skills update" fs_write '{"path":".agents/skills/tdd/SKILL.md","text":"x"}'
expect_exit 0 "block-generated-writes refuses a skill through the .kiro/skills symlink" refuses_with "skills update" str_replace '{"path":".kiro/skills/tdd/SKILL.md","oldStr":"a","newStr":"b"}'
expect_exit 0 "block-generated-writes refuses a new file in an upstream skill" refuses_with "skills update" fs_write '{"path":".agents/skills/tdd/new/notes.md","text":"x"}'
expect_exit 0 "block-generated-writes refuses a path with . and .." refuses_with "nx build web" fs_write '{"path":"./apps/api/../web/src/routeTree.gen.ts","text":"x"}'
expect_exit 0 "block-generated-writes refuses a path relative to the session cwd" refuses_with "nx build web" fs_write '{"path":"src/routeTree.gen.ts","text":"x"}' "$repo_root/apps/web"
for input in \
  '{"path":"README.md","text":"x"}' \
  '{"path":"pnpm-lock.yaml.bak","text":"x"}' \
  '{"path":"docs/mise.lock.md","text":"x"}' \
  '{"path":".agents/skills-notes.md","text":"x"}' \
  '{"path":"/tmp/pnpm-lock.yaml","text":"x"}'; do
  expect_exit 0 "block-generated-writes allows fs_write: $input" run_file_hook fs_write "$input"
done
expect_exit 0 "block-generated-writes allows delete_file of another file" run_file_hook delete_file '{"targetFile":"apps/web/src/main.tsx","explanation":"x"}'
expect_exit 0 "block-generated-writes allows read_file of pnpm-lock.yaml" run_file_hook read_file '{"path":"pnpm-lock.yaml"}'
expect_exit 0 "block-generated-writes allows reading a skill" run_file_hook read_file '{"path":".agents/skills/tdd/SKILL.md"}'
expect_hook 0 "block-generated-writes allows shell (not checked)" "$generated" execute_bash "cat pnpm-lock.yaml"
expect_exit 0 "block-generated-writes fails open on a missing path" run_file_hook fs_write '{"text":"x"}'
expect_exit 0 "block-generated-writes fails open on garbage" sh -c "printf 'not json' | sh '$generated'"
expect_exit 0 "block-generated-writes override" sh -c "printf '%s' '{\"tool_name\":\"fs_write\",\"tool_input\":{\"path\":\"pnpm-lock.yaml\"}}' | KIRO_ALLOW_GENERATED_WRITE=1 sh '$generated'"

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
  out="$(cd "$repo_root" && KIRO_SESSIONS_ROOT="$tmp/v3" KIRO_SESSIONS_DIR="$tmp" KIRO_SESSION_ID=self sh "$sessions")"
  case "$out" in *WARNING*) return 0 ;; *) return 1 ;; esac
}
notes() {
  out="$(cd "$repo_root" && KIRO_SESSIONS_ROOT="$tmp/v3" KIRO_SESSIONS_DIR="$tmp" KIRO_SESSION_ID=self sh "$sessions")"
  case "$out" in *NOTE:*) return 0 ;; *) return 1 ;; esac
}
expect_exit 0 "warn-concurrent-sessions notes an unreadable own record" notes
printf '{"process":1}' > "$tmp/self.lock"
jq -n --arg cwd "$repo_root" '{cwd: $cwd}' > "$tmp/self.json"
expect_exit 0 "warn-concurrent-sessions notes a record without pid" notes
write_session self "$$" "$repo_root"
expect_exit 1 "warn-concurrent-sessions does not note a readable own record" notes
write_session other-dir "$live" /somewhere/else
write_session stale 999999 "$repo_root"
write_session not-kiro "$not_kiro" "$repo_root"
expect_exit 1 "warn-concurrent-sessions is silent without a live kiro session here" warns
# --pre-tool-use: before a write, ask the user once for each set of other sessions (stdout is a permissionDecision).
asks() {
  out="$(cd "$repo_root" && printf '{}' | KIRO_SESSIONS_ROOT="$tmp/v3" KIRO_SESSIONS_DIR="$tmp" KIRO_SESSION_ID=self KIRO_HOOK_STATE_DIR="$tmp/state" sh "$sessions" --pre-tool-use)" || return 2
  case "$out" in *'"permissionDecision":"ask"'*) return 0 ;; "") return 1 ;; *) return 3 ;; esac
}
expect_exit 1 "warn-concurrent-sessions --pre-tool-use is silent without a live kiro session here" asks
write_session live "$live" "$repo_root"
expect_exit 0 "warn-concurrent-sessions warns for a live kiro session here" warns
expect_exit 0 "warn-concurrent-sessions --pre-tool-use asks for a live kiro session here" asks
expect_exit 1 "warn-concurrent-sessions --pre-tool-use asks only once for the same sessions" asks
"$tmp/kiro-fake" 60 &
live2=$!
write_session live2 "$live2" "$repo_root"
expect_exit 0 "warn-concurrent-sessions --pre-tool-use asks again when another session joins" asks
kill "$live2" 2>/dev/null

# V3 layout: <root>/<workspace hash>/sess_<id>/.lock. Sessions in the same workspace directory share the tree.
v3="$tmp/v3only"
write_v3() {
  mkdir -p "$v3/$1/$2"
  printf '{"pid":%s}' "$3" > "$v3/$1/$2/.lock"
  printf '{"title":"v3 session","cwd":null}' > "$v3/$1/$2/session.json"
}
v3_run() {
  # $1: session id, $2: mode argument (empty for SessionStart)
  cd "$repo_root" && printf '{}' | KIRO_SESSIONS_ROOT="$v3" KIRO_SESSIONS_DIR="$v3/cli" KIRO_SESSION_ID="$1" KIRO_HOOK_STATE_DIR="$tmp/v3state" sh "$sessions" ${2:+"$2"}
}
v3_asks() {
  out="$(v3_run "$1" --pre-tool-use)" || return 2
  case "$out" in *'"permissionDecision":"ask"'*) return 0 ;; "") return 1 ;; *) return 3 ;; esac
}
v3_warns() {
  out="$(v3_run "$1" "")"
  case "$out" in *WARNING*) return 0 ;; *) return 1 ;; esac
}
write_v3 hashA sess_me "$$"
write_v3 hashB sess_elsewhere "$live"
expect_exit 1 "warn-concurrent-sessions (V3) ignores a session in another workspace" v3_asks sess_me
expect_exit 1 "warn-concurrent-sessions (V3) is silent at start without another session here" v3_warns sess_me
write_v3 hashA sess_stale 999999
write_v3 hashA sess_peer "$live"
expect_exit 0 "warn-concurrent-sessions (V3) warns at start for a live session in the same workspace" v3_warns sess_me
expect_exit 0 "warn-concurrent-sessions (V3) asks for a live session in the same workspace" v3_asks sess_me
expect_exit 1 "warn-concurrent-sessions (V3) asks only once" v3_asks sess_me
expect_exit 0 "warn-concurrent-sessions (V3) finds its record from an id without the sess_ prefix" v3_warns me
# No record in either layout: say so once instead of staying silent.
expect_exit 0 "warn-concurrent-sessions asks once when its own record is missing" v3_asks sess_missing
expect_exit 1 "warn-concurrent-sessions does not repeat the missing-record question" v3_asks sess_missing
expect_exit 0 "warn-concurrent-sessions exits 0 without a sessions dir" sh -c "KIRO_SESSIONS_ROOT=/nonexistent KIRO_SESSIONS_DIR=/nonexistent sh '$sessions'"
kill "$not_kiro" 2>/dev/null

finish
