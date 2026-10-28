// The rules of test-weakening (#138): which changes to tests warn, and what the warning says. It warns and never
// fails, like adr-check (docs/adr/0016), and shares its reading of pre-push and its annotations.
// Pure functions; cli.ts reads git, stdin and the environment and prints what these return.
import { annotationText, type Env, type Output } from "../output.ts";

// Test files, as Vitest finds them. Fixtures are files that other checks read, not tests to run.
const testName = /\.(test|spec)\.[cm]?[jt]sx?$/;
const fixture = /(^|\/)(fixtures|__fixtures__)\//;

export function isTestFile(path: string): boolean {
  return testName.test(path) && !fixture.test(path);
}

// A test file that a commit changes, from the merge base. `to` is undefined when the commit deletes it, or
// renames it to a name that is not a test file.
export interface TestChange {
  readonly from: string;
  readonly to: string | undefined;
}

// The changes to test files in `git diff --name-status --find-renames` output: "M\tpath", "D\tpath",
// "R100\told\tnew". An added file has no test to lose, so only the files that existed at the merge base count.
// git names the status with one letter; a rename or copy adds its similarity ("R100").
const entry = /^([A-Z])[0-9]*\t([^\t\n]+)(?:\t([^\t\n]+))?$/gm;

export function testChanges(diff: string): TestChange[] {
  const changes: TestChange[] = [];
  // Stryker disable next-line StringLiteral: equivalent, the pattern always captures the path.
  for (const [, status, from = "", to = from] of diff.matchAll(entry)) {
    if (status === "A" || !isTestFile(from)) continue;
    changes.push({ from, to: status !== "D" && isTestFile(to) ? to : undefined });
  }
  return changes;
}

// Modifiers that still declare a test that runs. `skip` and `todo` declare one that does not, so a test turned
// into `it.skip` or `it.todo` counts as removed. `extend` and `scoped` make a test function, not a test.
const runningModifiers = new Set([
  "concurrent",
  "sequential",
  "each",
  "for",
  "fails",
  "only",
  "runIf",
  "skipIf",
]);
// `it(`, `test(` and their chains (`it.each(`, `test.concurrent.for(`). Not `regex.test(` or `items.it(`.
const declaration = /(?<![\w$.])(?:it|test)((?:\.\w+)*)\(/g;
// A string or template literal, then a block comment, then a comment on a line of its own. The literal comes
// first so that `/*` inside it ("@/*", a glob) does not start a comment: the scan reaches the quote before the
// slash. A `'` or `"` ends at the end of its line; a regular expression with a quote in it can still confuse this,
// which is why the number is an estimate. `.` stops at the end of the line, so a line comment needs no `$`.
const literalsAndComments =
  /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|^[ \t]*\/\/.*/gm;

// The number of test cases a test file declares, read from its text. A table (`it.each(table)("title")`)
// counts once. Comments are left out; a declaration written inside a string still counts, so the number is
// an estimate that is compared only with the same file before the change.
export function countTests(source: string): number {
  let count = 0;
  // Stryker disable next-line StringLiteral: equivalent, the chain group always takes part (maybe empty).
  for (const [, chain = ""] of source
    .replace(literalsAndComments, (_match, literal?: string) => literal ?? "")
    .matchAll(declaration)) {
    const modifiers = chain.split(".").slice(1);
    if (modifiers.every((modifier) => runningModifiers.has(modifier))) count += 1;
  }
  return count;
}

export type Finding =
  | { readonly kind: "deleted"; readonly path: string }
  | {
      readonly kind: "fewer";
      readonly path: string;
      readonly before: number;
      readonly after: number;
    };

// What one change loses. `before` is the file at the merge base and `after` the file in the commit; a deleted
// file has no text to read, so the caller passes "".
export function finding(change: TestChange, before: string, after: string): Finding | undefined {
  if (change.to === undefined) return { kind: "deleted", path: change.from };
  const counts = { before: countTests(before), after: countTests(after) };
  return counts.after < counts.before ? { kind: "fewer", path: change.to, ...counts } : undefined;
}

const describeFinding = (item: Finding): string =>
  item.kind === "deleted"
    ? `${item.path} (deleted)`
    : `${item.path} (${item.before} -> ${item.after} test cases)`;

// The lines to warn about, one per finding, sorted and without repeats (two pushed commits can find the same).
export function findingLines(findings: readonly Finding[]): string[] {
  return [...new Set(findings.map(describeFinding))].sort();
}

const inCi = (env: Env): boolean => env.GITHUB_ACTIONS === "true";
const lines = (...text: string[]): string => text.map((line) => `${line}\n`).join("");

const header = "deletes test files or declares fewer test cases than before:";
const whatToDo =
  "If a test failed after your change, fix the code or the test instead of removing it. If the test is no longer needed, say why in the pull request body: a reviewer reads this pull request before merging it.";

export function warning(report: readonly string[], env: Env): Output {
  const list = report.map((line) => `  - ${line}`);
  if (inCi(env)) {
    const server = env.GITHUB_SERVER_URL ?? "https://github.com";
    const repository = env.GITHUB_REPOSITORY ?? "yokozi-jp/agent-software-factory";
    const guideUrl = `${server}/${repository}/blob/main/docs/code-review/agent-pull-requests.md#人が判断するもの`;
    const annotation = `Deleted test files or fewer test cases: ${report.join(", ")}. ${whatToDo}`;
    return {
      stdout: lines(
        `This change ${header}`,
        ...list,
        whatToDo,
        `What a reviewer checks: ${guideUrl}`,
        `::warning title=test-weakening::${annotationText(annotation)} What a reviewer checks: ${guideUrl}`,
      ),
      stderr: "",
    };
  }
  const guide = 'docs/code-review/agent-pull-requests.md ("人が判断するもの")';
  return {
    stdout: "",
    stderr: lines(
      `test-weakening: warning: this change ${header}`,
      ...list,
      `${whatToDo} See ${guide}.`,
      "If the change is intended, silence the warning with TESTS_ACK=1 (for example: TESTS_ACK=1 git push).",
    ),
  };
}

// When the base cannot be compared, test-weakening says why and passes (docs/adr/0016).
export function skipped(reason: string, env: Env): Output {
  if (inCi(env))
    return {
      stdout: lines(`::notice title=test-weakening::skipped. ${annotationText(reason)}`),
      stderr: "",
    };
  return { stdout: "", stderr: lines(`test-weakening: skipped. ${reason}`) };
}
