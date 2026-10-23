#!/usr/bin/env sh
# Lint the repo's shell scripts with the pinned shellcheck (docs/adr/0008).
# Checks every tracked or staged *.sh except .agents/, which holds upstream skills that must stay byte-identical.
# Fails (instead of silently skipping) when shellcheck is missing or the wrong version.
# Run by the pre-commit hook (when a *.sh file changes) and by CI.
set -eu

cd "$(git rev-parse --show-toplevel)"

required="$(tr -d '[:space:]' < .shellcheck-version)"
if ! command -v shellcheck >/dev/null 2>&1; then
  echo "shellcheck: shellcheck is not installed. Install v${required}: see docs/local-env-setup/setup.md (\"4. shellcheck\")." >&2
  exit 1
fi
installed="$(shellcheck --version | sed -n 's/^version: //p')"
if [ "$installed" != "$required" ]; then
  echo "shellcheck: shellcheck ${required} is required, but found \"${installed}\" at $(command -v shellcheck). Reinstall it: see docs/local-env-setup/setup.md (\"4. shellcheck\")." >&2
  exit 1
fi

git ls-files -z -- '*.sh' ':!.agents/' | xargs -0 shellcheck
