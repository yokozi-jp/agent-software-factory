// The rules of secret-scan (docs/tooling/secret-scan.md): what can be scanned, the one betterleaks command
// line, which commits a push adds, what to scan or skip, and the exit code. Pure functions (plan() reads
// git only through the Repo that cli.ts passes); cli.ts runs git and betterleaks.

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
// (docs/adr/0009), and flags that callers cannot override (--redact, --config). --verbose with --redact prints each
// finding's rule, path and line with the secret hidden, so a failure says where to look. Runs in the repository top.
export function betterleaks(mode: "git" | "dir", options: readonly string[]): string[] {
  return [
    "exec",
    "--",
    "betterleaks",
    mode,
    "--redact",
    "--verbose",
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

// What plan() asks of the repository. cli.ts answers with git; plan() asks only what it needs, in order.
export interface Repo {
  // Whether the commit is in this clone.
  readonly hasCommit: (sha: string) => boolean;
  // How many commits rev-list selects with revs ("base..head", "sha --not --remotes", "--all").
  readonly countCommits: (revs: readonly string[]) => number;
  // How many files are staged.
  readonly countStaged: () => number;
}

// One thing cli.ts does, in order: print and end with status (report), or print and run betterleaks with
// mode and options (scan), which ends with betterleaks' exit code.
export type Step =
  | {
      readonly kind: "report";
      readonly stdout: string;
      readonly stderr: string;
      readonly status: 0 | 1;
    }
  | {
      readonly kind: "scan";
      readonly stdout: string;
      readonly mode: "git" | "dir";
      readonly options: readonly string[];
    };

const say = (line: string): string => `secret-scan: ${line}\n`;
const pass = (line: string): Step => ({ kind: "report", stdout: say(line), stderr: "", status: 0 });
const scan = (line: string, mode: "git" | "dir", options: readonly string[]): Step => ({
  kind: "scan",
  stdout: say(line),
  mode,
  options,
});

// The commits that rev-list selects with revs. An empty selection is skipped, and says so.
function scanCommits(label: string, revs: readonly string[], repo: Repo): Step {
  const count = repo.countCommits(revs);
  if (count === 0) return pass(`${label}: 0 commits, skipped (nothing new to scan)`);
  const selection = revs.join(" ");
  return scan(`${label}: scanning ${count} commit(s) (${selection})`, "git", [
    `--log-opts=${selection}`,
  ]);
}

// A deleted branch has nothing to scan. The commits after the remote's commit can only be told apart when
// that commit is in this clone; otherwise the push fails and asks for a fetch.
function scanPushedRef(ref: PushedRef, repo: Repo): Step {
  if (ref.kind === "deleted") return pass(`${ref.remoteRef}: branch deletion, nothing to scan`);
  if (ref.remote !== undefined && !repo.hasCommit(ref.remote)) {
    return {
      kind: "report",
      stdout: "",
      stderr:
        say(`${ref.remoteRef} is at ${ref.remote}, which is not in this clone.`) +
        "Run `git fetch` and push again, so the scan can tell which commits are new.\n",
      status: 1,
    };
  }
  return scanCommits(ref.label, ref.revs, repo);
}

// What to do for the target. refs are the pushed refs (pre-push only).
export function plan(target: Target, refs: readonly PushedRef[], repo: Repo): Step[] {
  switch (target.name) {
    case "staged": {
      const count = repo.countStaged();
      if (count === 0) return [pass("staged: 0 files, skipped (nothing staged)")];
      return [scan(`staged: scanning ${count} file(s)`, "git", ["--staged"])];
    }
    case "pre-push":
      return refs.map((ref) => scanPushedRef(ref, repo));
    case "range":
      return [scanCommits("range", [`${target.base}..${target.head}`], repo)];
    case "all":
      return [
        scan(`all: scanning ${repo.countCommits(["--all"])} commit(s) (full history)`, "git", []),
      ];
    case "worktree":
      return [scan("worktree: scanning working tree files", "dir", [])];
  }
}

// The exit code from the status of each step (null: betterleaks did not start). A push fails with 1 when
// any ref fails; the other targets have one step and pass its code on.
export function exitStatus(target: Target, statuses: readonly (number | null)[]): number {
  const codes = statuses.map((status) => status ?? 1);
  if (target.name === "pre-push") return codes.some((code) => code !== 0) ? 1 : 0;
  return codes[0] ?? 0;
}

// The exit code when git fails (not a repository, a bad revision in range): git's own code, so that it is
// not taken for a finding (1), which stops a push. 128 (git's code for a fatal error) when git gave none.
export function gitFailed(status: number | null | undefined): number {
  const code = status ?? 128;
  return code > 1 ? code : 128;
}
