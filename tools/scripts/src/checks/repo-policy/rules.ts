// The rules of repo-policy: mechanical checks for the decisions recorded in docs/adr/.
// Pure functions over a Repo; cli.ts reads git and the files (of the working tree, or of the index) into it.
// Configuration files are read with parsers (yaml, smol-toml, JSON.parse), so quoting, comments and line
// breaks do not change the values the checks read; steering's fileMatchPattern must still be a one-line array.
// vite.config.ts is read as text: #136 (item 8) decided it needs no parser, since the
// fixtures planned in #43 are to check its lint rules.
import { parse as parseToml } from "smol-toml";
import { isSeq, parseDocument } from "yaml";

// The tree being checked.
export interface Repo {
  // Every path in the index (`git ls-files -s`), with its mode: 100644, 100755, 120000 ...
  readonly tracked: ReadonlyMap<string, string>;
  // Steering files that are untracked and not ignored. Kiro loads them too.
  readonly untrackedSteering: readonly string[];
  // Whether the working tree has a .vite-hooks directory (`vp` creates it without staging it).
  readonly viteHooks: boolean;
  // The text of a file of the tree, or undefined when the tree has no such file.
  read(path: string): string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
// The first line of an error, without the colon that introduces the code excerpt (yaml, smol-toml).
const firstLine = (error: unknown): string =>
  String(error)
    .replace(/\n[^]*/, "")
    .replace(/:$/, "");

// The parser for a file, by its extension. Each returns the value, or throws with the reason the text is
// not valid.
function parser(path: string): [string, (text: string) => unknown] {
  if (path.endsWith(".json"))
    return [
      "JSON",
      (text) => {
        const value: unknown = JSON.parse(text);
        return value;
      },
    ];
  if (path.endsWith(".toml")) return ["TOML", (text) => parseToml(text)];
  return [
    "YAML",
    (text) => {
      const document = parseDocument(text);
      const [error] = document.errors;
      if (error !== undefined) throw error;
      const value: unknown = document.toJS();
      return value;
    },
  ];
}

// The repository with the parsed files. A file that does not parse is reported once and read as empty.
class Tree {
  readonly repo: Repo;
  readonly paths: readonly string[];
  readonly parseErrors: string[] = [];
  readonly #parsed = new Map<string, unknown>();

  constructor(repo: Repo) {
    this.repo = repo;
    this.paths = [...repo.tracked.keys()].sort();
  }

  // A file the tree does not have reads as empty. No rule matches an empty text or any other text
  // without the pattern, so the fallback text is not tested.
  read(path: string): string {
    // Stryker disable next-line StringLiteral: equivalent, see above.
    return this.repo.read(path) ?? "";
  }

  // The tracked files with this name, at the root or at any depth.
  named(name: string): string[] {
    return this.paths.filter((path) => path === name || path.endsWith(`/${name}`));
  }

