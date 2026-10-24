#!/usr/bin/env sh
# Tests for the jscpd check (`pnpm lint:dup`, .jscpd.json) in a sandboxed repository with code written here.
# Uses the jscpd that pnpm installed in this repository (node_modules/.bin), with this repository's .jscpd.json.
# Every command runs in the sandbox through in_sandbox_repo.
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

make_sandbox
repo="$sandbox/repo"
git init -q "$repo"
cp "$repo_root/.jscpd.json" "$repo_root/.gitignore" "$repo/"
jscpd="$repo_root/node_modules/.bin/jscpd"
r() { in_sandbox_repo "$repo" "$@"; }

# put <path>: write the same function, long enough to count as a clone (11 lines, about 100 tokens), to <path>.
put() {
  mkdir -p "$(dirname "$repo/$1")"
  cat >"$repo/$1" <<'EOF'
export function summarize(items: { name: string; price: number; quantity: number }[]) {
  let total = 0;
  const lines: string[] = [];
  for (const item of items) {
    const subtotal = item.price * item.quantity;
    total += subtotal;
    lines.push(`${item.name}: ${item.quantity} x ${item.price} = ${subtotal}`);
  }
  lines.push(`total: ${total}`);
  return lines.join("\n");
}
EOF
}

# reset: only apps/api/src/summarize.ts, the copy every case is compared with.
reset() {
  rm -rf "$repo/apps" "$repo/packages" "$repo/scripts"
  put apps/api/src/summarize.ts
}

reset
expect_exit 0 "passes code with no copy" r "$jscpd"

put apps/web/src/summarize.ts
expect_exit 1 "fails on a copy in another app" r "$jscpd"

reset
put apps/api/src/other.ts
expect_exit 1 "fails on a copy in the same app" r "$jscpd"

reset
put packages/shared/src/summarize.ts
expect_exit 1 "fails on a copy in packages/" r "$jscpd"

for path in \
  apps/web/src/routeTree.gen.ts \
  apps/web/.tanstack/tmp/summarize.ts \
  apps/api/src/fixtures/summarize.ts \
  apps/api/src/__fixtures__/summarize.ts \
  apps/api/dist/summarize.ts \
  scripts/summarize.ts; do
  reset
  put "$path"
  expect_exit 0 "ignores a copy in $path" r "$jscpd"
done

# A deliberate copy is kept by marking it, not by raising the threshold (docs/adr/0014).
reset
put apps/web/src/summarize.ts
{
  echo "// jscpd:ignore-start"
  cat "$repo/apps/web/src/summarize.ts"
  echo "// jscpd:ignore-end"
} >"$sandbox/marked.ts"
mv "$sandbox/marked.ts" "$repo/apps/web/src/summarize.ts"
expect_exit 0 "ignores a copy between jscpd:ignore-start and jscpd:ignore-end" r "$jscpd"

# failOnEmpty: a pattern or format that matches no file fails instead of passing unchecked.
rm -rf "$repo/apps"
expect_exit 1 "fails when no file is scanned" r "$jscpd"

finish
