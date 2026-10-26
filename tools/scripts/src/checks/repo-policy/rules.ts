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

// The shell scripts of this repository: the thin wrappers in tools/scripts/sh/ (docs/adr/0024). The agent skills
// under .agents/ and .kiro/skills/ are upstream files and are not checked.
const shellScript = /^tools\/scripts\/sh\/[^/]+\.sh$/;
const shellScripts = (tree: Tree): string[] => tree.paths.filter((path) => shellScript.test(path));

// Scripts that create or point git at another repository (git init / clone, git -C, --git-dir, GIT_DIR=).
// Run from a Git hook, such a script inherits GIT_DIR and GIT_INDEX_FILE and acts on this repository instead
// (docs/tooling/ci.md ("スクリプトのテスト")). The shell wrappers only run git on the repository they run in.
// A test that needs another repository is TypeScript and goes through gitIn (tools/scripts/src/test/sandbox.ts).
// Shell scripts only: a text pattern misses execFileSync("git", ["-C", ...]), so in TypeScript the
// no-restricted-imports rule on child_process (root vite.config.ts) and isolation.test.ts guard the same
// thing (docs/adr/0024).
// The pattern is tested on each line, so that a match never spans two lines; `\s` would match a newline.
const otherRepoGit = /(^|[^A-Za-z0-9_-])git\s+(init|clone)(\s|$)|git\s+-C\s|--git-dir|GIT_DIR=/;

function gitOnOtherRepositories(tree: Tree): string[] {
  return shellScripts(tree)
    .filter((path) =>
      tree
        .read(path)
        .split("\n")
        .some((line) => otherRepoGit.test(line)),
    )
    .map(
      (path) =>
        `${path} runs git on another repository. A shell wrapper runs git only on the repository it runs in; write a test that needs another repository in TypeScript, with gitIn (docs/adr/0024).`,
    );
}

// The files outside tools/scripts that the test-tools target reads are inputs of the Nx target
// (tools/scripts/package.json), and also globs of the scripts-test-tools job of lefthook.yml, which runs the
// target before a commit that changes one of them. Written in two places, one is easily forgotten
// (docs/tooling/ci.md ("スクリプトのテスト")). The two lists are compared as strings: Nx and lefthook
// write globs differently, so a pattern cannot be matched against the other list.
const toolsInput = "{workspaceRoot}/";
// Inputs left out of the hook on purpose: the Knip and commitlint tests read them, and a commit
// that changes one of them must not start the slow tools tests. CI runs the target for every change
// (docs/tooling/git-hooks.md).
const notInHook: ReadonlySet<string> = new Set([
  ".github/workflows/*.{yml,yaml}",
  ".kiro/settings/mcp.json",
  "*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}",
  "lefthook.yml",
  "nx.json",
  "package.json",
  "pnpm-lock.yaml",
]);