  // The parsed JSON, TOML or YAML file; undefined when the tree has no such file or it does not parse.
  parsed(path: string): unknown {
    if (this.#parsed.has(path)) return this.#parsed.get(path);
    const text = this.repo.read(path);
    const [format, parse] = parser(path);
    let value: unknown;
    try {
      value = text === undefined ? undefined : parse(text);
    } catch (error) {
      this.parseErrors.push(`${path} is not valid ${format} (${firstLine(error)})`);
    }
    this.#parsed.set(path, value);
    return value;
  }
}

// Whether `key` is a key of the value or of anything in it, at any depth.
const hasKey = (value: unknown, key: string): boolean =>
  Array.isArray(value)
    ? value.some((child) => hasKey(child, key))
    : isRecord(value) && (key in value || Object.values(value).some((child) => hasKey(child, key)));

// ADR 0002: Nx runs tasks; Vite+ is toolchain only.
// @nx/vite anywhere in a package.json counts: the dependencies, and also overrides, resolutions and
// pnpm.overrides.
function nxRunsTasks(tree: Tree): string[] {
  const failures: string[] = [];
  for (const manifest of tree.named("package.json"))
    if (hasKey(tree.parsed(manifest), "@nx/vite"))
      failures.push(
        `${manifest} depends on @nx/vite. Targets come from package.json scripts (docs/adr/0002).`,
      );
  // A `run` key two spaces in: a key of the object passed to defineConfig. This repository formats
  // vite.config.ts with vp fmt (Oxfmt) and sets no indentation, so it indents by Oxfmt's default of two
  // spaces (Oxfmt config file reference, `tabWidth`, `useTabs`).
  for (const config of tree.named("vite.config.ts"))
    if (/^ {2}run\s*:/m.test(tree.read(config)))
      failures.push(
        `${config} has a \`run\` block. Task running and caching belong to Nx (docs/adr/0002).`,
      );
  return failures;
}

// ADR 0001: lefthook owns Git hooks.
function lefthookOwnsHooks(tree: Tree): string[] {
  return tree.repo.viteHooks || tree.paths.some((path) => path.startsWith(".vite-hooks/"))
    ? [".vite-hooks exists. Git hooks are managed by lefthook.yml (docs/adr/0001)."]
    : [];
}

// ADR 0003, 0009: one betterleaks version, pinned in mise.toml.
function oneBetterleaks(tree: Tree): string[] {
  const version = record(record(tree.parsed("mise.toml")).tools).betterleaks;
  if (typeof version !== "string")
    return ["mise.toml must pin betterleaks to an exact version (docs/adr/0009)."];
  const minimum = record(tree.parsed(".betterleaks.toml")).betterleaksMinVersion;
  return minimum === version
    ? []
    : [
        `.betterleaks.toml betterleaksMinVersion must equal the betterleaks version in mise.toml (${version}).`,
      ];
}

// ADR 0007: apps/api/src uses Web standard APIs only, enforced by lint.overrides in vite.config.ts.
// The severity is the value of the rule (`"rule": "error"`) or the first element of its array.
function webStandardApis(tree: Tree): string[] {
  const config = tree.read("vite.config.ts");
  return ["import/no-nodejs-modules", "no-restricted-imports", "no-restricted-globals"]
    .filter((rule) => !new RegExp(`"${rule}":\\s*\\[?\\s*"error"`).test(config))
    .map((rule) => `vite.config.ts must set ${rule} to error for apps/api/src (docs/adr/0007).`);
}

const inclusions: ReadonlySet<unknown> = new Set(["always", "fileMatch", "manual", "auto"]);

// The problems of one steering file. Malformed frontmatter is silently loaded as `always`.
function steeringProblems(path: string, text: string): string[] {
  const lines = text.split("\n");
  if (lines[0] !== "---") return ["must start with a frontmatter block"];
  const end = lines.indexOf("---", 1);
  if (end === -1) return ["frontmatter is not closed"];
  const document = parseDocument(lines.slice(1, end).join("\n"));
  const [error] = document.errors;
  // The position yaml gives counts from the line after the first `---`, so it is left out.
  if (error !== undefined)
    return [`frontmatter is not valid YAML (${error.message.split(" at line ")[0]})`];
  const inclusion = document.get("inclusion");
  const name = path.slice(path.lastIndexOf("/") + 1, -".md".length);
  const description = document.get("description");
  // A sequence comes back as its node, so that `flow` tells a one-line array from a block list.
  const pattern = document.get("fileMatchPattern");
  const problems: string[] = [];
  if (!inclusions.has(inclusion))
    problems.push("inclusion must be always, fileMatch, manual or auto");
  if (document.get("name") !== name) problems.push(`name must be "${name}"`);
  if (typeof description !== "string" || description.trim() === "")
    problems.push("description is required");
  if (inclusion === "fileMatch" && pattern === undefined)
    problems.push("fileMatchPattern is required for inclusion: fileMatch");
  if (inclusion !== "fileMatch" && pattern !== undefined)
    problems.push("fileMatchPattern is only for inclusion: fileMatch");
  if (pattern !== undefined && !(isSeq(pattern) && pattern.flow === true))
    problems.push("fileMatchPattern must be a one-line array");
  return problems;
}

// The paths the pathspec .kiro/steering/*.md matches, as cli.ts asks git for the untracked ones. A pathspec
// matches with fnmatch(3) without FNM_PATHNAME, so its * matches / too (gitglossary(7), "pathspec").
const isSteering = (path: string): boolean =>
  path.startsWith(".kiro/steering/") && path.endsWith(".md");

// docs/knowledge/steering-authoring.md: steering frontmatter.
function steeringFrontmatter(tree: Tree): string[] {
  const files = [...tree.paths.filter(isSteering), ...tree.repo.untrackedSteering];
  return files.flatMap((path) =>
    steeringProblems(path, tree.read(path)).map(
      (problem) => `${path}: ${problem} (docs/knowledge/steering-authoring.md)`,
    ),
  );
}

// Scripts that create or point git at another repository (git init / clone, git -C, --git-dir, GIT_DIR=).
// Run from a Git hook, such a script inherits GIT_DIR and GIT_INDEX_FILE and acts on this repository instead
// (docs/tooling/ci.md ("スクリプトのテスト")). Only sh tests isolated by scripts/test/lib.sh may do this.
// Shell scripts only: a text pattern misses execFileSync("git", ["-C", ...]), so in TypeScript the
// no-restricted-imports rule on child_process (root vite.config.ts) and isolation.test.ts guard the same
// thing (docs/adr/0024).
// The pattern is tested on each line, so that a match never spans two lines; `\s` would match a newline.
const otherRepoGit = /(^|[^A-Za-z0-9_-])git\s+(init|clone)(\s|$)|git\s+-C\s|--git-dir|GIT_DIR=/;
// The start of a line only: a comment or a carriage return may follow.
const sourcesLib = /^\. "\$\(dirname "\$0"\)\/lib\.sh"/m;
const shTest = /^scripts\/test\/[^/]+\.test\.sh$/;
const upstream = (path: string): boolean =>
  path.startsWith(".agents/") || path.startsWith(".kiro/skills/");
const shellScripts = (tree: Tree): string[] =>
  tree.paths.filter((path) => path.endsWith(".sh") && !upstream(path));

function gitOnOtherRepositories(tree: Tree): string[] {
  const failures: string[] = [];
  for (const path of shellScripts(tree)) {
    if (path === "scripts/test/lib.sh") continue;
    const text = tree.read(path);
    if (!text.split("\n").some((line) => otherRepoGit.test(line))) continue;
    if (!shTest.test(path))
      failures.push(
        `${path} runs git on another repository. Move that code into a scripts/test/*.test.sh that sources lib.sh, or run git only on this repository.`,
      );
    else if (!sourcesLib.test(text))
      failures.push(
        `${path} runs git on another repository but does not source scripts/test/lib.sh.`,
      );
  }
  return failures;
}

// The first number of a version or a range: 24 in "v24.1.2", ">=24" and "^24".
const major = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number"
    ? /[0-9]+/.exec(String(value))?.[0]
    : undefined;

// ADR 0013: one Node.js major version. .node-version decides it; the places that repeat it must agree.
// A change of the major otherwise leaves a stale copy behind (the API build target, the type definitions).
// The version is on the first line that starts with one; blank and comment lines before it are skipped.
function oneNodeMajor(tree: Tree): string[] {
  const node = /^v?([0-9]+)/m.exec(tree.read(".node-version"))?.[1];
  if (node === undefined)
    return [
      ".node-version must start with a Node.js version such as 24 or 24.22.1 (docs/adr/0013).",
    ];
  const failures: string[] = [];
  const engines = major(record(record(tree.parsed("package.json")).engines).node);
  if (engines !== node)
    failures.push(
      `package.json engines.node (${engines ?? "unreadable"}) must be Node.js ${node}, the major of .node-version (docs/adr/0013).`,
    );
  const catalog = record(record(tree.parsed("pnpm-workspace.yaml")).catalog);
  const types = major(catalog["@types/node"]);
  if (types !== node)
    failures.push(
      `pnpm-workspace.yaml catalog @types/node (${types ?? "unreadable"}) must be Node.js ${node}, the major of .node-version (docs/adr/0013).`,
    );
  for (const config of tree.named("vite.config.ts"))
    for (const [, target] of tree.read(config).matchAll(/target:\s*"node([0-9]+)"/g))
      if (target !== node)
        failures.push(
          `${config} builds for node${target}, but .node-version is Node.js ${node} (docs/adr/0013).`,
        );
  return failures;
}

// ADR numbers are unique. Two branches can each take the next free number, and both ADRs can reach main
// without a merge conflict (docs/tooling/worktrees.md ("PR を出す")).
function uniqueAdrNumbers(tree: Tree): string[] {
  const byNumber = new Map<string, string[]>();
  for (const path of tree.paths) {
    const number = /^docs\/adr\/([0-9]{4})-[^/]*\.md$/.exec(path)?.[1];
    if (number !== undefined) byNumber.set(number, [...(byNumber.get(number) ?? []), path]);
  }
  return [...byNumber]
    .filter(([, files]) => files.length > 1)
    .map(([number, files]) => `ADR ${number} is used by more than one file: ${files.join(" ")}`);
}

// Every string under a `run` key, at any depth: the steps of a workflow, the jobs and commands of lefthook.yml.
function runs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(runs);
  return Object.entries(record(value)).flatMap(([key, child]) =>
    key === "run" && typeof child === "string" ? [child] : runs(child),
  );
}

const workflow = /^\.github\/workflows\/[^/]+\.ya?ml$/;

// sh tests are listed by hand in the workflows and in lefthook.yml (docs/tooling/ci.md ("スクリプトのテスト")).
// A new test that is in neither list never runs. Only a `run` counts: not a comment, a name or a glob.
function listedShTests(tree: Tree): string[] {
  const inWorkflows = tree.paths
    .filter((path) => workflow.test(path))
    .flatMap((path) => runs(tree.parsed(path)));
  const inHook = runs(tree.parsed("lefthook.yml"));
  const failures: string[] = [];
  for (const test of tree.paths.filter((path) => shTest.test(path))) {
    if (!inWorkflows.some((run) => run.includes(test)))
      failures.push(
        `${test} is not run by any workflow. Add it to the Script tests step of .github/workflows/ci.yml.`,
      );
    if (!inHook.some((run) => run.includes(test)))
      failures.push(`${test} is not run by the pre-commit hook. Add a job for it to lefthook.yml.`);
  }
  return failures;
}

// `main` in ci.yml is the required status check (.github/rulesets/protect-main.json) and collects the other jobs.
// A job that `main` does not need can fail without blocking a merge (docs/tooling/ci.md ("ci.yml の検証")).
// `needs` is a job id or a list of them (GitHub Docs, workflow syntax, `jobs.<job_id>.needs`).
function mainNeedsEveryJob(tree: Tree): string[] {
  const ci = ".github/workflows/ci.yml";
  if (tree.repo.read(ci) === undefined)
    return [
      `${ci} does not exist. Its main job is the required status check (docs/tooling/ci.md ("ci.yml の検証")).`,
    ];
  const jobs = record(record(tree.parsed(ci)).jobs);
  const needs = record(jobs.main).needs;
  const needed = new Set(Array.isArray(needs) ? needs : [needs]);
  return Object.keys(jobs)
    .filter((job) => job !== "main" && !needed.has(job))
    .map(
      (job) =>
        `${ci}: the main job must list \`${job}\` in its needs, or a failure of \`${job}\` will not block a merge (docs/tooling/ci.md ("ci.yml の検証")).`,
    );
}

// Hooks, CI and the tests run shell scripts directly, so git must record them as executable (100755).
function executableScripts(tree: Tree): string[] {
  return shellScripts(tree)
    .filter((path) => tree.repo.tracked.get(path) !== "100755")
    .map(
      (path) => `${path} is not executable in git. Run \`chmod +x ${path}\` and stage it again.`,
    );
}

// References to docs/ from outside docs/ (scripts, configs, AGENTS.md, steering, workflows).
// docs-check.sh only follows Markdown links inside docs/, so these plain-text paths are checked here:
//   a path to a Markdown file under docs/       the file must exist
//   the same path, then ("Heading")             the file must have a heading with that text (cited
//                                               without its number; \" in a JSON string counts as ")
//   docs/adr/ and a four-digit number           an ADR with that number must exist
// .agents/ and .kiro/skills/ hold upstream skills; docs/ itself is covered by docs-check.sh. The sh tests
// (scripts/test/) and the tests and fixtures of adr-check and repo-policy cite missing ADRs on purpose.
const unchecked = [
  /^docs\//,
  /^\.agents\//,
  /^\.kiro\/skills\//,
  /^scripts\/test\//,
  /^tools\/scripts\/src\/checks\/(adr-check|repo-policy)\/([^/]*\.test\.ts$|fixtures\/)/,
  /^pnpm-lock\.yaml$/,
];
const docsReference =
  /(?<![A-Za-z0-9_./-])docs\/(?:([A-Za-z0-9_./-]+\.md)(?: \(\\?"([^"\\]+)\\?"\))?|adr\/([0-9]{4})(?![0-9-]))/g;

const hasHeading = (text: string, heading: string): boolean =>
  text.split("\n").some((line) => {
    const title = /^#+ (.*)/.exec(line)?.[1];
    return title === heading || title?.replace(/^[0-9]+\. /, "") === heading;
  });

function docsReferences(tree: Tree): string[] {
  const failures: string[] = [];
  for (const source of tree.paths) {
    if (unchecked.some((pattern) => pattern.test(source))) continue;
    const text = tree.read(source);
    if (text.includes("\0")) continue;
    for (const [, file, heading, number] of text.matchAll(docsReference)) {
      if (number !== undefined) {
        if (
          !tree.paths.some((path) => path.startsWith(`docs/adr/${number}-`) && path.endsWith(".md"))
        )
          failures.push(`${source} cites docs/adr/${number}, which does not exist.`);
        continue;
      }
      const path = `docs/${file}`;
      const target = tree.repo.read(path);
      if (target === undefined) failures.push(`${source} cites ${path}, which does not exist.`);
      else if (heading !== undefined && !hasHeading(target, heading))
        failures.push(
          `${source} cites the heading "${heading}" in ${path}, which has no such heading.`,
        );
    }
  }
  return failures;
}

// Every failure: the files that do not parse, then the checks in order.
export function violations(repo: Repo): string[] {
  const tree = new Tree(repo);
  const failures = [
    ...nxRunsTasks(tree),
    ...lefthookOwnsHooks(tree),
    ...oneBetterleaks(tree),
    ...webStandardApis(tree),
    ...steeringFrontmatter(tree),
    ...gitOnOtherRepositories(tree),
    ...oneNodeMajor(tree),
    ...uniqueAdrNumbers(tree),
    ...listedShTests(tree),
    ...mainNeedsEveryJob(tree),
    ...executableScripts(tree),
    ...docsReferences(tree),
  ];
  return [...tree.parseErrors, ...failures];
}
