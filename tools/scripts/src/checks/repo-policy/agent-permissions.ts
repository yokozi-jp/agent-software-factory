// Checks of the permission rules of the agents (docs/tooling/agent-permissions.md).
import { agentFile, cells, configNames } from "./assurance-catalog.ts";
import { Tree, list, record } from "./tree.ts";

// The permissions of the agents (docs/tooling/agent-permissions.md). Kiro 2.34.0 skips a rule whose
// capability it does not know without a word (the log has "Skipping rule"), and `kiro-cli agent validate`
// exits 0 for an invalid agent, so the rules are read here.
const permissionsDoc = "docs/tooling/agent-permissions.md";

const externalDocs = "docs/tooling/external-docs.md";

const settingsFile = ".kiro/settings/cli.json";

const capabilities = new Set([
  "all",
  "builtin",
  "filesystem",
  "fs_read",
  "fs_write",
  "shell",
  "web_fetch",
  "web_search",
  "mcp",
  "subagent",
  "skill",
  "power",
  "context",
  "diagnostics",
  "workflow",
  "sandbox_network",
]);

const effects = new Set(["allow", "deny", "ask", "evaluate"]);

const ruleFields = new Set(["capability", "effect", "match", "exclude"]);

// An allow that ends with * lets extra arguments through. For each command, the words that a deny of the
// same command must contain (docs/tooling/agent-permissions.md ("許可と禁止の組")).
const forbiddenArguments: Readonly<Record<string, readonly string[]>> = {
  "git push": ["main", "--no-verify", "--delete", "--force", "+", " -f"],
  "git commit": ["--no-verify"],
};

interface AgentRule {
  readonly capability: string;
  readonly effect: string;
  readonly match: readonly string[];
}

// The rules of an agent that are well formed; the others are reported.
function agentRules(path: string, agent: Record<string, unknown>, failures: string[]): AgentRule[] {
  // Stryker disable next-line ArrayDeclaration: an entry that is not a rule has no capability, and no check reads it.
  const found: AgentRule[] = [];
  if (!list(agent.tools).includes("*"))
    failures.push(
      `${path} must have "tools": ["*"]. An agent without tools can use none (docs/tooling/agent-permissions.md).`,
    );
  for (const [index, entry] of list(record(agent.permissions).rules).entries()) {
    const rule = record(entry);
    const where = `${path}: rule ${index}`;
    const capability = String(rule.capability);
    const effect = String(rule.effect);
    const unknown = Object.keys(rule).filter((key) => !ruleFields.has(key));
    const strings = (value: unknown): boolean =>
      value === undefined ||
      (Array.isArray(value) && value.every((item) => typeof item === "string"));
    const match = list(rule.match);
    const wellFormed = !unknown.length && strings(rule.match) && strings(rule.exclude);
    if (!capabilities.has(capability))
      failures.push(
        `${where} has the capability "${capability}", which Kiro does not know. It skips such a rule without a word. Known: ${[...capabilities].join(", ")}.`,
      );
    else if (!effects.has(effect))
      failures.push(`${where} has the effect "${effect}". Use allow, deny, ask or evaluate.`);
    else if (!wellFormed)
      failures.push(
        `${where} has fields Kiro rejects. A rule has capability, effect, and match and exclude as arrays of strings.`,
      );
    else {
      found.push({ capability, effect, match: match.map(String) });
      if (mixesHomePaths(capability, effect, match.map(String)))
        failures.push(
          `${where} is a ${effect} of ${capability} that lists a path of ~/ with other paths. Kiro 2.34.0 then skips the whole rule without a word, so none of its paths is denied. Put the paths of ~/ in a rule of their own (${permissionsDoc}).`,
        );
    }
  }
  return found;
}

// A deny of a file tool whose match has a path of ~/ and a path that is not (checked on Kiro 2.34.0 for fs_read and fs_write).
function mixesHomePaths(capability: string, effect: string, match: readonly string[]): boolean {
  const home = match.filter((pattern) => pattern.startsWith("~/"));
  return (
    effect === "deny" &&
    (capability === "fs_read" || capability === "fs_write") &&
    home.length > 0 &&
    home.length < match.length
  );
}

// The hosts of the links in external-docs.md.
const externalHosts = (tree: Tree): Set<string> =>
  new Set(
    [...tree.read(externalDocs).matchAll(/https:\/\/([A-Za-z0-9.-]+)/g)].map((m) => String(m[1])),
  );