function toolsInputsInHook(tree: Tree): string[] {
  const manifest = "tools/scripts/package.json";
  const target = record(record(record(tree.parsed(manifest)).nx).targets)["test-tools"];
  const inputs = record(target).inputs;
  // Stryker disable next-line ArrayDeclaration: equivalent, a non-string entry is filtered out below.
  const wanted = (Array.isArray(inputs) ? inputs : [])
    .filter((input): input is string => typeof input === "string" && input.startsWith(toolsInput))
    .map((input) => input.slice(toolsInput.length))
    .filter((input) => !notInHook.has(input));
  if (wanted.length === 0) return [];
  const jobs = record(record(tree.parsed("lefthook.yml"))["pre-commit"]).jobs;
  // Stryker disable next-line ArrayDeclaration: equivalent, record() turns a non-object entry into {}.
  const job = (Array.isArray(jobs) ? jobs : [])
    .map(record)
    .find((j) => j.name === "scripts-test-tools");
  if (job === undefined)
    return [
      "lefthook.yml has no scripts-test-tools job, which runs the test-tools target of tools/scripts.",
    ];
  const globs = Array.isArray(job.glob) ? job.glob : [job.glob];
  return wanted
    .filter((input) => !globs.includes(input))
    .map(
      (input) =>
        `${manifest}: the test-tools input ${toolsInput}${input} is not in the glob of the scripts-test-tools job of lefthook.yml. Add it there, or to notInHook in tools/scripts/src/checks/repo-policy/rules.ts with the reason.`,
    );
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

const ruleset = ".github/rulesets/protect-main.json";
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;
const rules = (tree: Tree): Record<string, unknown>[] =>
  list(record(tree.parsed(ruleset)).rules).map(record);
// The contexts of a required_status_checks rule. An entry without one is skipped.
const contexts = (rule: Record<string, unknown>): string[] =>
  list(record(rule.parameters).required_status_checks).flatMap(
    (check) => text(record(check).context) ?? [],
  );
const requiredChecks = (tree: Tree): string[] =>
  rules(tree)
    .filter((rule) => rule.type === "required_status_checks")
    .flatMap(contexts);

// Whether a workflow runs on pull_request. `on` is an event, a list of them, or a map with one key per event
// (GitHub Docs, workflow syntax, `on`).
const onPullRequest = (on: unknown): boolean =>
  on === "pull_request" ||
  list(on).includes("pull_request") ||
  (isRecord(on) && "pull_request" in on);

// Each required check is reported by a job of a workflow that runs on pull_request, or every pull request
// waits for it. GitHub names the check of a job by its `name`, or by its id when it has none.
function requiredChecksRun(tree: Tree): string[] {
  const jobs = new Set<string>();
  for (const path of tree.paths.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p))) {
    const workflow = record(tree.parsed(path));
    if (!onPullRequest(workflow.on)) continue;
    for (const [id, job] of Object.entries(record(workflow.jobs)))
      jobs.add(text(record(job).name) ?? id);
  }
  return requiredChecks(tree)
    .filter((check) => !jobs.has(check))
    .map(
      (check) =>
        `${ruleset} requires the check "${check}", but no job of a workflow that runs on pull_request has that name, so a pull request waits for it forever (docs/tooling/ci.md ("ci.yml の job")).`,
    );
}

// The assurance catalog: one row per sensor, named as the configs name it (docs/tooling/assurance-catalog.md).
// A sensor is written as a code span with the config it comes from:
//   `ci.yml: <step>`             a step of ci.yml that runs a command, outside the main job (main is the
//                                required check `main`, a sensor of the ruleset)
//   `ruleset: <rule>`            a rule of the ruleset by its type; a required check by its context, and a
//                                code scanning tool by its name
//   `lefthook: <hook>/<job>`     a job or command of lefthook.yml; the jobs of a group, not the group
//   `kiro: <hook>/<check>`       a check of a hook of .kiro/hooks/*.json. The checks are code inside the one
//                                entry point of the hook (docs/adr/0024), so only the hook is compared
// ci.yml and the ruleset are the gates: each of their sensors is a row of its own. lefthook and Kiro are local
// copies, so one of their sensors is either a row (when no gate has it) or named in the ローカルの写し
// column of the row it copies.
const catalog = "docs/tooling/assurance-catalog.md";
const columns = { sensor: "センサー", copies: "ローカルの写し", detection: "検出力の確かめ方" };
// Each source, and where its sensors are.
const sources = {
  "ci.yml": ".github/workflows/ci.yml",
  ruleset,
  lefthook: "lefthook.yml",
  kiro: "a hook of .kiro/hooks/*.json, written `kiro: <hook>/<check>`",
};
const isSensor = (span: string): boolean =>
  Object.keys(sources).some((source) => span.startsWith(`${source}: `));

const unnamed = (where: string): string => `${where} Name it, so that ${catalog} can list it.`;

interface Sensors {
  // The sensors of the configs. For Kiro, `kiro: <hook>`: a row names one of its checks.
  readonly gates: string[];
  readonly copies: string[];
  readonly problems: string[];
}

