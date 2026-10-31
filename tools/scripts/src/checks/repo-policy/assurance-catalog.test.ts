// The checks of the assurance catalog (./assurance-catalog.ts), each called on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { passingRepo } from "./fixtures/passing-repo.ts";
import { failuresOf, json, repo } from "./fixtures/repo.ts";
import { catalogMatchesConfigs } from "./assurance-catalog.ts";

const base = passingRepo;

describe("the assurance catalog has one row per sensor of the configs", () => {
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

  it("refuses a step of ci.yml that has no row", () => {
    const step = "      - name: Lint Markdown\n        run: pnpm lint:md\n";
    const added = ci.replace("  nx:\n", `${step}  nx:\n`);
    expect(violations(repo({ ".github/workflows/ci.yml": added }))).toEqual([
      gateNoRow("ci.yml: Lint Markdown"),
    ]);
  });

  it("refuses a step that runs a command without a name, but not one that only uses an action", () => {
    const added = ci.replace("  nx:\n", "      - run: pnpm lint:md\n      - uses: a/b@v1\n  nx:\n");
    expect(violations(repo({ ".github/workflows/ci.yml": added }))).toEqual([
      `.github/workflows/ci.yml: a step of the job \`checks\` runs a command without a name. Name it, so that ${path} can list it.`,
    ]);
  });

  it.each(['""', '" "', "1"])("refuses a step named %s, as one without a name", (name) => {
    const added = ci.replace("  nx:\n", `      - name: ${name}\n        run: x\n  nx:\n`);
    expect(violations(repo({ ".github/workflows/ci.yml": added }))).toEqual([
      `.github/workflows/ci.yml: a step of the job \`checks\` runs a command without a name. Name it, so that ${path} can list it.`,
    ]);
  });

  it("does not list the steps of main, which is the required check `main` of the ruleset", () => {
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
  ])("refuses %s of lefthook.yml that has no row", (_, job, sensors) => {
    expect(violations(repo({ "lefthook.yml": lefthook + job }))).toEqual(sensors.map(noRow));
  });

  it("refuses a command of lefthook.yml that has no row", () => {
    const commands = "pre-push:\n  commands:\n    adr-check:\n      run: x\n";
    expect(violations(repo({ "lefthook.yml": lefthook + commands }))).toEqual([
      noRow("lefthook: pre-push/adr-check"),
    ]);
  });

  it("refuses a job of lefthook.yml without a name", () => {
    expect(violations(repo({ "lefthook.yml": `${lefthook}    - run: x\n` }))).toEqual([
      `lefthook.yml: a job of pre-commit has no name. Name it, so that ${path} can list it.`,
    ]);
  });

  it("passes a job of lefthook.yml that is a row of its own, or a local copy of another row", () => {
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

  it("refuses a hook of .kiro/hooks without a row, and one without a name", () => {
    const hooks = json({ hooks: [{ name: "session-start" }, { trigger: "Stop" }] });
    expect(violations(repo({ ".kiro/hooks/session-start.json": hooks }))).toEqual([
      `.kiro/hooks/session-start.json: a hook has no name. Name it, so that ${path} can list it.`,
      `\`kiro: session-start\` has no row in ${path}. Add a row \`kiro: session-start/<check>\` for each check of the hook.`,
    ]);
  });

  it("reads only the JSON files directly in .kiro/hooks", () => {
    const hooks = json({ hooks: [{ name: "session-start" }] });
    const elsewhere = {
      "apps/.kiro/hooks/a.json": hooks,
      ".kiro/hooks/a.json.bak": hooks,
      ".kiro/hooks/old/a.json": hooks,
    };
    expect(violations(repo(elsewhere))).toEqual([]);
  });

  it("refuses a rule, a required check and a code scanning tool of the ruleset without a row", () => {
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

  it("reads required checks only from required_status_checks, and skips an entry without a context", () => {
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

  it("refuses a gate that is only named as a local copy", () => {
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
  ])("refuses a row for %s, which the configs do not have", (sensor, where) => {
    expect(violations(repo(withRow(row(`\`${sensor}\``))))).toEqual([
      `${path} names \`${sensor}\`, which is not in ${where}.`,
    ]);
  });

  it("refuses a local copy that the configs do not have", () => {
    const copy = row("`kiro: pre-tool-use/block-force-push`", "`lefthook: pre-push/gone`");
    expect(violations(repo(withKiroRow(copy)))).toEqual([
      `${path} names \`lefthook: pre-push/gone\`, which is not in lefthook.yml.`,
    ]);
  });

  it("does not compare the rows for ci.yml when there is no ci.yml, but still the others", () => {
    const files = { ".github/workflows/ci.yml": undefined, ...withRow(row("`ruleset: gone`")) };
    expect(violations(repo(files)).filter((failure) => failure.includes(path))).toEqual([
      `${path} names \`ruleset: gone\`, which is not in .github/rulesets/protect-main.json.`,
    ]);
  });

  it("refuses two rows for one sensor", () => {
    expect(violations(repo(withRow(row("`ruleset: deletion`"))))).toEqual([
      `${path} names \`ruleset: deletion\` more than once. Each sensor has one row, and each local copy is named in one row.`,
    ]);
  });

  it("refuses a local copy named in two rows, or as a row and a copy", () => {
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

  it("refuses a check that asks the user and has no row", () => {
    const check = { "tools/scripts/src/hooks/discard-changes.ts": "// ask-discard-changes: x\n" };
    expect(violations(repo(check))).toEqual([
      `\`ask-discard-changes\` (tools/scripts/src/hooks/discard-changes.ts) has no row in ${path}. Add a row \`kiro: <hook>/ask-discard-changes\` for the hook that runs it.`,
    ]);
  });

  it("refuses a check of the Kiro hooks that has no row", () => {
    const check = { "tools/scripts/src/hooks/iwe-normalize.ts": "// block-iwe-normalize: x\n" };
    expect(violations(repo(check))).toEqual([
      `\`block-iwe-normalize\` (tools/scripts/src/hooks/iwe-normalize.ts) has no row in ${path}. Add a row \`kiro: <hook>/block-iwe-normalize\` for the hook that runs it.`,
    ]);
    const row2 = row("`kiro: pre-tool-use/block-iwe-normalize`");
    expect(violations(repo({ ...check, ...withRow(row2) }))).toEqual([]);
  });

  it("does not count a lefthook job of the same name as the row of a Kiro check", () => {
    const files = {
      "tools/scripts/src/hooks/iwe-normalize.ts": "// block-iwe-normalize: x\n",
      "lefthook.yml": `${lefthook}    - name: block-iwe-normalize\n      run: x\n`,
      ...withRow(row("`lefthook: pre-commit/block-iwe-normalize`")),
    };
    expect(violations(repo(files))).toEqual([
      `\`block-iwe-normalize\` (tools/scripts/src/hooks/iwe-normalize.ts) has no row in ${path}. Add a row \`kiro: <hook>/block-iwe-normalize\` for the hook that runs it.`,
    ]);
  });

  it("names a check only by the first line of a file directly in tools/scripts/src/hooks", () => {
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

  it("reads a cell with an escaped pipe, and stops at the end of the table", () => {
    // Split at the escaped pipe, the row would have an empty 検出力の確かめ方.
    const pipe = "| `kiro: pre-tool-use/block-force-push` | x \\| y | g | | | t |\n";
    const after = "Text after the table |\n\n| 名前 |\n| --- |\n| `ruleset: gone` |\n";
    expect(violations(repo(withKiroRow(pipe + after)))).toEqual([]);
  });

  it("finds the columns by their names, in any order", () => {
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

  it("reads the cells that a short row leaves out as empty", () => {
    const short = "| `kiro: pre-tool-use/block-force-push` |\n";
    expect(violations(repo(withKiroRow(short)))).toEqual([
      `${path}: the row for \`kiro: pre-tool-use/block-force-push\` must fill in 検出力の確かめ方 (docs/tooling/ci.md ("検査を足すとき")).`,
    ]);
    const last = `| 検出力の確かめ方 | ローカルの写し | 名前 |\n| --- | --- | --- |\n| t |\n`;
    expect(violations(repo({ [path]: last })).slice(0, 1)).toEqual([
      `${path}: the row "" must have one name in its 名前 column, such as \`ci.yml: Lint Markdown\`.`,
    ]);
  });

  it("refuses a repository without the catalog", () => {
    expect(violations(repo({ [path]: undefined }))).toEqual([
      `${path} does not exist. It lists every sensor of the gates, and repo-policy compares it with the configs.`,
    ]);
  });

  it.each([
    ["名前", "| 表 | ローカルの写し | 検出力の確かめ方 |"],
    ["ローカルの写し", "| 名前 | 写し | 検出力の確かめ方 |"],
    ["検出力の確かめ方", "| 名前 | ローカルの写し | 検出力 |"],
  ])("refuses a table without the column %s", (_, header) => {
    const other = `${header}\n| --- | --- | --- |\n| \`ruleset: deletion\` | | t |\n`;
    expect(violations(repo({ [path]: other }))).toEqual([
      `${path} has no table with the columns 名前, ローカルの写し and 検出力の確かめ方.`,
    ]);
  });

  it("refuses a catalog without the table", () => {
    const other =
      "# 保証カタログ\n\n| 名前 | ゲート |\n| --- | --- |\n| `ruleset: deletion` | g |\n";
    expect(violations(repo({ [path]: other }))).toEqual([
      `${path} has no table with the columns 名前, ローカルの写し and 検出力の確かめ方.`,
    ]);
  });

  it("wants a row for the agent in the catalog, and none for an agent that is gone", () => {
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
