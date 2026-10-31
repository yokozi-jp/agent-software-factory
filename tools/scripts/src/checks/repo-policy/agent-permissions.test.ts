// The checks of the permissions of the agents (./agent-permissions.ts), each called on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { factoryAgent, passingRepo } from "./fixtures/passing-repo.ts";
import { failuresOf, json, repo } from "./fixtures/repo.ts";
import { agentPermissions } from "./agent-permissions.ts";

const base = passingRepo;

describe("the permissions of the agents (docs/tooling/agent-permissions.md)", () => {
  const violations = failuresOf(agentPermissions);
  const agent = ".kiro/agents/factory.json";
  const doc = "docs/tooling/agent-permissions.md";
  const settings = ".kiro/settings/cli.json";
  const catalogPath = "docs/tooling/assurance-catalog.md";
  const original = factoryAgent;
  // The agent of the passing repository with its rules replaced (or its tools).
  const withRules = (
    rules: readonly unknown[],
    tools: unknown = original.tools,
  ): Record<string, string> => ({
    [agent]: json({ ...original, tools, permissions: { rules } }),
  });
  const rule = (extra: Record<string, unknown>): Record<string, unknown> => ({
    capability: "web_fetch",
    effect: "allow",
    match: ["docs.github.com"],
    ...extra,
  });
  const shellRules = original.permissions.rules.slice(0, 2);
  const shellRule = (effect: string, match: string[]): Record<string, unknown> => ({
    capability: "shell",
    effect,
    match,
  });

  it("passes a repository without an agent", () => {
    const rows = (base[catalogPath] ?? "")
      .split("\n")
      .filter((line) => !line.includes("kiro-agent"));
    const without = { [agent]: undefined, [settings]: undefined, [doc]: undefined };
    expect(violations(repo({ ...without, [catalogPath]: rows.join("\n") }))).toEqual([]);
  });

  it("takes only .kiro/agents/<name>.json for an agent", () => {
    const files = {
      ".kiro/agents/sub/x.json": "{}",
      "docs/.kiro/agents/y.json": "{}",
      ".kiro/agents/z.json.bak": "{}",
    };
    expect(violations(repo(files))).toEqual([]);
  });

  it("does not hold a rule of another capability to the pairs", () => {
    const rules = [{ capability: "fs_read", effect: "allow", match: ["git push*"] }];
    const table =
      "| 操作 | 区分 | 実装 |\n| --- | --- | --- |\n| a | 禁止 | `hook: block-force-push` |\n";
    expect(violations(repo({ ...withRules(rules), [doc]: table }))).toEqual([]);
  });

  describe("a deny of a file tool that mixes paths of ~/ with other paths", () => {
    // Only this check: the other checks compare the rules with the table of the doc.
    const mixing = (rules: readonly unknown[]): string[] =>
      violations(repo(withRules([...original.permissions.rules, ...rules]))).filter((line) =>
        line.includes("lists a path of ~/"),
      );
    const rule = (
      capability: string,
      effect: string,
      match: string[],
    ): Record<string, unknown> => ({
      capability,
      effect,
      match,
    });
    const index = original.permissions.rules.length;
    const message = (capability: string): string =>
      `${agent}: rule ${index} is a deny of ${capability} that lists a path of ~/ with other paths. Kiro 2.34.0 then skips the whole rule without a word, so none of its paths is denied. Put the paths of ~/ in a rule of their own (docs/tooling/agent-permissions.md).`;

    it.each(["fs_read", "fs_write"])("refuses it for %s", (capability) => {
      expect(mixing([rule(capability, "deny", ["~/.aws/**", "**/secret"])])).toEqual([
        message(capability),
      ]);
    });

    it("passes paths of ~/ alone, and other paths alone", () => {
      const rules = [
        rule("fs_read", "deny", ["~/.aws/**", "~/.ssh/**"]),
        rule("fs_read", "deny", ["**/secret"]),
      ];
      expect(mixing(rules)).toEqual([]);
    });

    it("does not hold an allow, or another capability, to it", () => {
      expect(mixing([rule("fs_read", "allow", ["~/x", "y"])])).toEqual([]);
      expect(mixing([rule("shell", "deny", ["~/x", "y"])])).toEqual([]);
    });
  });

  it("refuses an agent without tools, which can use none", () => {
    expect(violations(repo(withRules(original.permissions.rules, [])))).toEqual([
      `${agent} must have "tools": ["*"]. An agent without tools can use none (docs/tooling/agent-permissions.md).`,
    ]);
  });

  it("refuses a capability Kiro does not know, which it skips without a word", () => {
    const failures = violations(
      repo(withRules([...original.permissions.rules, rule({ capability: "shel" })])),
    );
    expect(failures).toEqual([
      `${agent}: rule 3 has the capability "shel", which Kiro does not know. It skips such a rule without a word. Known: all, builtin, filesystem, fs_read, fs_write, shell, web_fetch, web_search, mcp, subagent, skill, power, context, diagnostics, workflow, sandbox_network.`,
    ]);
  });

  it("refuses an effect that Kiro does not accept", () => {
    expect(
      violations(repo(withRules([...original.permissions.rules, rule({ effect: "block" })]))),
    ).toEqual([`${agent}: rule 3 has the effect "block". Use allow, deny, ask or evaluate.`]);
  });

  it.each([
    { colour: "red" },
    { match: "docs.github.com" },
    { match: [1] },
    { match: ["docs.github.com", 1] },
    { exclude: "x" },
  ])("refuses fields Kiro rejects: %j", (extra) => {
    const failures = violations(repo(withRules([...original.permissions.rules, rule(extra)])));
    expect(failures).toEqual([
      `${agent}: rule 3 has fields Kiro rejects. A rule has capability, effect, and match and exclude as arrays of strings.`,
    ]);
  });

  it("accepts every capability and effect that Kiro knows", () => {
    const capabilities = [
      "all",
      "builtin",
      "filesystem",
      "fs_read",
      "fs_write",
      "shell",
      "web_search",
      "mcp",
      "subagent",
      "skill",
      "power",
      "context",
      "diagnostics",
      "workflow",
      "sandbox_network",
    ];
    const rules = capabilities.flatMap((capability) =>
      ["allow", "ask", "evaluate"].map((effect) => ({ capability, effect })),
    );
    expect(
      violations(
        repo(
          withRules([
            ...original.permissions.rules,
            ...rules,
            { capability: "mcp", effect: "ask", match: ["a"], exclude: ["b"] },
          ]),
        ),
      ),
    ).toEqual([]);
  });

  it("refuses a web_fetch allow for a host that external-docs.md does not list", () => {
    expect(
      violations(
        repo(
          withRules([
            ...original.permissions.rules.slice(0, 2),
            rule({ match: ["docs.github.com", "example.com"] }),
          ]),
        ),
      ),
    ).toEqual([
      `${agent}: web_fetch allows "example.com", which is not a host of docs/tooling/external-docs.md. Add it there, or remove it from the agent.`,
    ]);
  });

  it("refuses a web_fetch allow without a match, which allows every host", () => {
    expect(
      violations(
        repo(
          withRules([
            ...original.permissions.rules.slice(0, 2),
            { capability: "web_fetch", effect: "allow" },
          ]),
        ),
      ),
    ).toEqual([
      `${agent}: a web_fetch allow without match allows every host. List the hosts of docs/tooling/external-docs.md.`,
    ]);
  });

  it("does not hold a web_fetch ask or deny to the list of hosts", () => {
    const rules = [...original.permissions.rules, rule({ effect: "ask", match: ["example.com"] })];
    expect(violations(repo(withRules(rules)))).toEqual([]);
  });

  it.each([
    ["git push*", "main"],
    ["git push*", "--no-verify"],
    ["git push*", "--delete"],
    ["git push*", "--force"],
    ["git push*", "+"],
    ["git push*", " -f"],
    ["git commit*", "--no-verify"],
  ])("refuses the allow %j without a deny that has %j", (allow, word) => {
    const deny = {
      ...shellRules[1],
      match: (shellRules[1]?.match ?? []).filter(
        (pattern) => !(pattern.startsWith(allow.slice(0, -1)) && pattern.includes(word)),
      ),
    };
    const command = allow.slice(0, -1);
    expect(
      violations(repo(withRules([shellRules[0], deny, original.permissions.rules[2]]))),
    ).toEqual([
      `${agent}: the allow "${allow}" has no deny of "${command}" with "${word}". An allow that ends with * lets that argument through (${doc} ("許可と禁止の組")).`,
    ]);
  });

  it("does not ask for a deny when the allow does not end with *, or is another command", () => {
    const rules = [
      shellRule("allow", ["git push", "git status*"]),
      shellRule("deny", ["git push*main*"]),
      original.permissions.rules[2],
    ];
    expect(violations(repo(withRules(rules)))).toEqual([]);
  });

  it("looks for the deny among the denies only", () => {
    const asks = { ...shellRules[1], effect: "ask" };
    const failures = violations(
      repo(withRules([shellRules[0], asks, original.permissions.rules[2]])),
    );
    expect(failures.filter((failure) => failure.includes("has no deny"))).toHaveLength(7);
  });

  it.each([undefined, "other", 1])("refuses chat.defaultAgent %j", (value) => {
    const failures = violations(repo({ [settings]: json({ "chat.defaultAgent": value }) }));
    expect(failures).toEqual([
      `${settings} must set "chat.defaultAgent" to the name of an agent of .kiro/agents/, so that the rules apply without --agent.`,
    ]);
  });

  it("refuses a missing cli.json", () => {
    expect(violations(repo({ [settings]: undefined }))).toHaveLength(1);
  });

  it("refuses a missing table, and a table without the columns", () => {
    const message = `${doc} has no table with the columns 区分 and 実装. It lists every operation of the agents, and repo-policy compares it with the agents and the hooks.`;
    expect(violations(repo({ [doc]: undefined }))).toEqual([message]);
    expect(
      violations(repo({ [doc]: "# x\n\n| 操作 | 区分 |\n| --- | --- |\n| a | 禁止 |\n" })),
    ).toEqual([message]);
    expect(
      violations(
        repo({ [doc]: "# x\n\n| 操作 | 実装 |\n| --- | --- |\n| a | `agent: shell` |\n" }),
      ),
    ).toEqual([message]);
  });

  it("refuses a 禁止 row without an implementation", () => {
    const table =
      "| 操作 | 区分 | 実装 |\n| --- | --- | --- |\n| a | 禁止 | なし |\n| b | 禁止 | `agent: shell` |\n";
    expect(violations(repo({ [doc]: table }))).toEqual([
      `${doc}: a row of 禁止 has no 実装. Name a \`hook: <check>\` or an \`agent: <capability>\`.`,
    ]);
  });

  it("refuses a hook that does not exist", () => {
    const table =
      "| 操作 | 区分 | 実装 |\n| --- | --- | --- |\n| a | 禁止 | `hook: block-gone`、`agent: shell` |\n";
    expect(violations(repo({ [doc]: table }))).toEqual([
      `${doc}: hook: block-gone, agent: shell names the hook check "block-gone", which tools/scripts/src/hooks/ does not have.`,
    ]);
  });

  it("refuses an agent capability without a deny rule", () => {
    const table =
      "| 操作 | 区分 | 実装 |\n| --- | --- | --- |\n| a | 禁止 | `agent: shell`、`agent: fs_write` |\n";
    expect(violations(repo({ [doc]: table }))).toEqual([
      `${doc}: agent: shell, agent: fs_write names "agent: fs_write", but no agent has a deny rule for fs_write.`,
    ]);
  });

  it("refuses a deny rule that no 禁止 row cites", () => {
    const table =
      "| 操作 | 区分 | 実装 |\n| --- | --- | --- |\n| a | 禁止 | `hook: block-force-push` |\n| b | 確認 | `agent: shell` |\n";
    expect(violations(repo({ [doc]: table }))).toEqual([
      `An agent denies shell, but no row of 禁止 in ${doc} has \`agent: shell\`. Add the operation to the table.`,
    ]);
  });

  it("reads a row without the closing pipe", () => {
    const table = "| 操作 | 区分 | 実装\n| --- | --- | ---\n| a | 禁止 | `agent: shell`\n";
    expect(violations(repo({ [doc]: table }))).toEqual([]);
  });

  it("reads the columns by their names, and stops at the end of the table", () => {
    const table =
      "| 実装 | 区分 |\n| --- | --- |\n| `agent: shell` | 禁止 |\n\ntext\n\n| 実装 | 区分 |\n| --- | --- |\n| `hook: block-gone` | 禁止 |\n";
    expect(violations(repo({ [doc]: table }))).toEqual([]);
  });
});
