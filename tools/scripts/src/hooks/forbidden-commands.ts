// block-forbidden-commands: refuse the shell commands that the "禁止" section of
// docs/tooling/agent-permissions.md lists and that a string can tell: a push to main, `gh pr merge`,
// --no-verify, changes to the repository settings, reads of credentials, `aws` and `cdk deploy`, and a
// download that is run unseen (`curl | sh`). The agent's permission rules deny the same operations in
// their plain form; this check also catches the forms that make a rule fall back to ask (quotes, extra
// spaces, `bash -c`, `env`, `git -C`), and it works whatever agent is active.
// Not seen: scripts that run the command (`sh x.sh`), aliases, variables (`g=git; $g push origin main`),
// and a command that is built from pieces.
import { gitPush } from "./force-push.ts";
import { commandLines, inCommandPosition } from "./shell-command.ts";

// `gh [-opt [arg]]... `.
const gh = String.raw`gh(\s+-\S+(\s+[^-\s]\S*)?)*\s+`;
// The refspec words of a push that name main: `main`, `HEAD:main`, `refs/heads/main`.
const mainRefspec = /[\s:/"']main(\s|$|["'])/;
// A push option (`-o "main is protected"`) is text for the server, not a refspec.
const pushOption = /\s(-o|--push-option)(=|\s+)("[^"]*"|'[^']*'|\S+)/g;
// A string between quotes, so that a commit message that mentions a flag is not read as the flag.
const quoted = /"[^"]*"|'[^']*'/g;
// Where the command starts in a segment that may be the string given to `bash -c`.
const fromGit = (segment: string): string => segment.slice(Math.max(0, segment.search(/\bgit\s/)));

// The settings of the repository that `gh api` changes: rulesets, branch protection and Actions settings.
const settingsPath =
  /[\s/](rulesets|branches\/\S+\/protection|actions\/(permissions|secrets|variables|runners|oidc))(\/|\s|$)/;
const fieldFlag = /\s(-f|-F|--field|--raw-field|--input)(\s|=)/;

function changesSettings(segment: string): boolean {
  if (!settingsPath.test(segment)) return false;
  const method = /\s(?:-X|--method)(?:\s+|=)(\w+)/i.exec(segment)?.[1];
  return method === undefined ? fieldFlag.test(segment) : method.toUpperCase() !== "GET";
}

// A path of credentials: ~/.aws, ~/.ssh, ~/.config/gh in any spelling of the home directory, and .env*.
const credentialPath =
  /(~|\$HOME|\$\{HOME\}|\/home\/[^/\s]+|\/Users\/[^/\s]+|\/root)\/\.(aws|ssh|config\/gh)(\/|\s|$|["'])|[\s/"'=]\.env(\.[A-Za-z0-9._-]+)?(\s|$|["'])/;
const readers = String.raw`(cat|less|more|head|tail|cp|mv|scp|rsync|tar|zip|base64|grep|egrep|rg|awk|sed|source|\.|ls|find|xxd|strings|openssl|bat|nl|od|hexdump|sort|cut|diff|tee|curl|wget|jq|yq|node|python3?)(\s|$)`;

const shells = String.raw`(sh|bash|zsh|dash|ksh)`;
const downloads = [
  String.raw`\b(curl|wget)\b[^\n]*\|\s*(sudo\s+(-\S+\s+)*)?${shells}(\s|$)`,
  String.raw`\b(${shells}|eval)\b[^|;&\n]*\$\(\s*(curl|wget)\b`,
  String.raw`\b(${shells}|source|\.)\s+<\(\s*(curl|wget)\b`,
].map((pattern) => new RegExp(pattern));

const refusal = (what: string, instead: string): string =>
  `block-forbidden-commands: refused. ${what} ${instead} (docs/tooling/agent-permissions.md).`;

// The refusal for <command>, or undefined to allow it.
export function forbiddenCommand(command: string): string | undefined {
  // Stryker disable next-line ArrayDeclaration: a wrapper word that is not in the command changes nothing.
  const some = (pattern: string, wrappers: readonly string[] = []): string[] =>
    inCommandPosition(command, pattern, wrappers, "");
  // Stryker disable next-line StringLiteral: the text that replaces a push option only has to hold no refspec.
  if (some(gitPush).some((segment) => mainRefspec.test(segment.replace(pushOption, ""))))
    return refusal(
      "A push to main (push to main) changes the shared branch without a review.",
      "Push a branch and open a PR; the user merges it.",
    );
  if (some(`${gh}pr\\s+merge(\\s|$)`).length > 0)
    return refusal(
      "`gh pr merge` (merge) is the decision of the user.",
      "Open the PR and say it is ready. The user merges it.",
    );
  if (
    some(String.raw`git\s`).some((segment) =>
      // Stryker disable next-line StringLiteral: as above.
      /\s--no-verify(\s|$)/.test(fromGit(segment).replace(quoted, "")),
    )
  )
    return refusal(
      "`--no-verify` (skip hooks) turns the checks off.",
      "Fix what the hook reports, then commit again.",
    );
  if (
    some(`${gh}(secret|variable)(\\s|$)`).length > 0 ||
    some(`${gh}repo\\s+delete(\\s|$)`).length > 0 ||
    some(`${gh}api\\s`).some(changesSettings)
  )
    return refusal(
      "Changing secrets, variables, rulesets, Actions settings or deleting the repository (repository settings) is the boundary of the agent.",
      "Ask the user to do it.",
    );
  if (
    some(readers).some((segment) => credentialPath.test(segment)) ||
    some(`${gh}auth\\s+(token(\\s|$)|status\\s(.*\\s)?(--show-token|-t)(\\s|$))`).length > 0
  )
    return refusal(
      "Reading credentials (credentials: ~/.aws, ~/.ssh, ~/.config/gh, .env*, `gh auth token`) leaks them to the model.",
      'Ask the user to run the command that needs them. A command that only names a path in text (sed, grep) also stops here: write the code to a file with a file tool and run that, or leave the name out (docs/tooling/agent-permissions.md, ".env を読ませない").',
    );
  if (
    some(String.raw`aws(\s|$)`).length > 0 ||
    some(String.raw`cdk\s+(deploy|destroy)(\s|$)`, ["npx", "pnpm", "dlx"]).length > 0
  )
    return refusal(
      "`aws` and `cdk deploy` (cloud) run with the credentials of the user.",
      "CI deploys. Open a PR, or ask the user to run it.",
    );
  if (commandLines(command).some((line) => downloads.some((pattern) => pattern.test(line))))
    return refusal(
      "A download that is run unseen (download: `curl | sh`) runs what nobody read.",
      "Download the script to a file, read it, and then run it.",
    );
  return undefined;
}
