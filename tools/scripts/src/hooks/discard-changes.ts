// ask-discard-changes: ask the user before a git command that throws away uncommitted changes in the
// working tree or a stash: `git checkout -- <path>` (or `.`, `-f`), `git restore` of the working tree,
// `git reset --hard`, `git clean`, `git switch --discard-changes` (or `-f`), `git stash drop`/`clear`.
// git cannot bring the changes back. The working tree may hold another session's edits or the agent's own
// edits that are not committed yet (the retro of PR #289: `git checkout -- <file>` dropped the agent's
// own edits). Only a command in command position is looked at (shell-command.ts), as in force-push.ts.
import { inCommandPosition } from "./shell-command.ts";

// `git [-opt [arg]]... <subcommand>`, as gitPush in force-push.ts.
const git = (subcommand: string): string =>
  String.raw`git(\s+-\S+(\s+[^-\s]\S*)?)*\s+${subcommand}`;

// Whether the words after the subcommand have the long option or a short option bundle with <short>.
const has = (words: readonly string[], long: string, short: string): boolean =>
  words.some((word) => word === long || new RegExp(`^-[A-Za-z]*${short}`).test(word));

// For each subcommand, whether the words after it make it discard changes.
const discards: Record<string, (words: readonly string[]) => boolean> = {
  checkout: (words) => words.includes("--") || words.includes(".") || has(words, "--force", "f"),
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
  "ask-discard-changes: this git command discards uncommitted changes, which git cannot restore. The working tree may hold another session's edits or your own uncommitted ones. To undo your own edit, write the file back with the file tools, or keep the changes with `git stash` (docs/tooling/agent-permissions.md).";
