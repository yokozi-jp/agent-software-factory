#!/usr/bin/env sh
# Run betterleaks with the pinned version check. Used by lefthook hooks.
# Fails (instead of silently skipping) when betterleaks is missing, so nobody commits unscanned.
set -eu

REQUIRED_VERSION="$(tr -d '[:space:]' < "$(git rev-parse --show-toplevel)/.betterleaks-version")"

if ! command -v betterleaks >/dev/null 2>&1; then
  cat >&2 <<EOF
betterleaks is not installed, so the secret scan cannot run.
Install betterleaks v${REQUIRED_VERSION}: see docs/development-setup.md ("betterleaks").
EOF
  exit 1
fi

installed="$(betterleaks version 2>/dev/null || true)"
if [ "$installed" != "$REQUIRED_VERSION" ]; then
  cat >&2 <<EOF
betterleaks ${REQUIRED_VERSION} is required, but found "${installed}" at $(command -v betterleaks).
Reinstall it: see docs/development-setup.md ("betterleaks").
EOF
  exit 1
fi

exec betterleaks "$@"