function permissionPairs(path: string, rules: readonly AgentRule[]): string[] {
  const shell = rules.filter((rule) => rule.capability === "shell");
  const denied = shell.filter((rule) => rule.effect === "deny").flatMap((rule) => rule.match);
  return shell
    .filter((rule) => rule.effect === "allow")
    .flatMap((rule) => rule.match)
    .filter((pattern) => pattern.endsWith("*"))
    .flatMap((pattern) =>
      Object.entries(forbiddenArguments)
        .filter(([command]) => pattern.startsWith(command))
        .flatMap(([command, words]) =>
          words
            .filter((word) => !denied.some((d) => d.startsWith(command) && d.includes(word)))
            .map(
              (word) =>
                `${path}: the allow "${pattern}" has no deny of "${command}" with "${word}". An allow that ends with * lets that argument through (${permissionsDoc} ("許可と禁止の組")).`,
            ),
        ),
    );
}

// The rows of the table of permissions whose 区分 is 禁止, as the names in their 実装 cell.
function forbiddenRows(markdown: string): string[][] | undefined {
  const lines = markdown.split("\n");
  for (const [index, line] of lines.entries()) {
    const header = cells(line);
    const kind = header.indexOf("区分");
    const impl = header.indexOf("実装");
    if (kind === -1 || impl === -1) continue;
    const rows: string[][] = [];
    for (const body of lines.slice(index + 2)) {
      if (!body.startsWith("|")) break;
      const row = cells(body);
      if (row[kind] === "禁止")
        rows.push(
          String(row[impl])
            .split("`")
            .filter((_, i) => i % 2 === 1),
        );
    }
    return rows;
  }
  return undefined;
}

export function agentPermissions(tree: Tree): string[] {
  const agents = tree.paths.filter((path) => agentFile.test(path));
  if (agents.length === 0) return [];
  const failures: string[] = [];
  const all = new Map<string, AgentRule[]>();
  for (const path of agents) {
    const rules = agentRules(path, record(tree.parsed(path)), failures);
    all.set(path, rules);
    failures.push(...permissionPairs(path, rules));
    const hosts = externalHosts(tree);
    for (const rule of rules.filter((r) => r.capability === "web_fetch" && r.effect === "allow")) {
      if (rule.match.length === 0)
        failures.push(
          `${path}: a web_fetch allow without match allows every host. List the hosts of ${externalDocs}.`,
        );
      for (const host of rule.match.filter((m) => !hosts.has(m)))
        failures.push(
          `${path}: web_fetch allows "${host}", which is not a host of ${externalDocs}. Add it there, or remove it from the agent.`,
        );
    }
  }
  const names = configNames(tree).agents.map((agent) => agent.slice("kiro-agent: ".length));
  const defaultAgent = record(tree.parsed(settingsFile))["chat.defaultAgent"];
  if (!names.includes(String(defaultAgent)))
    failures.push(
      `${settingsFile} must set "chat.defaultAgent" to the name of an agent of .kiro/agents/, so that the rules apply without --agent.`,
    );
  const markdown = tree.maybe(permissionsDoc);
  const rows = markdown === undefined ? undefined : forbiddenRows(markdown);
  if (rows === undefined)
    return [
      ...failures,
      `${permissionsDoc} has no table with the columns 区分 and 実装. It lists every operation of the agents, and repo-policy compares it with the agents and the hooks.`,
    ];
  const checks = new Set(configNames(tree).checks.map((check) => check.name));
  const denied = new Set(
    [...all.values()]
      .flat()
      .filter((r) => r.effect === "deny")
      .map((r) => r.capability),
  );
  const cited = new Set<string>();
  for (const names of rows) {
    const label = names.join(", ");
    if (names.length === 0)
      failures.push(
        `${permissionsDoc}: a row of 禁止 has no 実装. Name a \`hook: <check>\` or an \`agent: <capability>\`.`,
      );
    for (const name of names) {
      const colon = name.indexOf(": ");
      const kind = name.slice(0, colon);
      const value = name.slice(colon + 2);
      if (kind === "hook" && !checks.has(value))
        failures.push(
          `${permissionsDoc}: ${label} names the hook check "${value}", which tools/scripts/src/hooks/ does not have.`,
        );
      else if (kind === "agent") {
        cited.add(value);
        if (!denied.has(value))
          failures.push(
            `${permissionsDoc}: ${label} names "agent: ${value}", but no agent has a deny rule for ${value}.`,
          );
      }
    }
  }
  for (const capability of denied)
    if (!cited.has(capability))
      failures.push(
        `An agent denies ${capability}, but no row of 禁止 in ${permissionsDoc} has \`agent: ${capability}\`. Add the operation to the table.`,
      );
  return failures;
}
