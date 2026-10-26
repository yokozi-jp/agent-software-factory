// The rules of check-adr-number (docs/tooling/worktrees.md ("PR を出す")): which ADR numbers are taken,
// and by whom. Pure functions; cli.ts runs gh and git and prints what these return.

export interface OpenPr {
  readonly number: number;
  readonly headRefName: string;
  readonly files: readonly { readonly path: string }[];
}

export interface Output {
  readonly status: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Input {
  // The branch that runs the check: its own open PR does not take a number from it.
  readonly branch: string;
  // The files under docs/adr/ on origin/main.
  readonly main: readonly string[];
  readonly prs: readonly OpenPr[];
  // The files under docs/adr/ in the index and untracked now. A renamed ADR counts with its new number
  // before the rename is committed.
  readonly branchFiles: readonly string[];
}

const adrPath = /^docs\/adr\/(\d{4})-.*\.md$/;
const adrNumber = (path: string): string | undefined => adrPath.exec(path)?.[1];

// The ADR numbers that origin/main and the other open PRs use, each with who uses it.
function takenNumbers({ branch, main, prs }: Input): Map<string, Set<string>> {
  const taken = new Map<string, Set<string>>();
  const take = (path: string, user: string): void => {
    const number = adrNumber(path);
    if (number === undefined) return;
    const users = taken.get(number) ?? new Set<string>();
    users.add(user);
    taken.set(number, users);
  };
  for (const path of main) take(path, "origin/main");
  for (const pr of prs) {
    if (pr.headRefName === branch) continue;
    for (const { path } of pr.files) take(path, `PR #${pr.number}`);
  }
  return taken;
}

// Exit 1 when an ADR that the branch adds uses a taken number. Prints the next free number either way.
export function checkNumbers(input: Input): Output {
  const taken = takenNumbers(input);
  const onMain = new Set(input.main);
  const added = new Set<string>();
  for (const path of input.branchFiles) {
    const number = onMain.has(path) ? undefined : adrNumber(path);
    if (number !== undefined) added.add(number);
  }
  const stderr = [...added]
    .toSorted()
    .flatMap((number) => {
      const users = taken.get(number);
      if (users === undefined) return [];
      return [
        `check-adr-number: ADR ${number} is also used by ${[...users].toSorted().join(", ")}. Renumber this branch's ADR and the places that cite it.\n`,
      ];
    })
    .join("");
  const last = Math.max(0, ...[...taken.keys(), ...added].map(Number));
  return {
    status: stderr === "" ? 0 : 1,
    stdout: `next free ADR number: ${String(last + 1).padStart(4, "0")}\n`,
    stderr,
  };
}

export const ghFailed: Output = {
  status: 2,
  stdout: "",
  stderr:
    "check-adr-number: could not list the open PRs with gh. Check `gh auth status` and try again.\n",
};

// What JSON.parse returns for `{...}` (and `[...]`): not null, and not a string, number or boolean.
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value instanceof Object;
const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

// The output of `gh pr list --json number,headRefName,files`, or undefined when it is not that list
// (gh printed something else, so nothing can be checked). Throws when the output is not JSON.
export function parsePrs(json: string): OpenPr[] | undefined {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) return undefined;
  const prs: OpenPr[] = [];
  for (const item of value) {
    const number = field(item, "number");
    const headRefName = field(item, "headRefName");
    const list = field(item, "files");
    if (typeof number !== "number" || typeof headRefName !== "string" || !Array.isArray(list))
      return undefined;
    const files: { path: string }[] = [];
    for (const file of list) {
      const path = field(file, "path");
      if (typeof path !== "string") return undefined;
      files.push({ path });
    }
    prs.push({ number, headRefName, files });
  }
  return prs;
}
