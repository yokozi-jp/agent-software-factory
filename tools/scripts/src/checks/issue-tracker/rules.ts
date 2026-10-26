// The rules of issue-tracker (docs/agents/issue-tracker.md ("検査")): problems in the open issues and the
// wayfinder maps that an agent would otherwise act on. Pure functions; cli.ts runs gh and git and prints.
//   stale paths       an open issue names a path that git history removed (#158 moved scripts/, and six
//                     ready-for-agent issues still pointed there)
//   implementation    a decision ticket of a map was closed without a link to its implementation issue, or
//                     a word that none is needed (the Notes of the map; #43 was closed without one)
//   blocking edges    an issue says "Blocked by:" in its body, but GitHub has no native edge for it, so the
//                     frontier query and the tracker's UI show it as unblocked (#178, #199, #141)

export interface Issue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
}

export interface Child {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly stateReason: string;
  readonly labels: readonly string[];
}

// The paths of the tree now, and the paths that a commit deleted. Directories are listed by their path
// without a trailing slash.
export interface Paths {
  readonly existing: ReadonlySet<string>;
  readonly removed: ReadonlySet<string>;
}

export interface Output {
  readonly status: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

// Each file, and every directory above it.
export function withDirectories(files: readonly string[]): Set<string> {
  const paths = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    for (let end = 1; end <= parts.length; end += 1) paths.add(parts.slice(0, end).join("/"));
  }
  return paths;
}

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