function configSensors(tree: Tree): Sensors {
  const gates: string[] = [];
  const copies: string[] = [];
  const problems: string[] = [];
  const ci = sources["ci.yml"];
  for (const [id, job] of Object.entries(record(record(tree.parsed(ci)).jobs))) {
    if (id === "main") continue;
    for (const step of list(record(job).steps).map(record)) {
      if (!("run" in step)) continue;
      const name = text(step.name);
      if (name === undefined)
        problems.push(unnamed(`${ci}: a step of the job \`${id}\` runs a command without a name.`));
      else gates.push(`ci.yml: ${name}`);
    }
  }
  for (const rule of rules(tree)) {
    if (rule.type === "required_status_checks")
      gates.push(...contexts(rule).map((check) => `ruleset: ${check}`));
    else if (rule.type === "code_scanning")
      for (const tool of list(record(rule.parameters).code_scanning_tools))
        gates.push(`ruleset: ${String(record(tool).tool)}`);
    else gates.push(`ruleset: ${String(rule.type)}`);
  }
  for (const [hook, value] of Object.entries(record(tree.parsed("lefthook.yml")))) {
    const jobs = (entries: unknown): void => {
      for (const job of list(entries).map(record)) {
        const name = text(job.name);
        if (isRecord(job.group)) jobs(job.group.jobs);
        else if (name === undefined)
          problems.push(unnamed(`lefthook.yml: a job of ${hook} has no name.`));
        else copies.push(`lefthook: ${hook}/${name}`);
      }
    };
    jobs(record(value).jobs);
    for (const command of Object.keys(record(record(value).commands)))
      copies.push(`lefthook: ${hook}/${command}`);
  }
  for (const path of tree.paths.filter((p) => /^\.kiro\/hooks\/[^/]+\.json$/.test(p)))
    for (const hook of list(record(tree.parsed(path)).hooks).map(record)) {
      const name = text(hook.name);
      if (name === undefined) problems.push(unnamed(`${path}: a hook has no name.`));
      else copies.push(`kiro: ${name}`);
    }
  return { gates, copies, problems };
}

// Whether the code span `named` of the catalog is the sensor `sensor` of the configs.
// A Kiro hook is named by one of its checks: `kiro: <hook>/<check>`.
const names = (named: string, sensor: string): boolean =>
  sensor.startsWith("kiro: ")
    ? named.startsWith(`${sensor}/`) && named.length > sensor.length + 1
    : named === sensor;

// The cells of a table row, split at the pipes that are not escaped as \| (GitHub Flavored Markdown,
// "Tables"). The header and the rows start with a pipe, so both have the same empty first cell.
const cells = (line: string): string[] => line.split(/(?<!\\)\|/).map((cell) => cell.trim());
// The sensors in a cell: its code spans, the odd pieces between backticks, that name a source.
const spans = (cell: string): string[] =>
  cell
    .split("`")
    .filter((_, index) => index % 2 === 1)
    .filter(isSensor);

interface Row {
  readonly sensor: string | undefined;
  readonly cell: string;
  readonly copies: string[];
  readonly detection: string;
}

// The rows of the first table that has the three columns, or undefined when the catalog has none.
function catalogRows(markdown: string): Row[] | undefined {
  const lines = markdown.split("\n");
  for (const [index, line] of lines.entries()) {
    const header = cells(line);
    const sensor = header.indexOf(columns.sensor);
    const copies = header.indexOf(columns.copies);
    const detection = header.indexOf(columns.detection);
    if (sensor === -1 || copies === -1 || detection === -1) continue;
    const rows: Row[] = [];
    // The line after the header is the delimiter row.
    for (const body of lines.slice(index + 2)) {
      if (!body.startsWith("|")) break;
      const row = cells(body);
      const cell = row[sensor] ?? "";
      const named = spans(cell);
      rows.push({
        sensor: named.length === 1 ? named[0] : undefined,
        cell,
        // Stryker disable next-line StringLiteral: equivalent, any text without a code span names no sensor.
        copies: spans(row[copies] ?? ""),
        detection: row[detection] ?? "",
      });
    }
    return rows;
  }
  return undefined;
}

