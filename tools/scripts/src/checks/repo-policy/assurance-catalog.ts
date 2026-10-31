// Checks that the assurance catalog (docs/tooling/assurance-catalog.md) and the configs list the same checks.
import { contexts, rules, ruleset } from "./ci.ts";
import { Tree, isRecord, list, record, text } from "./tree.ts";

// The assurance catalog: one row per sensor or guardrail, named as the configs name it
// (docs/tooling/assurance-catalog.md). The 名前 column holds the name as a code span with its source:
//   `ci.yml: <step>`             a step of ci.yml that runs a command, outside the main job (main is the
//                                required check `main`, a name of the ruleset)
//   `ruleset: <rule>`            a rule of the ruleset by its type; a required check by its context, and a
//                                code scanning tool by its name
//   `lefthook: <hook>/<job>`     a job or command of lefthook.yml; the jobs of a group, not the group
//   `kiro: <hook>/<check>`       a check that a hook of .kiro/hooks/*.json runs. The hook has one entry
//                                point that runs its checks in code (docs/adr/0024); each check is a file of
//                                tools/scripts/src/hooks/ whose first line starts with its name
//   `kiro-agent: <name>`         an agent of .kiro/agents/<name>.json; its permission rules are the table of
//                                docs/tooling/agent-permissions.md
// ci.yml and the ruleset are the gates: each of their names is a row of its own. A lefthook job is a local
// copy: a row of its own when no gate has it, or named in the ローカルの写し column of the row it copies.
// Every name is in the catalog once.
const catalog = "docs/tooling/assurance-catalog.md";

const columns = { name: "名前", copies: "ローカルの写し", detection: "検出力の確かめ方" };

// The sources of the names, and where their names are.
const sources = {
  "ci.yml": ".github/workflows/ci.yml",
  ruleset,
  lefthook: "lefthook.yml",
  kiro: "a hook of .kiro/hooks/*.json and a check of tools/scripts/src/hooks/, written `kiro: <hook>/<check>`",
  "kiro-agent": "an agent of .kiro/agents/<name>.json",
};

const isName = (span: string): boolean =>
  Object.keys(sources).some((source) => span.startsWith(`${source}: `));

const unnamed = (where: string): string => `${where} Name it, so that ${catalog} can list it.`;

// A check of the Kiro hooks: its name and the file that holds it.
interface KiroCheck {
  readonly name: string;
  readonly path: string;
}

// The names of the configs.
interface Configs {
  // ci.yml and the ruleset, as `ci.yml: <step>` and `ruleset: <rule>`.
  readonly gates: string[];
  // lefthook.yml, as `lefthook: <hook>/<job>`.
  readonly copies: string[];
  // The hooks of .kiro/hooks/*.json, and the checks they run.
  readonly hooks: string[];
  readonly checks: KiroCheck[];
  // The agents of .kiro/agents/*.json, as `kiro-agent: <name>`.
  readonly agents: string[];
  readonly problems: string[];
}

const hookFile = /^\.kiro\/hooks\/[^/]+\.json$/;

const checkFile = /^tools\/scripts\/src\/hooks\/[^/]+\.ts$/;

const checkName = /^\/\/ ((?:block|warn|ask)-[a-z-]+): /;

export const agentFile = /^\.kiro\/agents\/([^/]+)\.json$/;

export function configNames(tree: Tree): Configs {
  const gates: string[] = [];
  const copies: string[] = [];
  const hooks: string[] = [];
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
    const addJobs = (entries: unknown): void => {
      for (const job of list(entries).map(record)) {
        const name = text(job.name);
        if (isRecord(job.group)) addJobs(job.group.jobs);
        else if (name === undefined)
          problems.push(unnamed(`lefthook.yml: a job of ${hook} has no name.`));
        else copies.push(`lefthook: ${hook}/${name}`);
      }
    };
    addJobs(record(value).jobs);
    for (const command of Object.keys(record(record(value).commands)))
      copies.push(`lefthook: ${hook}/${command}`);
  }
  for (const path of tree.paths.filter((p) => hookFile.test(p)))
    for (const hook of list(record(tree.parsed(path)).hooks).map(record)) {
      const name = text(hook.name);
      if (name === undefined) problems.push(unnamed(`${path}: a hook has no name.`));
      else hooks.push(name);
    }
  const checks = tree.paths
    .filter((path) => checkFile.test(path) && !path.endsWith(".test.ts"))
    .flatMap((path) => {
      const name = checkName.exec(tree.read(path))?.[1];
      return name === undefined ? [] : [{ name, path }];
    });
  const agents = tree.paths.flatMap((path) => {
    const name = agentFile.exec(path)?.[1];
    return name === undefined ? [] : [`kiro-agent: ${name}`];
  });
  return { gates, copies, hooks, checks, agents, problems };
}

// Whether the configs have the name `span` of the catalog.
function inConfigs(span: string, configs: Configs): boolean {
  if (span.startsWith("kiro-agent: ")) return configs.agents.includes(span);
  if (!span.startsWith("kiro: ")) return [...configs.gates, ...configs.copies].includes(span);
  const [hook, check] = span.slice("kiro: ".length).split("/");
  return configs.hooks.includes(String(hook)) && configs.checks.some((c) => c.name === check);
}