// The text of each inline code span outside fenced code blocks (a fence is a line that starts with ```).
function codeSpans(markdown: string): string[] {
  // Stryker disable next-line ArrayDeclaration: equivalent, an extra entry that is not a path names nothing.
  const spans: string[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    else if (!fenced) for (const [, span] of line.matchAll(/`([^`]+)`/g)) spans.push(String(span));
  }
  return spans;
}

// A span that names one path: it has a slash, or it is a bare file name with an extension. A leading ./ and
// a trailing slash are dropped. `full` is false for a bare file name. Placeholders, globs and URLs need no
// test: git never records a path like `<name>/*.sh`, so they are never removed paths.
function pathOf(span: string): { path: string; full: boolean } | undefined {
  const path = span.replace(/^\.\//, "").replace(/\/$/, "");
  const full = span.includes("/");
  return full || /\.[a-z]+$/.test(path) ? { path, full } : undefined;
}

// The paths an issue names that git history removed and the tree does not have. A bare file name counts
// when a removed file had that name and no file of the tree has it.
export function stalePaths(body: string, paths: Paths): string[] {
  const existingNames = new Set([...paths.existing].map(baseName));
  const removedNames = new Set([...paths.removed].map(baseName));
  const stale = new Set<string>();
  for (const span of codeSpans(body)) {
    const named = pathOf(span);
    if (named === undefined || paths.existing.has(named.path)) continue;
    const { path, full } = named;
    const removed = full
      ? paths.removed.has(path)
      : removedNames.has(path) && !existingNames.has(path);
    if (removed) stale.add(path);
  }
  return [...stale];
}

// The lines of a section ("## <title>") of a map body, up to the next heading of that level.
function section(body: string, title: string): string[] {
  const lines = body.split("\n");
  const start = lines.indexOf(`## ${title}`);
  // Stryker disable next-line ArrayDeclaration: equivalent, a line without an issue link matches no ticket.
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

// The tickets that decide: a decision may need work, which the Notes of a map require to be linked.
const deciding = new Set(["wayfinder:grilling", "wayfinder:prototype"]);
const mentionsImplementation = (text: string): boolean => text.includes("実施");

// The decision tickets closed as completed whose line in Decisions so far does not mention 実施. Those
// are the ones whose comments cli.ts reads; implementationProblems decides with them.
export function ticketsToRead(
  mapBody: string,
  children: readonly Child[],
  exempt: ReadonlySet<number>,
): Child[] {
  const decisions = section(mapBody, "Decisions so far");
  return children.filter((child) => {
    if (child.state !== "closed" || child.stateReason !== "completed") return false;
    if (exempt.has(child.number) || !child.labels.some((label) => deciding.has(label)))
      return false;
    const line = decisions.find((text) => text.includes(`/issues/${child.number})`));
    return line === undefined || !mentionsImplementation(line);
  });
}

// A message for each ticket of ticketsToRead whose comments do not mention 実施 either.
export function implementationProblems(
  map: number,
  tickets: readonly Child[],
  comments: ReadonlyMap<number, readonly string[]>,
): string[] {
  return tickets
    .filter((ticket) => {
      const texts = comments.get(ticket.number);
      return texts === undefined || !texts.some(mentionsImplementation);
    })
    .map(
      (ticket) =>
        `#${ticket.number} 「${ticket.title}」 (map #${map}): closed without its implementation issue. Create it and link it from the resolution comment and the Decisions so far line ("実施: ..."), or write there that none is needed ("実施の Issue は作らない").`,
    );
}

// The issues of this repository that a "Blocked by:" line names, by link or by #number.
// `repository` is <owner>/<name>; links to another repository's issues do not count, nor do the issues a
// note in full-width parentheses names (「…（決定は [#75](…)）」 says where a decision was made).
export function blockersInBody(body: string, repository: string): number[] {
  const numbers = new Set<number>();
  for (const text of body.split("\n")) {
    if (!text.startsWith("Blocked by:")) continue;
    // Stryker disable next-line StringLiteral: equivalent, any text without an issue number names none.
    const line = text.replaceAll(/（[^）]*）/g, "");
    for (const [, owner, number] of line.matchAll(
      /github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/g,
    ))
      if (owner === repository) numbers.add(Number(number));
    for (const [, number] of line.matchAll(/(?<![\w/])#(\d+)/g)) numbers.add(Number(number));
  }
  return [...numbers];
}

// A message for each blocker in the body that GitHub does not have as a native edge.
export function edgeProblems(
  issue: Issue,
  inBody: readonly number[],
  native: readonly number[],
): string[] {
  return inBody
    .filter((blocker) => !native.includes(blocker))
    .map(
      (blocker) =>
        `#${issue.number} 「${issue.title}」: "Blocked by:" names #${blocker}, but GitHub has no native edge. Add it (docs/agents/issue-tracker.md ("Wayfinding operations")).`,
    );
}

// A message for an issue that names removed paths.
export function pathProblems(issue: Issue, stale: readonly string[]): string[] {
  return stale.map(
    (path) =>
      `#${issue.number} 「${issue.title}」: \`${path}\` was removed from the repository. Rewrite the body with the path it moved to.`,
  );
}

export function report(problems: readonly string[]): Output {
  if (problems.length === 0)
    return { status: 0, stdout: "issue-tracker: no problems\n", stderr: "" };
  return {
    status: 1,
    stdout: "",
    stderr: problems.map((problem) => `issue-tracker: ${problem}\n`).join(""),
  };
}

export const ghFailed = (what: string): Output => ({
  status: 2,
  stdout: "",
  stderr: `issue-tracker: could not read ${what} with gh. Check \`gh auth status\` and try again.\n`,
});

export const shallow: Output = {
  status: 2,
  stdout: "",
  stderr:
    "issue-tracker: the clone is shallow, so the removed paths are unknown. Fetch the full history (actions/checkout with fetch-depth: 0).\n",
};

// What JSON.parse returns for `{...}` (and `[...]`): not null, and not a string, number or boolean.
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value instanceof Object;
const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);
const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;

// The output of `gh issue list --json number,title,body`, or undefined when it is not that list.
// Throws when the output is not JSON.
export function parseIssues(json: string): Issue[] | undefined {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) return undefined;
  const issues: Issue[] = [];
  for (const item of value) {
    const number = field(item, "number");
    const title = field(item, "title");
    const body = field(item, "body");
    if (typeof number !== "number" || typeof title !== "string" || typeof body !== "string")
      return undefined;
    issues.push({ number, title, body });
  }
  return issues;
}

// One JSON object per line, as `gh api --paginate --jq '.[] | {...}'` prints the sub-issues of a map:
// {number, title, state, state_reason, labels: [names]}. Undefined when a line is not that object.
export function parseChildren(lines: string): Child[] | undefined {
  const children: Child[] = [];
  for (const line of lines.split("\n")) {
    if (line === "") continue;
    const item: unknown = JSON.parse(line);
    const number = field(item, "number");
    const title = field(item, "title");
    const state = field(item, "state");
    const stateReason = field(item, "state_reason") ?? "";
    const labels = strings(field(item, "labels"));
    if (
      typeof number !== "number" ||
      typeof title !== "string" ||
      typeof state !== "string" ||
      typeof stateReason !== "string" ||
      labels === undefined
    )
      return undefined;
    children.push({ number, title, state, stateReason, labels });
  }
  return children;
}

// A JSON array of strings (`--jq '[...]'`), or undefined when it is not one.
export function parseStrings(json: string): string[] | undefined {
  return strings(JSON.parse(json));
}

// A JSON array of numbers (`--jq '[.[].number]'`), or undefined when it is not one.
export function parseNumbers(json: string): number[] | undefined {
  const value: unknown = JSON.parse(json);
  return Array.isArray(value) && value.every((item) => typeof item === "number")
    ? value
    : undefined;
}
