// The checks of the permissions of the agents
// (./agent-permissions.ts), each called alone on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { factoryAgent, passingRepo } from "./fixtures/passing-repo.ts";
import { failuresOf, json, repo } from "./fixtures/repo.ts";
import { agentPermissions } from "./agent-permissions.ts";

const base = passingRepo;

describe("agent の権限 (docs/tooling/agent-permissions.md)", () => {
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

  it("agent のないリポジトリを通すこと", () => {
    const rows = (base[catalogPath] ?? "")
      .split("\n")
      .filter((line) => !line.includes("kiro-agent"));
    const without = { [agent]: undefined, [settings]: undefined, [doc]: undefined };
    expect(violations(repo({ ...without, [catalogPath]: rows.join("\n") }))).toEqual([]);
  });

  it("agent として .kiro/agents/<name>.json だけを採ること", () => {
    const files = {
      ".kiro/agents/sub/x.json": "{}",
      "docs/.kiro/agents/y.json": "{}",
      ".kiro/agents/z.json.bak": "{}",
    };
    expect(violations(repo(files))).toEqual([]);
  });

  it("ほかの capability の規則を、組に当てはめないこと", () => {
    const rules = [{ capability: "fs_read", effect: "allow", match: ["git push*"] }];
    const table =
      "| 操作 | 区分 | 実装 |\n| --- | --- | --- |\n| a | 禁止 | `hook: block-force-push` |\n";
    expect(violations(repo({ ...withRules(rules), [doc]: table }))).toEqual([]);
  });

  describe("~/ の path とほかの path を混ぜたファイル tool の deny", () => {
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

    it.each(["fs_read", "fs_write"])("%s に対して拒否すること", (capability) => {
      expect(mixing([rule(capability, "deny", ["~/.aws/**", "**/secret"])])).toEqual([
        message(capability),
      ]);
    });

    it("~/ の path だけ、ほかの path だけを通すこと", () => {
      const rules = [
        rule("fs_read", "deny", ["~/.aws/**", "~/.ssh/**"]),
        rule("fs_read", "deny", ["**/secret"]),
      ];
      expect(mixing(rules)).toEqual([]);
    });

    it("allow やほかの capability を、それに当てはめないこと", () => {
      expect(mixing([rule("fs_read", "allow", ["~/x", "y"])])).toEqual([]);
      expect(mixing([rule("shell", "deny", ["~/x", "y"])])).toEqual([]);
    });
  });

  it("使える tool が 1 つもない agent を拒否すること", () => {
    expect(violations(repo(withRules(original.permissions.rules, [])))).toEqual([
      `${agent} must have "tools": ["*"]. An agent without tools can use none (docs/tooling/agent-permissions.md).`,
    ]);
  });

  it("Kiro が知らず黙って読み飛ばす capability を拒否すること", () => {
    const failures = violations(
      repo(withRules([...original.permissions.rules, rule({ capability: "shel" })])),
    );
    expect(failures).toEqual([
      `${agent}: rule 3 has the capability "shel", which Kiro does not know. It skips such a rule without a word. Known: all, builtin, filesystem, fs_read, fs_write, shell, web_fetch, web_search, mcp, subagent, skill, power, context, diagnostics, workflow, sandbox_network.`,
    ]);
  });

  it("Kiro が受け付けない effect を拒否すること", () => {
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
  ])("Kiro が拒否する項目を拒否すること: %j", (extra) => {
    const failures = violations(repo(withRules([...original.permissions.rules, rule(extra)])));
    expect(failures).toEqual([
      `${agent}: rule 3 has fields Kiro rejects. A rule has capability, effect, and match and exclude as arrays of strings.`,
    ]);
  });

  it("Kiro が知るすべての capability と effect を受け付けること", () => {
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

  it("external-docs.md に載っていない host への web_fetch の allow を拒否すること", () => {
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

  it("すべての host を許す、一致のない web_fetch の allow を拒否すること", () => {
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

  it("web_fetch の ask や deny を、host の一覧に当てはめないこと", () => {
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
  ])("allow %j を、%j を持つ deny のないまま拒否すること", (allow, word) => {
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

  it("allow が * で終わらないとき、または別のコマンドのとき、deny を求めないこと", () => {
    const rules = [
      shellRule("allow", ["git push", "git status*"]),
      shellRule("deny", ["git push*main*"]),
      original.permissions.rules[2],
    ];
    expect(violations(repo(withRules(rules)))).toEqual([]);
  });

  it("deny を deny の中だけで探すこと", () => {
    const asks = { ...shellRules[1], effect: "ask" };
    const failures = violations(
      repo(withRules([shellRules[0], asks, original.permissions.rules[2]])),
    );
    expect(failures.filter((failure) => failure.includes("has no deny"))).toHaveLength(7);
  });

  it.each([undefined, "other", 1])("chat.defaultAgent %j を拒否すること", (value) => {
    const failures = violations(repo({ [settings]: json({ "chat.defaultAgent": value }) }));
    expect(failures).toEqual([
      `${settings} must set "chat.defaultAgent" to the name of an agent of .kiro/agents/, so that the rules apply without --agent.`,
    ]);
  });

  it("cli.json がないことを拒否すること", () => {
    expect(violations(repo({ [settings]: undefined }))).toHaveLength(1);
  });

  it("表がないことと、列のない表を拒否すること", () => {
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

  it("存在しない hook を拒否すること", () => {
    const table =
      "| 操作 | 区分 | 実装 |\n| --- | --- | --- |\n| a | 禁止 | `hook: block-gone`、`agent: shell` |\n";
    expect(violations(repo({ [doc]: table }))).toEqual([
      `${doc}: hook: block-gone, agent: shell names the hook check "block-gone", which tools/scripts/src/hooks/ does not have.`,
    ]);
  });

  it("deny の規則のない agent の capability を拒否すること", () => {
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

  it("閉じの縦棒のない行を読むこと", () => {
    const table = "| 操作 | 区分 | 実装\n| --- | --- | ---\n| a | 禁止 | `agent: shell`\n";
    expect(violations(repo({ [doc]: table }))).toEqual([]);
  });

  it("列を名前で読み、表の終わりで止まること", () => {
    const table =
      "| 実装 | 区分 |\n| --- | --- |\n| `agent: shell` | 禁止 |\n\ntext\n\n| 実装 | 区分 |\n| --- | --- |\n| `hook: block-gone` | 禁止 |\n";
    expect(violations(repo({ [doc]: table }))).toEqual([]);
  });
});
