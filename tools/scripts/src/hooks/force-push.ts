// block-force-push: refuse `git push` with --force, --force-with-lease, -f or a `+refspec`.
// A force push rewrites a shared branch; the user runs it themselves after reviewing the history
// (PRs are squash merged, docs/adr/0004).
import { inCommandPosition } from "./shell-command.ts";

// `git [-opt [arg]]... push`.
const gitPush = String.raw`git(\s+-\S+(\s+[^-\s]\S*)?)*\s+push(\s|$)`;
// A `--force` form, `-f` (also inside a bundle such as -uf) or `+refspec`.
const forceFlag =
  /\s(--force(-with-lease|-if-includes)?(=\S*)?|-[A-Za-z0-9]*f[A-Za-z0-9]*|\+\S+)(\s|[)"'`}]|$)/;

export function refusesForcePush(command: string): boolean {
  // Stryker disable next-line ArrayDeclaration: a wrapper word that is not in the command changes nothing.
  return inCommandPosition(command, gitPush, [], "").some((segment) => forceFlag.test(segment));
}

export const forcePushMessage =
  "block-force-push: refused. Force push rewrites the remote branch. Ask the user to run it, or merge without rewriting history (PRs are squash merged, docs/adr/0004).";
