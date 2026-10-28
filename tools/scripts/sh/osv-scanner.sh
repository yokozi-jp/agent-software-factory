#!/usr/bin/env sh
# Report known vulnerabilities in pnpm-lock.yaml with the pinned OSV-Scanner (docs/adr/0021). Warns, never fails:
# the merge gate for dependencies is dependency review (.github/workflows/dependency-review.yml), which stops only
# the vulnerabilities that a pull request adds. OSV-Scanner cannot compare with a base, so it lists them all.
# It queries osv.dev, so it needs the network. When the query fails, it says so and passes.
# Ignore a vulnerability in osv-scanner.toml ([[IgnoredVulns]] with a reason).
# OSV-Scanner runs through `mise exec`, so the version is the one pinned in mise.toml and mise.lock (docs/adr/0009).
# Run by the pre-push hook and by CI. In GitHub Actions the warning is a ::warning:: annotation.
# When OSV_SARIF_FILE names a file, a second scan writes the findings there as SARIF 2.1.0 for Code scanning
# (ci.yml uploads it on a push to main, docs/adr/0021). The file is absent when that scan did not run.
set -u

cd "$(git rev-parse --show-toplevel)" || exit 0

warn() {
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::warning title=osv-scanner::$1"
  else
    echo "osv-scanner: warning: $1" >&2
  fi
}

if ! command -v mise >/dev/null 2>&1; then
  warn "mise is not installed, so the dependencies were not scanned. See docs/local-env-setup/setup.md (\"Ubuntu の初期セットアップ\")."
  exit 0
fi
[ -f pnpm-lock.yaml ] || exit 0

mise exec -- osv-scanner scan source --lockfile pnpm-lock.yaml
status=$?
# 0: no vulnerability. 1: vulnerabilities found. 128: no packages found. Anything else: the scan did not run.
case "$status" in
  0 | 128) ;;
  1) warn "pnpm-lock.yaml has dependencies with known vulnerabilities (listed above). Update them, or ignore one in osv-scanner.toml with a reason." ;;
  *) warn "the scan failed (exit $status), so the dependencies were not checked. It needs to reach osv.dev." ;;
esac

if [ -n "${OSV_SARIF_FILE:-}" ]; then
  rm -f "$OSV_SARIF_FILE"
  mise exec -- osv-scanner scan source --lockfile pnpm-lock.yaml --format sarif --output-file "$OSV_SARIF_FILE" >/dev/null
  sarif_status=$?
  # 0: no vulnerability, 1: vulnerabilities found (both write the file). Otherwise nothing valid was written.
  case "$sarif_status" in
    0 | 1) ;;
    *) rm -f "$OSV_SARIF_FILE" ;;
  esac
fi
exit 0
