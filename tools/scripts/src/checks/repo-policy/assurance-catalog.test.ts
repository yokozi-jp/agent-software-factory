// The checks of the assurance catalog (./assurance-catalog.ts), each called alone on a small repository held in memory:
// a case breaks one file of a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { passingRepo } from "./fixtures/passing-repo.ts";
import { failuresOf, json, repo } from "./fixtures/repo.ts";
import { catalogMatchesConfigs } from "./assurance-catalog.ts";

const base = passingRepo;

describe("保証カタログに、設定の sensor ごとに 1 行あること", () => {
  const violations = failuresOf(catalogMatchesConfigs);
  const path = "docs/tooling/assurance-catalog.md";
  const catalog = base[path] ?? "";
  const row = (sensor: string, copies = "", detection = "test") =>
    `| ${sensor} | x | g | ${copies} | e | ${detection} |\n`;
  const withRow = (line: string) => ({ [path]: catalog + line });
  // The row of the Kiro check in the fixture, replaced by `line`.
  const kiroRow =
    "| `kiro: pre-tool-use/block-force-push` | x | ガードレール | | stderr | `force-push.test.ts` |\n";
  const withKiroRow = (line: string) => ({ [path]: catalog.replace(kiroRow, line) });
  const ci = base[".github/workflows/ci.yml"] ?? "";
  const lefthook = base["lefthook.yml"] ?? "";
  const noRow = (sensor: string) =>
    `\`${sensor}\` has no row in ${path}. Add a row for it, or name it in the ローカルの写し column of the row it copies.`;
  const gateNoRow = (sensor: string) =>
    `\`${sensor}\` has no row in ${path}. A gate is a row of its own; add one.`;

  it("行のない ci.yml の step を拒否すること", () => {
    const step = "      - name: Lint Markdown\n        run: pnpm lint:md\n";
    const added = ci.replace("  nx:\n", `${step}  nx:\n`);
    expect(violations(repo({ ".github/workflows/ci.yml": added }))).toEqual([
      gateNoRow("ci.yml: Lint Markdown"),
    ]);
  });

  it("名前のないコマンドを実行する step を拒否し、action を使うだけの step は拒否しないこと", () => {
    const added = ci.replace("  nx:\n", "      - run: pnpm lint:md\n      - uses: a/b@v1\n  nx:\n");
    expect(violations(repo({ ".github/workflows/ci.yml": added }))).toEqual([
      `.github/workflows/ci.yml: a step of the job \`checks\` runs a command without a name. Name it, so that ${path} can list it.`,
    ]);
  });

  it.each(['""', '" "', "1"])(
    "名前が %s の step を、名前のない step として拒否すること",
    (name) => {
      const added = ci.replace("  nx:\n", `      - name: ${name}\n        run: x\n  nx:\n`);
      expect(violations(repo({ ".github/workflows/ci.yml": added }))).toEqual([
        `.github/workflows/ci.yml: a step of the job \`checks\` runs a command without a name. Name it, so that ${path} can list it.`,
      ]);
    },
  );

  it("ruleset の必須チェック `main` である main の step を一覧にしないこと", () => {
    const named = ci.replace("      - run: exit 0", "      - name: Collect\n        run: exit 0");
    expect(violations(repo({ ".github/workflows/ci.yml": named }))).toEqual([]);
  });

  it.each([
    ["a job", "    - name: docs-check\n      run: x\n", ["lefthook: pre-commit/docs-check"]],
    [
      "the jobs of a group, not the group",
      "    - name: format-and-lint\n      group:\n        jobs:\n          - name: check\n            run: x\n          - name: markdownlint\n            run: x\n",
      ["lefthook: pre-commit/check", "lefthook: pre-commit/markdownlint"],
    ],
  ])("行のない lefthook.yml の %s を拒否すること", (_, job, sensors) => {
    expect(violations(repo({ "lefthook.yml": lefthook + job }))).toEqual(sensors.map(noRow));
  });

  it("行のない lefthook.yml のコマンドを拒否すること", () => {
    const commands = "pre-push:\n  commands:\n    adr-check:\n      run: x\n";
    expect(violations(repo({ "lefthook.yml": lefthook + commands }))).toEqual([
      noRow("lefthook: pre-push/adr-check"),
    ]);
  });

  it("名前のない lefthook.yml の job を拒否すること", () => {
    expect(violations(repo({ "lefthook.yml": `${lefthook}    - run: x\n` }))).toEqual([
      `lefthook.yml: a job of pre-commit has no name. Name it, so that ${path} can list it.`,
    ]);
  });

  it("自分の行を持つ lefthook.yml の job と、別の行の写しである job を通すこと", () => {
    const job = "    - name: adr-number\n      run: x\n";
    expect(
      violations(
        repo({
          "lefthook.yml": lefthook + job,
          ...withRow(row("`lefthook: pre-commit/adr-number`")),
        }),
      ),
    ).toEqual([]);
    const copy = catalog.replace(
      "`lefthook: pre-commit/scripts-test-tools`",
      "`lefthook: pre-commit/scripts-test-tools`、`lefthook: pre-commit/adr-number`",
    );
    expect(violations(repo({ "lefthook.yml": lefthook + job, [path]: copy }))).toEqual([]);
  });

  it("行のない .kiro/hooks の hook と、名前のない hook を拒否すること", () => {
    const hooks = json({ hooks: [{ name: "session-start" }, { trigger: "Stop" }] });
    expect(violations(repo({ ".kiro/hooks/session-start.json": hooks }))).toEqual([
      `.kiro/hooks/session-start.json: a hook has no name. Name it, so that ${path} can list it.`,
      `\`kiro: session-start\` has no row in ${path}. Add a row \`kiro: session-start/<check>\` for each check of the hook.`,
    ]);
  });

  it(".kiro/hooks 直下の JSON ファイルだけを読むこと", () => {
    const hooks = json({ hooks: [{ name: "session-start" }] });
    const elsewhere = {
      "apps/.kiro/hooks/a.json": hooks,
      ".kiro/hooks/a.json.bak": hooks,
      ".kiro/hooks/old/a.json": hooks,
    };
    expect(violations(repo(elsewhere))).toEqual([]);
  });

  it("行のない ruleset の規則、必須チェック、code scanning の道具を拒否すること", () => {
    const ruleset = json({
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "commitlint" }, { context: "main" }] },
        },
        {
          type: "code_scanning",
          parameters: { code_scanning_tools: [{ tool: "CodeQL" }, { tool: "Semgrep" }] },
        },
      ],
    });
    const failures = violations(repo({ ".github/rulesets/protect-main.json": ruleset }));
    expect(failures.filter((failure) => failure.includes(path))).toEqual([
      gateNoRow("ruleset: non_fast_forward"),
      gateNoRow("ruleset: main"),
      gateNoRow("ruleset: Semgrep"),
    ]);
  });

  it("必須チェックを required_status_checks からだけ読み、context のない項目を読み飛ばすこと", () => {
    const ruleset = json({
      rules: [
        { type: "deletion" },
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [{ context: "commitlint" }, { integration_id: 1 }],
          },
        },
        { type: "code_scanning", parameters: { code_scanning_tools: [{ tool: "CodeQL" }] } },
        { type: "CodeQL", parameters: { required_status_checks: [{ context: "lint" }] } },
      ],
    });
    expect(violations(repo({ ".github/rulesets/protect-main.json": ruleset }))).toEqual([]);
  });

  it("写しとしてだけ名前の挙がった gate を拒否すること", () => {
    const step = "      - name: Lint Markdown\n        run: pnpm lint:md\n";
    const added = ci.replace("  nx:\n", `${step}  nx:\n`);
    const copy = catalog.replace(
      "`lefthook: pre-commit/scripts-test-tools`",
      "`lefthook: pre-commit/scripts-test-tools`、`ci.yml: Lint Markdown`",
    );
    expect(violations(repo({ ".github/workflows/ci.yml": added, [path]: copy }))).toEqual([
      gateNoRow("ci.yml: Lint Markdown"),
    ]);
  });

  it.each([
    ["ci.yml: Gone", ".github/workflows/ci.yml"],
    ["ruleset: gone", ".github/rulesets/protect-main.json"],
    ["lefthook: pre-commit/gone", "lefthook.yml"],
    ["lefthook: scripts-test-tools", "lefthook.yml"],
    [
      "kiro: gone/check",
      "a hook of .kiro/hooks/*.json and a check of tools/scripts/src/hooks/, written `kiro: <hook>/<check>`",
    ],
    [
      "kiro: pre-tool-use",
      "a hook of .kiro/hooks/*.json and a check of tools/scripts/src/hooks/, written `kiro: <hook>/<check>`",
    ],
    [
      "kiro: pre-tool-use/",
      "a hook of .kiro/hooks/*.json and a check of tools/scripts/src/hooks/, written `kiro: <hook>/<check>`",
    ],
    [
      "kiro: pre-tool-use/block-gone",
      "a hook of .kiro/hooks/*.json and a check of tools/scripts/src/hooks/, written `kiro: <hook>/<check>`",
    ],
  ])("設定にない %s の行を拒否すること", (sensor, where) => {
    expect(violations(repo(withRow(row(`\`${sensor}\``))))).toEqual([
      `${path} names \`${sensor}\`, which is not in ${where}.`,
    ]);
  });

  it("設定にない写しを拒否すること", () => {
    const copy = row("`kiro: pre-tool-use/block-force-push`", "`lefthook: pre-push/gone`");
    expect(violations(repo(withKiroRow(copy)))).toEqual([
      `${path} names \`lefthook: pre-push/gone\`, which is not in lefthook.yml.`,
    ]);
  });

  it("ci.yml がないとき ci.yml の行を比べないが、ほかは比べること", () => {
    const files = { ".github/workflows/ci.yml": undefined, ...withRow(row("`ruleset: gone`")) };
    expect(violations(repo(files)).filter((failure) => failure.includes(path))).toEqual([
      `${path} names \`ruleset: gone\`, which is not in .github/rulesets/protect-main.json.`,
    ]);
  });

  it("1 つの sensor に 2 つの行があることを拒否すること", () => {
    expect(violations(repo(withRow(row("`ruleset: deletion`"))))).toEqual([
      `${path} names \`ruleset: deletion\` more than once. Each sensor has one row, and each local copy is named in one row.`,
    ]);
  });

  it("2 つの行、または行と写しの両方で名前の挙がった写しを拒否すること", () => {
    const twice = row("`ruleset: gone2`", "`lefthook: pre-commit/scripts-test-tools`");
    const failures = violations(repo(withRow(twice)));
    expect(failures).toContain(
      `${path} names \`lefthook: pre-commit/scripts-test-tools\` more than once. Each sensor has one row, and each local copy is named in one row.`,
    );
    const both = row("`lefthook: pre-commit/scripts-test-tools`");
    expect(violations(repo(withRow(both)))).toEqual([
      `${path} names \`lefthook: pre-commit/scripts-test-tools\` more than once. Each sensor has one row, and each local copy is named in one row.`,
    ]);
  });

  it("利用者に尋ね、行のないチェックを拒否すること", () => {
    const check = { "tools/scripts/src/hooks/discard-changes.ts": "// ask-discard-changes: x\n" };
    expect(violations(repo(check))).toEqual([
      `\`ask-discard-changes\` (tools/scripts/src/hooks/discard-changes.ts) has no row in ${path}. Add a row \`kiro: <hook>/ask-discard-changes\` for the hook that runs it.`,
    ]);
  });

  it("行のない Kiro の hook のチェックを拒否すること", () => {
    const check = { "tools/scripts/src/hooks/iwe-normalize.ts": "// block-iwe-normalize: x\n" };
    expect(violations(repo(check))).toEqual([
      `\`block-iwe-normalize\` (tools/scripts/src/hooks/iwe-normalize.ts) has no row in ${path}. Add a row \`kiro: <hook>/block-iwe-normalize\` for the hook that runs it.`,
    ]);
    const row2 = row("`kiro: pre-tool-use/block-iwe-normalize`");
    expect(violations(repo({ ...check, ...withRow(row2) }))).toEqual([]);
  });

  it("同じ名前の lefthook の job を、Kiro のチェックの行に数えないこと", () => {
    const files = {
      "tools/scripts/src/hooks/iwe-normalize.ts": "// block-iwe-normalize: x\n",
      "lefthook.yml": `${lefthook}    - name: block-iwe-normalize\n      run: x\n`,
      ...withRow(row("`lefthook: pre-commit/block-iwe-normalize`")),
    };
    expect(violations(repo(files))).toEqual([
      `\`block-iwe-normalize\` (tools/scripts/src/hooks/iwe-normalize.ts) has no row in ${path}. Add a row \`kiro: <hook>/block-iwe-normalize\` for the hook that runs it.`,
    ]);
  });

  it("tools/scripts/src/hooks 直下のファイルの最初の行だけで、チェックを名付けること", () => {
    expect(
      violations(
        repo({
          "tools/scripts/src/hooks/a.test.ts": "// block-a: x\n",
          "tools/scripts/src/hooks/pre-tool-use/rules.ts": "// block-b: x\n",
          "tools/scripts/src/hooks/c.ts": "// see block-c\n// block-c: x\n",
          "tools/scripts/src/hooks/d.ts": "// kiro-process: x\n",
          "tools/scripts/src/hooks/e.ts.bak": "// block-e: x\n",
          "apps/tools/scripts/src/hooks/f.ts": "// block-f: x\n",
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["no sensor", "plain text"],
    ["a code span that is not a sensor", "`vp check`"],
    ["a sensor outside a code span", "ruleset: deletion"],
    ["a code span that only mentions a sensor", "`see ruleset: deletion`"],
    ["two sensors", "`ruleset: deletion` `ruleset: CodeQL`"],
  ])("refuses a row with %s in its 名前 column", (_, sensor) => {
    expect(violations(repo(withRow(row(sensor))))).toEqual([
      `${path}: the row "${sensor}" must have one name in its 名前 column, such as \`ci.yml: Lint Markdown\`.`,
    ]);
  });

  it.each(["", " "])("refuses a row whose 検出力の確かめ方 is %j", (detection) => {
    const sensor = "`kiro: pre-tool-use/block-force-push`";
    expect(violations(repo(withKiroRow(row(sensor, "", detection))))).toEqual([
      `${path}: the row for \`kiro: pre-tool-use/block-force-push\` must fill in 検出力の確かめ方 (docs/tooling/ci.md ("検査を足すとき")).`,
    ]);
  });

  it("エスケープした縦棒のあるセルを読み、表の終わりで止まること", () => {
    // Split at the escaped pipe, the row would have an empty 検出力の確かめ方.
    const pipe = "| `kiro: pre-tool-use/block-force-push` | x \\| y | g | | | t |\n";
    const after = "Text after the table |\n\n| 名前 |\n| --- |\n| `ruleset: gone` |\n";
    expect(violations(repo(withKiroRow(pipe + after)))).toEqual([]);
  });

  it("列を名前で、順序を問わず見つけること", () => {
    const swapped = [
      "| 検出力の確かめ方 | ローカルの写し | 名前 |",
      "| --- | --- | --- |",
      "| t | `lefthook: pre-commit/scripts-test-tools` | `ci.yml: Guard push` |",
      "| t | | `ruleset: commitlint` |",
      "| t | | `ruleset: CodeQL` |",
      "| t | | `ruleset: deletion` |",
      "| t | | `kiro: pre-tool-use/block-force-push` |",
      "| t | | `kiro-agent: factory` |",
      "",
    ].join("\n");
    expect(violations(repo({ [path]: swapped }))).toEqual([]);
  });

  it("短い行が省いたセルを空として読むこと", () => {
    const short = "| `kiro: pre-tool-use/block-force-push` |\n";
    expect(violations(repo(withKiroRow(short)))).toEqual([
      `${path}: the row for \`kiro: pre-tool-use/block-force-push\` must fill in 検出力の確かめ方 (docs/tooling/ci.md ("検査を足すとき")).`,
    ]);
    const last = `| 検出力の確かめ方 | ローカルの写し | 名前 |\n| --- | --- | --- |\n| t |\n`;
    expect(violations(repo({ [path]: last })).slice(0, 1)).toEqual([
      `${path}: the row "" must have one name in its 名前 column, such as \`ci.yml: Lint Markdown\`.`,
    ]);
  });

  it("カタログのないリポジトリを拒否すること", () => {
    expect(violations(repo({ [path]: undefined }))).toEqual([
      `${path} does not exist. It lists every sensor of the gates, and repo-policy compares it with the configs.`,
    ]);
  });

  it.each([
    ["名前", "| 表 | ローカルの写し | 検出力の確かめ方 |"],
    ["ローカルの写し", "| 名前 | 写し | 検出力の確かめ方 |"],
    ["検出力の確かめ方", "| 名前 | ローカルの写し | 検出力 |"],
  ])("列 %s のない表を拒否すること", (_, header) => {
    const other = `${header}\n| --- | --- | --- |\n| \`ruleset: deletion\` | | t |\n`;
    expect(violations(repo({ [path]: other }))).toEqual([
      `${path} has no table with the columns 名前, ローカルの写し and 検出力の確かめ方.`,
    ]);
  });

  it("表のないカタログを拒否すること", () => {
    const other =
      "# 保証カタログ\n\n| 名前 | ゲート |\n| --- | --- |\n| `ruleset: deletion` | g |\n";
    expect(violations(repo({ [path]: other }))).toEqual([
      `${path} has no table with the columns 名前, ローカルの写し and 検出力の確かめ方.`,
    ]);
  });

  it("カタログに agent の行を求め、なくなった agent の行を求めないこと", () => {
    const rows = (base[path] ?? "").split("\n").filter((line) => !line.includes("kiro-agent"));
    expect(violations(repo({ [path]: rows.join("\n") }))).toEqual([
      `\`kiro-agent: factory\` has no row in ${path}. Add a row for the agent.`,
    ]);
    const extra = `${base[path] ?? ""}| \`kiro-agent: gone\` | x | g | | | t |\n`;
    expect(violations(repo({ [path]: extra }))).toEqual([
      `${path} names \`kiro-agent: gone\`, which is not in an agent of .kiro/agents/<name>.json.`,
    ]);
  });
});
