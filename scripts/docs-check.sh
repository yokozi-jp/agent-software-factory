#!/usr/bin/env sh
# Validate docs/ as an OKF v0.2 bundle (docs/knowledge/documentation-authoring.md).
#   1. Frontmatter and index/log shapes match docs/.iwe/schemas (iwe schema validate).
#   2. No broken links inside docs/. Links leaving docs/ (starting with ../) point at repo files and are skipped.
#   3. No orphans: every document is linked from an index.md or another document.
# Run by the pre-commit hook (when docs/ changes) and by CI.
set -eu

root="$(git rev-parse --show-toplevel)"
# The pinned iwe from node_modules, called directly. `pnpm exec` would fall back to a global iwe of another
# version when node_modules is missing, and runs pnpm's dependency check (an install) on every call.
iwe="$root/node_modules/.bin/iwe"
if [ ! -x "$iwe" ]; then
  echo "docs-check: $iwe not found. Run \`pnpm install\` first." >&2
  exit 1
fi
cd "$root/docs"
status=0

if ! $iwe schema validate; then
  echo "docs-check: OKF schema validation failed (see above)." >&2
  status=1
fi

stats="$($iwe stats -f json)"
# The node program is single-quoted on purpose: $ and backticks belong to JavaScript, not the shell.
# shellcheck disable=SC2016
report="$(printf '%s' "$stats" | node -e '
  let raw = "";
  process.stdin.on("data", (c) => (raw += c)).on("end", () => {
    const s = JSON.parse(raw);
    const broken = (s.brokenLinks ?? []).filter((l) => !String(l.targetKey).startsWith("../"));
    const lines = [
      ...broken.map((l) => `broken link: ${l.sourceKey} -> ${l.targetKey}`),
      ...(s.orphans ?? []).map((o) => `orphan (link it from an index.md): ${o}`),
    ];
    process.stdout.write(lines.join("\n"));
  });
')"

if [ -n "$report" ]; then
  echo "$report" | sed 's/^/docs-check: /' >&2
  status=1
fi

[ "$status" -eq 0 ] && echo "docs-check: OK"
exit "$status"
