// The rules of adr-check (docs/adr/0016): which changes warn, and what the warning says.
// Pure functions; cli.ts reads git, stdin and the environment and prints what these return.

// Tests and fixtures are never decisions, at the root or at any depth, whatever their file name.
const testOrFixture = /(^|\/)(test|tests|__tests__|fixtures|__fixtures__)\/|\.(test|spec)\./;

// The one list of files whose change usually records a decision: dependencies, tool settings, workflows,
// the ruleset, Kiro hooks and settings.
const decisionFiles = new Set([
  "pnpm-workspace.yaml",
  "mise.toml",
  "nx.json",
  "lefthook.yml",
  "commitlint.config.ts",
  ".node-version",
  ".betterleaks.toml",
  ".jscpd.json",
  ".markdownlint-cli2.yaml",
]);
const decisionAnyDepth = new Set(["package.json", "vite.config.ts"]);
const decisionDirectories = [
  ".github/workflows/",
  ".github/rulesets/",
  ".kiro/hooks/",
  ".kiro/settings/",
];

export function isDecisionPath(path: string): boolean {
  if (testOrFixture.test(path)) return false;
  const name = path.slice(path.lastIndexOf("/") + 1);
  return (
    decisionFiles.has(path) ||
    decisionAnyDepth.has(name) ||
    decisionDirectories.some((directory) => path.startsWith(directory))
  );
}

// Git passes "<local ref> <local object name> <remote ref> <remote object name>" per ref to pre-push
// (githooks(5)). The local object name of a deleted ref is all zeros: nothing to compare.
export function pushedTips(stdin: string): string[] {
  return stdin
    .split("\n")
    .map((line) => line.split(" ")[1] ?? "")
    .filter((sha) => /[^0]/.test(sha));
}

const addedAdr = /^docs\/adr\/[0-9]{4}-.*\.md$/;

// The decision files to warn about, sorted. Each element is the `git diff --name-status --no-renames`
// output from the merge base to one pushed commit. Each commit is judged on its own: an ADR added on
// one ref does not cover another. Only an added ADR counts; editing an existing one does not.
export function warnedPaths(diffs: readonly string[]): string[] {
  const warned = new Set<string>();
  for (const diff of diffs) {
    const changes = diff.split("\n").map((line) => {
      const tab = line.indexOf("\t");
      return { status: line.slice(0, tab), path: line.slice(tab + 1) };
    });
    if (changes.some(({ status, path }) => status === "A" && addedAdr.test(path))) continue;
    for (const { path } of changes) if (isDecisionPath(path)) warned.add(path);
  }
  return [...warned].sort();
}

// The environment variables the messages read. GITHUB_ACTIONS is "true" in GitHub Actions.
export interface Env {
  readonly GITHUB_ACTIONS?: string | undefined;
  readonly GITHUB_SERVER_URL?: string | undefined;
  readonly GITHUB_REPOSITORY?: string | undefined;
}

export interface Output {
  readonly stdout: string;
  readonly stderr: string;
}

const inCi = (env: Env): boolean => env.GITHUB_ACTIONS === "true";
const lines = (...text: string[]): string => text.map((line) => `${line}\n`).join("");
// A workflow command ends at a newline, and % starts an escape (Workflow commands for GitHub Actions).
export const annotationText = (text: string): string =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

export function warning(paths: readonly string[], env: Env): Output {
  const header =
    "touches files that often record a decision, and adds no ADR (docs/adr/NNNN-*.md):";
  const list = paths.map((path) => `  - ${path}`);
  if (inCi(env)) {
    const server = env.GITHUB_SERVER_URL ?? "https://github.com";
    const repository = env.GITHUB_REPOSITORY ?? "yokozi-jp/agent-software-factory";
    const guideUrl = `${server}/${repository}/blob/main/docs/knowledge/documentation-authoring.md#adr-を書くかどうか`;
    const annotation = `Changed files that often record a decision, with no ADR added: ${paths.join(", ")}.`;
    return {
      stdout: lines(
        `This change ${header}`,
        ...list,
        `Whether to write an ADR: ${guideUrl}`,
        `::warning title=adr-check::${annotationText(annotation)} Whether to write an ADR: ${guideUrl}`,
      ),
      stderr: "",
    };
  }
  const guide = 'docs/knowledge/documentation-authoring.md ("ADR を書くかどうか")';
  return {
    stdout: "",
    stderr: lines(
      `adr-check: warning: this change ${header}`,
      ...list,
      `Write an ADR if the decision is hard to reverse, surprising without context, and a real trade-off. See ${guide}.`,
      "If this change needs no ADR, silence the warning with ADR_ACK=1 (for example: ADR_ACK=1 git push).",
    ),
  };
}

// When the base cannot be compared, adr-check says why and passes (docs/adr/0016).
export function skipped(reason: string, env: Env): Output {
  if (inCi(env))
    return {
      stdout: lines(`::notice title=adr-check::skipped. ${annotationText(reason)}`),
      stderr: "",
    };
  return { stdout: "", stderr: lines(`adr-check: skipped. ${reason}`) };
}