// The cells of a table row, split at the pipes that are not escaped as \| (GitHub Flavored Markdown,
// "Tables"). The header and the rows start with a pipe, so both have the same empty first cell.
export const cells = (line: string): string[] => line.split(/(?<!\\)\|/).map((cell) => cell.trim());

// The names in a cell: its code spans, the odd pieces between backticks, that start with a source.
const spans = (cell: string): string[] =>
  cell
    .split("`")
    .filter((_, index) => index % 2 === 1)
    .filter(isName);

interface Row {
  readonly name: string | undefined;
  readonly cell: string;
  readonly copies: string[];
  readonly detection: string;
}

// The rows of the first table that has the three columns, or undefined when the catalog has none.
function catalogRows(markdown: string): Row[] | undefined {
  const lines = markdown.split("\n");
  for (const [index, line] of lines.entries()) {
    const header = cells(line);
    const name = header.indexOf(columns.name);
    const copies = header.indexOf(columns.copies);
    const detection = header.indexOf(columns.detection);
    if (name === -1 || copies === -1 || detection === -1) continue;
    const rows: Row[] = [];
    // The line after the header is the delimiter row.
    for (const body of lines.slice(index + 2)) {
      if (!body.startsWith("|")) break;
      const row = cells(body);
      const cell = row[name] ?? "";
      const named = spans(cell);
      rows.push({
        name: named.length === 1 ? named[0] : undefined,
        cell,
        // Stryker disable next-line StringLiteral: equivalent, any text without a code span names nothing.
        copies: spans(row[copies] ?? ""),
        detection: row[detection] ?? "",
      });
    }
    return rows;
  }
  return undefined;
}

// The catalog and the configs have the same names: none without a row, no row for a name that is gone, each
// name once, and every row says how its detection is verified (docs/tooling/ci.md ("検査を足すとき")).
export function catalogMatchesConfigs(tree: Tree): string[] {
  const markdown = tree.maybe(catalog);
  if (markdown === undefined)
    return [
      `${catalog} does not exist. It lists every sensor of the gates, and repo-policy compares it with the configs.`,
    ];
  const rows = catalogRows(markdown);
  if (rows === undefined)
    return [
      `${catalog} has no table with the columns ${columns.name}, ${columns.copies} and ${columns.detection}.`,
    ];
  const configs = configNames(tree);
  const failures = [...configs.problems];
  for (const row of rows)
    if (row.name === undefined)
      failures.push(
        `${catalog}: the row "${row.cell}" must have one name in its ${columns.name} column, such as \`ci.yml: Lint Markdown\`.`,
      );
    else if (row.detection === "")
      failures.push(
        `${catalog}: the row for \`${row.name}\` must fill in ${columns.detection} (docs/tooling/ci.md ("検査を足すとき")).`,
      );
  const keys = rows.map((row) => row.name).filter((name) => name !== undefined);
  const all = [...keys, ...rows.flatMap((row) => row.copies)];
  const named = new Set(all);
  for (const span of named)
    if (all.indexOf(span) !== all.lastIndexOf(span))
      failures.push(
        `${catalog} names \`${span}\` more than once. Each sensor has one row, and each local copy is named in one row.`,
      );
  // Without ci.yml, mainNeedsEveryJob reports it; its rows are not compared.
  const hasCi = tree.maybe(sources["ci.yml"]) !== undefined;
  for (const [source, where] of Object.entries(sources)) {
    if (source === "ci.yml" && !hasCi) continue;
    for (const span of named)
      if (span.startsWith(`${source}: `) && !inConfigs(span, configs))
        failures.push(`${catalog} names \`${span}\`, which is not in ${where}.`);
  }
  for (const gate of configs.gates)
    if (!keys.includes(gate))
      failures.push(`\`${gate}\` has no row in ${catalog}. A gate is a row of its own; add one.`);
  for (const copy of configs.copies)
    if (!named.has(copy))
      failures.push(
        `\`${copy}\` has no row in ${catalog}. Add a row for it, or name it in the ${columns.copies} column of the row it copies.`,
      );
  for (const agent of configs.agents)
    if (!keys.includes(agent))
      failures.push(`\`${agent}\` has no row in ${catalog}. Add a row for the agent.`);
  const kiro = [...named].filter((span) => span.startsWith("kiro: "));
  for (const hook of configs.hooks)
    if (!kiro.some((span) => span.startsWith(`kiro: ${hook}/`)))
      failures.push(
        `\`kiro: ${hook}\` has no row in ${catalog}. Add a row \`kiro: ${hook}/<check>\` for each check of the hook.`,
      );
  for (const check of configs.checks)
    if (!kiro.some((span) => span.endsWith(`/${check.name}`)))
      failures.push(
        `\`${check.name}\` (${check.path}) has no row in ${catalog}. Add a row \`kiro: <hook>/${check.name}\` for the hook that runs it.`,
      );
  return failures;
}