// The catalog and the configs list the same sensors: no sensor without a row, no row for a sensor that is
// gone, one row per sensor, and every row says how its detection is verified (docs/tooling/ci.md
// ("検査を足すとき")).
function catalogMatchesConfigs(tree: Tree): string[] {
  const markdown = tree.repo.read(catalog);
  if (markdown === undefined)
    return [
      `${catalog} does not exist. It lists every sensor of the gates, and repo-policy compares it with the configs.`,
    ];
  const rows = catalogRows(markdown);
  if (rows === undefined)
    return [
      `${catalog} has no table with the columns ${columns.sensor}, ${columns.copies} and ${columns.detection}.`,
    ];
  const { gates, copies, problems } = configSensors(tree);
  const failures = [...problems];
  // The sensor of each row.
  // Stryker disable next-line ArrayDeclaration: equivalent, an entry that is not a sensor matches nothing.
  const keys: string[] = [];
  for (const row of rows) {
    if (row.sensor === undefined) {
      failures.push(
        `${catalog}: the row "${row.cell}" must name one sensor in its ${columns.sensor} column, such as \`ci.yml: Lint Markdown\`.`,
      );
      continue;
    }
    if (keys.includes(row.sensor))
      failures.push(`${catalog} has more than one row for \`${row.sensor}\`.`);
    keys.push(row.sensor);
    if (row.detection === "")
      failures.push(
        `${catalog}: the row for \`${row.sensor}\` must fill in ${columns.detection} (docs/tooling/ci.md ("検査を足すとき")).`,
      );
  }
  const named = new Set([...keys, ...rows.flatMap((row) => row.copies)]);
  // Without ci.yml, mainNeedsEveryJob reports it; its rows are not compared.
  const hasCi = tree.repo.read(sources["ci.yml"]) !== undefined;
  const sensors = [...gates, ...copies];
  for (const [source, where] of Object.entries(sources)) {
    if (source === "ci.yml" && !hasCi) continue;
    for (const span of named)
      if (span.startsWith(`${source}: `) && !sensors.some((sensor) => names(span, sensor)))
        failures.push(`${catalog} names \`${span}\`, which is not in ${where}.`);
  }
  for (const gate of gates)
    if (!keys.includes(gate))
      failures.push(`\`${gate}\` has no row in ${catalog}. A gate is a row of its own; add one.`);
  for (const copy of copies)
    if (![...named].some((span) => names(span, copy)))
      failures.push(
        copy.startsWith("kiro: ")
          ? `\`${copy}\` has no row in ${catalog}. Add a row \`${copy}/<check>\` for each check of the hook.`
          : `\`${copy}\` has no row in ${catalog}. Add a row for it, or name it in the ${columns.copies} column of the row it copies.`,
      );
  return failures;
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
// docs-check (tools/scripts/src/checks/docs-check/) only follows Markdown links inside docs/, so these plain-text paths are checked here:
//   a path to a Markdown file under docs/       the file must exist
//   the same path, then ("Heading")             the file must have a heading with that text (cited
//                                               without its number; \" in a JSON string counts as ")
//   docs/adr/ and a four-digit number           an ADR with that number must exist
// .agents/ and .kiro/skills/ hold upstream skills; docs/ itself is covered by docs-check. The tests and
// fixtures of adr-check and repo-policy cite missing ADRs on purpose.
const unchecked = [
  /^docs\//,
  /^\.agents\//,
  /^\.kiro\/skills\//,
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
    ...toolsInputsInHook(tree),
    ...uniqueAdrNumbers(tree),
    ...mainNeedsEveryJob(tree),
    ...requiredChecksRun(tree),
    ...catalogMatchesConfigs(tree),
    ...executableScripts(tree),
    ...docsReferences(tree),
  ];
  return [...tree.parseErrors, ...failures];
}
