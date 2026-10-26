#!/usr/bin/env sh
# Run `vp check` on tracked files outside the workspace packages: root configs, docs/, .github/ ...
# Workspace packages (the pnpm-workspace.yaml globs) are checked per project by `nx affected -t check`.
# .agents/ and .kiro/skills/ are skipped like in the root vite.config.ts ignorePatterns.
# Only tracked files are listed, so untracked scratch files do not fail the check.
# Run by CI (`pnpm check:root`).
set -eu

cd "$(git rev-parse --show-toplevel)"

git ls-files -z -- ':!apps/' ':!packages/' ':!tools/' ':!.agents/' ':!.kiro/skills/' |
  xargs -0 pnpm exec vp check --no-error-on-unmatched-pattern
