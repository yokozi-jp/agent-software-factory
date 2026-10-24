#!/usr/bin/env sh
# Tests for scripts/osv-scanner.sh in a sandboxed repository. A stub `mise` returns each exit code of OSV-Scanner,
# so these cases need no network. The last case runs the pinned OSV-Scanner on a lockfile with a known
# vulnerability, and needs mise with the tools in mise.lock installed and access to osv.dev.
# Every git command here runs through in_sandbox_repo.
set -u
# shellcheck source=scripts/test/lib.sh
. "$(dirname "$0")/lib.sh"

make_sandbox
repo="$sandbox/repo"
git init -q -b main "$repo"
mkdir -p "$repo/scripts"
cp "$repo_root/scripts/osv-scanner.sh" "$repo/scripts/"
r() { in_sandbox_repo "$repo" "$@"; }
r git add -A
r git commit -qm base
contains() { printf '%s\n' "$1" | grep -qF -- "$2"; }

# stub <exit code>: a PATH where `mise` prints a line and exits with <exit code>, as `mise exec -- osv-scanner` would.
stub() {
  dir="$sandbox/stub-$1"
  mkdir -p "$dir"
  printf '#!/bin/sh\necho stub-osv-scanner\nexit %s\n' "$1" >"$dir/mise"
  chmod +x "$dir/mise"
  printf '%s' "$dir:$PATH"
}
run() { r env -u GITHUB_ACTIONS PATH="$1" sh scripts/osv-scanner.sh 2>&1; }

expect_exit 0 "passes without pnpm-lock.yaml" r env PATH="$(stub 1)" sh scripts/osv-scanner.sh
out="$(run "$(stub 1)")"
expect_exit 0 "does not scan without pnpm-lock.yaml" test -z "$out"

echo "lockfileVersion: '9.0'" >"$repo/pnpm-lock.yaml"
out="$(run "$(stub 0)")"
expect_exit 0 "passes when there is no vulnerability" r env PATH="$(stub 0)" sh scripts/osv-scanner.sh
expect_exit 1 "does not warn when there is no vulnerability" contains "$out" "warning"

out="$(run "$(stub 1)")"
expect_exit 0 "passes when it finds a vulnerability" r env PATH="$(stub 1)" sh scripts/osv-scanner.sh
expect_exit 0 "warns about a vulnerability" contains "$out" "osv-scanner: warning: pnpm-lock.yaml has dependencies with known vulnerabilities"
out="$(r env GITHUB_ACTIONS=true PATH="$(stub 1)" sh scripts/osv-scanner.sh 2>&1)"
expect_exit 0 "warns with an annotation in GitHub Actions" contains "$out" "::warning title=osv-scanner::"

out="$(run "$(stub 128)")"
expect_exit 1 "does not warn when there is no package" contains "$out" "warning"

out="$(run "$(stub 127)")"
expect_exit 0 "passes when the scan fails" r env PATH="$(stub 127)" sh scripts/osv-scanner.sh
expect_exit 0 "says that the scan failed" contains "$out" "the scan failed (exit 127)"

bin="$sandbox/bin"
mkdir "$bin"
for tool in git sh; do
  ln -s "$(command -v "$tool")" "$bin/$tool"
done
out="$(run "$bin")"
expect_exit 0 "passes without mise" r env PATH="$bin" sh scripts/osv-scanner.sh
expect_exit 0 "says that mise is missing" contains "$out" "mise is not installed"

# The real OSV-Scanner reads a pnpm lockfile. lodash 4.17.20 has known vulnerabilities (GHSA-35jh-r3h4-6jhm).
cp "$repo_root/mise.toml" "$repo_root/mise.lock" "$repo/"
cp -R "$repo_root/.mise" "$repo/"
cat >"$repo/pnpm-lock.yaml" <<'EOF'
lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      lodash:
        specifier: 4.17.20
        version: 4.17.20

packages:

  lodash@4.17.20:
    resolution: {integrity: sha512-PlhdFcillOINfeV7Ni6oF1TAEayyZBoZ8bcshTHqOYJYlrqzRK5hagpagky5o4HfCzzd1TRkXPMFq6cKk9rGmA==}

snapshots:

  lodash@4.17.20: {}
EOF
out="$(r env -u GITHUB_ACTIONS sh scripts/osv-scanner.sh 2>&1)"
expect_exit 0 "the pinned OSV-Scanner finds lodash 4.17.20 in a pnpm lockfile" contains "$out" "GHSA-35jh-r3h4-6jhm"

finish
