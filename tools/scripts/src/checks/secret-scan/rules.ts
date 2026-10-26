// The rules of secret-scan (docs/tooling/secret-scan.md): what can be scanned, the one betterleaks command
// line, and which commits a push adds. Pure functions; cli.ts runs git and betterleaks.

export type Target =
  | { readonly name: "staged" | "pre-push" | "all" | "worktree" }
  | { readonly name: "range"; readonly base: string; readonly head: string };

const self = "node tools/scripts/src/checks/secret-scan/cli.ts";

export const usage = [
  "Usage:",
  `  ${self} staged               # pre-commit: staged changes`,
  `  ${self} pre-push             # pre-push: refs from git on stdin`,
  `  ${self} range <base> <head>  # CI pull request: base..head`,
  `  ${self} all                  # CI push to main, manual: full history`,
  `  ${self} worktree             # manual: working tree files`,
  "",
].join("\n");

const isPair = (list: readonly string[]): list is readonly [string, string] => list.length === 2;

// Callers choose only what to scan: nothing else on the command line reaches betterleaks.
export function parseTarget(argv: readonly string[]): Target | undefined {
  const [name, ...rest] = argv;
  if (name === "range") {
    if (!isPair(rest)) return undefined;
    const [base, head] = rest;
    return { name, base, head };
  }
  if (name === "staged" || name === "pre-push" || name === "all" || name === "worktree")
    return rest.length === 0 ? { name } : undefined;
  return undefined;
}

// The arguments of `mise` for the only betterleaks run: the version pinned in mise.toml and mise.lock
// (docs/adr/0009), and flags that callers cannot override (--redact, --config). Runs in the repository top.
export function betterleaks(mode: "git" | "dir", options: readonly string[]): string[] {
  return [
    "exec",
    "--",
    "betterleaks",
    mode,
    "--redact",
    "--no-banner",
    "--config",
    ".betterleaks.toml",
    ...options,
    ".",
  ];
}

export type PushedRef =
  | { readonly kind: "deleted"; readonly remoteRef: string }
  // revs are rev-list arguments. remote is the remote's commit, which must be in this clone.
  | {
      readonly kind: "scan";
      readonly remoteRef: string;
      readonly label: string;
      readonly revs: readonly string[];
      readonly remote?: string;
    };

const missing = /^0+$/;

// Git writes four fields on every line (githooks(5)).
const isRefLine = (fields: string[]): fields is [string, string, string, string] =>
  fields.length === 4;

// Git passes "<local ref> <local object name> <remote ref> <remote object name>" per ref to pre-push
// (githooks(5)). The object name is all zeros for a ref that is deleted (local) or new (remote).
export function pushedRefs(stdin: string): PushedRef[] {
  return stdin
    .split("\n")
    .map((line) => line.split(" "))
    .filter(isRefLine)
    .map(([localRef, localSha, remoteRef, remoteSha]): PushedRef => {
      if (missing.test(localSha)) return { kind: "deleted", remoteRef };
      const label = `${localRef} -> ${remoteRef}`;
      // A new branch: the commits that no remote-tracking branch has yet.
      if (missing.test(remoteSha))
        return { kind: "scan", remoteRef, label, revs: [localSha, "--not", "--remotes"] };
      return {
        kind: "scan",
        remoteRef,
        label,
        remote: remoteSha,
        revs: [`${remoteSha}..${localSha}`],
      };
    });
}
