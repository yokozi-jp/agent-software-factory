#!/usr/bin/env sh
# Kiro PreToolUse hook: refuse hand edits of generated files, and say how to regenerate them instead.
#   apps/web/src/routeTree.gen.ts (any routeTree.gen.ts)  TanStack Router's bundler plugin writes it during dev and build
#   .agents/skills/**, .kiro/skills/**, skills-lock.json  the skills CLI installs them from upstream
#   pnpm-lock.yaml                                        pnpm writes it
#   mise.lock, .mise/locks/**                             `mise lock` writes them (.mise/locks/ holds the dependency graphs of PyPI tools)
# Only the file tools that create, replace, append or delete are checked; reads always pass.
# Tool names and path fields, checked against Kiro 2.33.1 (kas/<version>/node_modules/@kiro/agent/dist/server/acp-server.js):
# tool_name is the tool id, tool_input is the tool's input. fs_write, str_replace and fs_append take `path`;
# delete_file takes `targetFile`. A relative path is resolved against the event's `cwd`, which Kiro sets to the
# first workspace root, the same root the file tools resolve against.
# Not covered: shell redirects and commands (`>`, `sed -i`, `cp`, `rm`), the `code` tool (format_code,
# rename_symbol), MCP tools, and IDE client tools such as smart_relocate.
# CI is the last net (docs/tooling/git-hooks.md "Kiro の hook"):
#   routeTree.gen.ts: the "Generated files are committed" step after the build
#   skills: the "Agent skills match skills-lock.json" step (tools/scripts/src/checks/skills-lock/)
#   pnpm-lock.yaml: `vp install` in setup-vp; pnpm runs with a frozen lockfile in CI
#   mise.lock: jdx/mise-action with MISE_LOCKED=1, which installs only what the lock records, checksum verified
# Contract: hook event JSON on stdin; exit 2 refuses (stderr goes back to the agent), exit 0 allows.
# Fail-open: anything that cannot be parsed is allowed. Override with KIRO_ALLOW_GENERATED_WRITE=1.
set -u

[ "${KIRO_ALLOW_GENERATED_WRITE:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

payload="$(cat 2>/dev/null || true)"
[ -n "$payload" ] || exit 0

tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"
case "$tool_name" in
  fs_write | str_replace | fs_append) field=path ;;
  delete_file) field=targetFile ;;
  *) exit 0 ;;
esac
target="$(printf '%s' "$payload" | jq -r --arg f "$field" '.tool_input[$f] | strings' 2>/dev/null || true)"
[ -n "$target" ] || exit 0
cwd="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null || true)"
[ -n "$cwd" ] && [ -d "$cwd" ] || cwd="$(pwd)"

# Resolve the target to a physical path: symlinks in its existing directories (.kiro/skills/<name> links to
# .agents/skills/<name>), `.` and `..` are resolved. Components below the deepest existing directory are kept as written.
case "$target" in
  /*) abs="$target" ;;
  *) abs="$cwd/$target" ;;
esac
dir="$abs"
rest=""
while [ ! -d "$dir" ]; do
  rest="/$(basename "$dir")$rest"
  dir="$(dirname "$dir")"
done
dir="$(cd "$dir" 2>/dev/null && pwd -P)" || exit 0
# Only this repository (the session's) is checked: a path into another checkout is allowed.
root="$(cd "$cwd" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)" || exit 0
root="$(cd "$root" 2>/dev/null && pwd -P)" || exit 0
abs="$dir$rest"
case "$abs" in
  "$root"/*) rel="${abs#"$root"/}" ;;
  *) exit 0 ;;
esac

refuse() {
  echo "block-generated-writes: refused $tool_name on $rel. $1 Do not edit it by hand; $2 If the user really wants a hand edit, they start Kiro with KIRO_ALLOW_GENERATED_WRITE=1." >&2
  exit 2
}

case "$rel" in
  routeTree.gen.ts | */routeTree.gen.ts)
    refuse "TanStack Router generates it from the route files." "change the route files under apps/web/src/routes/ and run the build (\`pnpm exec nx build web\`), then commit the regenerated file."
    ;;
  skills-lock.json | .agents/skills | .agents/skills/* | .kiro/skills | .kiro/skills/*)
    refuse "Agent skills are installed from upstream by the skills CLI and must match skills-lock.json." "run \`pnpm dlx skills update\` (or \`pnpm dlx skills add <source>\`), then check with \`node scripts/verify-skills-lock.mjs\`."
    ;;
  pnpm-lock.yaml)
    refuse "pnpm writes it." "change package.json or pnpm-workspace.yaml and run \`pnpm install\` (or \`pnpm add\`)."
    ;;
  mise.lock | .mise/locks/*)
    refuse "mise writes it (docs/adr/0009)." "change mise.toml and run \`mise lock --platform linux-x64\`."
    ;;
esac

exit 0
