import { describe, expect, it } from "vite-plus/test";
import { discardsChanges } from "./discard-changes.ts";

describe("discardsChanges", () => {
  it.each([
    "git checkout -- apps/api/test/auth-fixtures.ts",
    "git checkout HEAD -- src/a.ts",
    "git checkout .",
    "git checkout -f main",
    "git checkout --force main",
    "git restore src/a.ts",
    "git restore --worktree src/a.ts",
    "git restore --staged --worktree src/a.ts",
    "git restore -SW src/a.ts",
    "git restore .",
    "git reset --hard",
    "git reset --hard origin/main",
    "git clean -fd",
    "git clean -xfd",
    "git switch --discard-changes main",
    "git switch -f main",
    "git stash drop",
    "git stash clear",
    "git -C /work/tree checkout -- a.ts",
    "git -c core.x=y restore a.ts",
    // The command that lost the edits in the retro (PR #289): the discard came first in a chain.
    "git checkout -- apps/api/test/auth-fixtures.ts && git status --short",
    "pnpm test; git reset --hard",
    'bash -c "git restore a.ts"',
  ])("asks before a command that discards uncommitted changes: %j", (command) => {
    expect(discardsChanges(command)).toBe(true);
  });

  it.each([
    "git checkout main",
    "git checkout -b feat/x",
    "git checkout -b feat/x origin/main",
    "git switch main",
    "git switch -c feat/x",
    "git restore --staged src/a.ts",
    "git restore -S src/a.ts",
    "git reset",
    "git reset HEAD~1",
    "git reset --soft HEAD~1",
    "git clean -n",
    "git clean --dry-run -d",
    "git stash",
    "git stash pop",
    "git stash list",
    "git status && git diff",
    // Only text that mentions the command.
    'git commit -m "git reset --hard を避ける"',
    "echo git checkout -- a.ts",
  ])("allows a command that keeps the changes: %j", (command) => {
    expect(discardsChanges(command)).toBe(false);
  });
});
