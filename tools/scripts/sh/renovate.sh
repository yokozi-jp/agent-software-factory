#!/usr/bin/env sh
# Renovate checks for renovate.jsonc (docs/adr/0018, docs/tooling/renovate.md). Both run Renovate through
# `pnpm dlx`, so they need the network. Run `validate` from the Git hook and CI, `preview` by hand.
#   tools/scripts/sh/renovate.sh validate   renovate-config-validator --strict: unknown options and bad values fail
#   tools/scripts/sh/renovate.sh preview    run Renovate in local mode and print the PRs it would open
#                                  (GITHUB_COM_TOKEN, or a logged-in `gh`, avoids GitHub's rate limit)
set -eu

# Renovate updates this version itself (the regex manager in renovate.jsonc).
renovate_version="44.182.2"

cd "$(git rev-parse --show-toplevel)"
dlx() {
  tool="$1"
  shift
  # re2 builds its native module in an install script. pnpm dlx skips the script unless it is allowed, and
  # Renovate then falls back to RegExp, which validates regexes less strictly than the RE2 it uses for real.
  pnpm dlx --allow-build=re2 --package="renovate@$renovate_version" "$tool" "$@"
}

case "${1:-}" in
  validate)
    dlx renovate-config-validator --strict
    ;;
  preview)
    if [ -z "${GITHUB_COM_TOKEN:-}" ] && command -v gh >/dev/null 2>&1; then
      GITHUB_COM_TOKEN="$(gh auth token 2>/dev/null || true)"
      export GITHUB_COM_TOKEN
    fi
    log="$(mktemp)"
    trap 'rm -f "$log"' EXIT
    # The branches Renovate would open are logged at trace level only. (A prefix on the dlx function call
    # is not guaranteed to reach the child process in POSIX sh, so export.)
    export LOG_LEVEL=trace LOG_FORMAT=json
    if ! dlx renovate --platform=local >"$log" 2>&1; then
      tail -n 20 "$log" >&2
      echo "renovate: Renovate failed (see above)." >&2
      exit 1
    fi
    node tools/scripts/src/checks/renovate-preview/cli.ts "$log"
    ;;
  *)
    echo "usage: tools/scripts/sh/renovate.sh validate|preview" >&2
    exit 2
    ;;
esac
