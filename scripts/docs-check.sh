#!/usr/bin/env sh
# Validate docs/ as an OKF v0.2 bundle (docs/knowledge/documentation-authoring.md).
#   1. Frontmatter and index/log shapes match docs/.iwe/schemas (iwe schema validate).
#   2. No broken links inside docs/. Links leaving docs/ (starting with ../) point at repo files and are skipped.
#   3. No orphans: every document is linked from an index.md or another document.
#   4. index.md link lines carry a "when to read" note. Each bullet must be
#      `- [title](file.md)：when to read` with a non-empty note after the full-width colon (：).
#      This lets an agent decide from the index whether to open a file, instead of reading all of docs/.
#   5. Length reminder: documents over 250 lines are warned about, not failed. 250 lines is a
#      review trigger for a document that may mix responsibilities, not a hard limit
#      (docs/knowledge/documentation-authoring.md). Warnings go to stderr and leave the status 0.
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

# Heading anchors of links between documents, and links to the arch-guidelines site (scripts/docs-links.mjs).
if ! links="$(node "$root/scripts/docs-links.mjs")"; then
  echo "$links" | sed 's/^/docs-check: /' >&2
  status=1
fi

# index.md link lines must carry a "when to read" note after the full-width colon (：).
# node reads every index.md so the full-width colon and link syntax are handled as text, not shell globs.
# shellcheck disable=SC2016
index_report="$(node -e '
  const fs = require("fs");
  const { execSync } = require("child_process");
  const files = execSync("find . -type f -name index.md", { encoding: "utf8" })
    .split("\n").filter(Boolean);
  const problems = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      // Only bullet lines that contain a Markdown link; headings and frontmatter are left alone.
      const m = line.match(/^\s*-\s+\[[^\]]+\]\([^)]+\)(.*)$/);
      if (!m) return;
      const note = m[1].replace(/^：/, "").trim();
      if (!m[1].startsWith("：") || note === "") {
        const rel = file.replace(/^\.\//, "");
        problems.push(`${rel}:${i + 1}: link line needs a "：when to read" note: ${line.trim()}`);
      }
    });
  }
  process.stdout.write(problems.join("\n"));
')"
if [ -n "$index_report" ]; then
  echo "$index_report" | sed 's/^/docs-check: /' >&2
  status=1
fi

# Length reminder. A document over 250 lines is a review trigger, not an error: warn but keep the status.
# Splitting to hit a line count can raise total tokens; split by responsibility, not by length.
find . -type f -name '*.md' -exec wc -l {} + | awk '$2 != "total" && $1 > 250 {
  sub(/^\.\//, "", $2)
  print "docs-check: " $2 " is " $1 " lines (over 250): check it answers one question (its description); split by responsibility, not to hit a line count"
}' >&2

[ "$status" -eq 0 ] && echo "docs-check: OK"
exit "$status"
