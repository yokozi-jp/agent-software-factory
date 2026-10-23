#!/usr/bin/env sh
# Shared helpers for scripts/test/*.test.sh. Source this file; call `finish` at the end of each test.
# expect_exit <code> <description> <command...>   run a command and compare its exit code
# expect_hook <code> <description> <hook script> <tool name> <shell command>   feed a PreToolUse event to a Kiro hook
# make_sandbox                                     create $sandbox, a temp dir that git commands cannot escape
#
# Isolation (docs/tooling/ci.md ("スクリプトのテスト")). Tests run from Git hooks too, where git exports
# GIT_DIR and GIT_INDEX_FILE. Left set, they make every `git -C <temp dir>` act on this repository instead
# (that once committed into and pushed this repo's main). So this file:
#   1. unsets every repository-local git variable (`git rev-parse --local-env-vars`),
#   2. ignores the user's and system git config and turns off network transports,
#   3. stops git repository discovery at the sandbox (GIT_CEILING_DIRECTORIES),
#   4. offers in_sandbox_repo, which refuses to run git unless the repository is inside the sandbox.

# Used by the test files that source this one.
# shellcheck disable=SC2034
repo_root="$(git rev-parse --show-toplevel)"
# Unset after reading repo_root, which may itself come from GIT_DIR inside a hook.
for var in $(git rev-parse --local-env-vars); do
  unset "$var"
done
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
# Only local transports. A push or fetch to a URL fails instead of reaching GitHub.
export GIT_ALLOW_PROTOCOL=file
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

failures=0
passes=0
sandbox=""

make_sandbox() {
  sandbox="$(mktemp -d)"
  trap 'rm -rf "$sandbox"' EXIT
  # Repository discovery never walks above the sandbox, so a missing .git cannot fall back to an outer repo.
  export GIT_CEILING_DIRECTORIES="$sandbox"
}

# in_sandbox_repo <dir> <command...>: run a command in <dir> only if <dir>'s repository lives in the sandbox.
in_sandbox_repo() {
  dir="$1"
  shift
  git_dir="$(cd "$dir" && git rev-parse --absolute-git-dir 2>/dev/null)" || {
    echo "lib.sh: $dir is not a git repository" >&2
    exit 1
  }
  case "$git_dir" in
    "$sandbox"/*) ;;
    *)
      echo "lib.sh: refusing to run in $dir: its repository is $git_dir, outside the sandbox $sandbox" >&2
      exit 1
      ;;
  esac
  (cd "$dir" && "$@")
}

# On failure, the last lines of the command's output are shown, so a CI log explains the failure.
expect_exit() {
  want="$1"
  what="$2"
  shift 2
  output="$(mktemp)"
  "$@" >"$output" 2>&1
  got=$?
  if [ "$got" -eq "$want" ]; then
    passes=$((passes + 1))
  else
    echo "FAIL: $what (want exit $want, got $got)" >&2
    tail -n 20 "$output" | sed 's/^/    | /' >&2
    failures=$((failures + 1))
  fi
  rm -f "$output"
}

hook_event() {
  jq -cn --arg tool "$1" --arg command "$2" '{hook_event_name: "PreToolUse", tool_name: $tool, tool_input: {command: $command}}'
}

run_hook() {
  hook_event "$2" "$3" | sh "$1"
}

expect_hook() {
  expect_exit "$1" "$2" run_hook "$3" "$4" "$5"
}

finish() {
  echo "$(basename "$0"): $passes passed, $failures failed"
  [ "$failures" -eq 0 ]
}
