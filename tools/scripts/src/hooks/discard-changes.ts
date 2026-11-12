// ask-discard-changes: ask the user before a git command that throws away uncommitted changes in the
// working tree or a stash: `git checkout` of a path, `git restore` of the working tree, `git reset --hard`,
// `git clean`, `git switch --discard-changes` (or `-f`), `git stash drop`/`clear`.
// git cannot bring the changes back. The working tree may hold another session's edits or the agent's own
// edits that are not committed yet (the retro of PR #289: `git checkout -- <file>` dropped the agent's
// own edits; the retro of PR #710: `git checkout <file>` without `--` did it again). Only a command in command
// position is looked at (shell-command.ts), as in force-push.ts.
//
// `git checkout` does two jobs: it switches branches and it restores paths (git 2.23 split them into `git switch`
// and `git restore`). `git checkout main` and `git checkout src/a.ts` look alike, and only git can tell
// them apart, so any `git checkout` with an argument asks, except the forms that create a branch or detach HEAD, which
// cannot overwrite a path. The way to change branch without asking is `git switch <branch>`, which keeps the changes
// or refuses.
import { inCommandPosition } from "./shell-command.ts";

// `git [-opt [arg]]... <subcommand>`, as gitPush in force-push.ts.
const git = (subcommand: string): string =>
  String.raw`git(\s+-\S+(\s+[^-\s]\S*)?)*\s+${subcommand}`;

// Whether the words after the subcommand have the long option or a short option bundle with <short>.
const has = (words: readonly string[], long: string, short: string): boolean =>
  words.some((word) => word === long || new RegExp(`^-[A-Za-z]*${short}`).test(word));

// `git checkout -b <name>` (or `-B`, `--orphan`, `--track`, `--detach`): a new branch or a detached HEAD, never a path.
const createsOrDetaches = (words: readonly string[]): boolean =>
  has(words, "--orphan", "[bB]") || has(words, "--track", "t") || has(words, "--detach", "d");

// For each subcommand, whether the words after it make it discard changes.
const discards: Record<string, (words: readonly string[]) => boolean> = {
  // `-p` restores hunks of the working tree.
  checkout: (words) =>
    words.includes("--") ||
    has(words, "--force", "f") ||
    has(words, "--patch", "p") ||
    (!createsOrDetaches(words) && words.some((word) => !word.startsWith("-"))),
  // `git restore` restores the working tree unless only --staged is given.
  restore: (words) => !has(words, "--staged", "S") || has(words, "--worktree", "W"),
  reset: (words) => words.includes("--hard"),
  clean: (words) => !has(words, "--dry-run", "n"),
  switch: (words) => words.includes("--discard-changes") || has(words, "--force", "f"),
  stash: (words) => words[0] === "drop" || words[0] === "clear",
};

export function discardsChanges(command: string): boolean {
  return Object.entries(discards).some(([subcommand, discardsWith]) =>
    // Stryker disable next-line ArrayDeclaration: a wrapper word that is not in the command changes nothing.
    inCommandPosition(command, `${git(subcommand)}(\\s|$)`, [], "").some((segment) => {
      // The words after the first `git ... <subcommand>` of the segment.
      const rest = segment.replace(new RegExp(`^.*?${git(subcommand)}`), "");
      // Stryker disable next-line Regex: equivalent, the empty words that /\s/ leaves are filtered out.
      return discardsWith(rest.split(/\s+/).filter((word) => word !== ""));
    }),
  );
}

export const discardChangesReason =
  "ask-discard-changes: this git command discards uncommitted changes, which git cannot restore. The working tree may hold another session's edits or your own uncommitted ones. To undo your own edit, write the file back with the file tools, or keep the changes with `git stash`. To change branch, use `git switch <branch>` (docs/tooling/agent-permissions.md).";
