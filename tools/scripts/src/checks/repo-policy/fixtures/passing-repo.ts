// The files of a small repository that passes every check of repo-policy. The tests of rules.ts and
// cli.ts start from it and break one thing per case.
// A detection-power fixture of the module boundaries: an import that the rule must report.
export const moduleFixture =
  '// oxlint-disable-next-line no-restricted-imports -- fixture\nimport "@x/other";\n';
// A detection-power fixture of the rules that keep domain pure: a throw, a Date and a Math.random that the
// rules must report.
export const domainFixture = [
  "// oxlint-disable-next-line domain/no-throw -- fixture",
  'export const a = () => { throw new Error("x"); };',
  "// oxlint-disable-next-line no-restricted-globals -- fixture",
  "export const b = () => Date.now();",
  "// oxlint-disable-next-line no-restricted-properties -- fixture",
  "export const c = () => Math.random();",
  "",
].join("\n");

// A dbmate migration that passes the check of migrations (docs/adr/0025). The tests of rules.ts change one
// section of it.
export function migration(
  parts: { readonly up?: string; readonly down?: string; readonly upOptions?: string } = {},
): string {
  const up = parts.up ?? "SET LOCAL lock_timeout = '5s';\nCREATE TABLE x (id int);\n";
  const down = parts.down ?? "DO $$ BEGIN RAISE EXCEPTION 'irreversible: forward only'; END $$;\n";
  return `-- migrate:up${parts.upOptions ?? ""}\n${up}\n-- migrate:down\n${down}`;
}

// The fixtures of the runtime restrictions (docs/adr/0007) in packages/*/src/__fixtures__/: a global and a Node.js
// module that the rules must report, and an import in a test file that the override of the tests must still report.
export const runtimeFixture =
  "// oxlint-disable-next-line no-restricted-globals -- fixture\nexport const a: unknown = process;\n" +
  "// oxlint-disable-next-line no-restricted-properties -- fixture\nexport const b: unknown = globalThis.process;\n" +
  '// oxlint-disable-next-line import/no-nodejs-modules -- fixture\nimport "node:fs";\n';
export const srcFixtures = (name: string): Record<string, string> => ({
  [`packages/${name}/src/__fixtures__/boundaries.ts`]: moduleFixture,
  [`packages/${name}/src/__fixtures__/runtime-apis.ts`]: runtimeFixture,
  [`packages/${name}/src/__fixtures__/boundaries.test.ts`]: moduleFixture,
});

// The agent of the passing repository: the rules the checks of docs/tooling/agent-permissions.md read.
interface FixtureRule {
  readonly capability: string;
  readonly effect: string;
  readonly match?: readonly string[];
}
export const factoryAgent: {
  readonly name: string;
  readonly tools: readonly string[];
  readonly permissions: { readonly rules: readonly FixtureRule[] };
} = {
  name: "factory",
  tools: ["*"],
  permissions: {
    rules: [
      { capability: "shell", effect: "allow", match: ["git push*", "git commit*"] },
      {
        capability: "shell",
        effect: "deny",
        match: [
          "git push*main*",
          "git push*--no-verify*",
          "git push*--delete*",
          "git push*--force*",
          "git push*+*",
          "git push* -f*",
          "git commit*--no-verify*",
        ],
      },
      { capability: "web_fetch", effect: "allow", match: ["docs.github.com"] },
    ],
  },
};

// The fixture of a module whose domain override must keep the runtime restrictions (docs/adr/0007).
export const domainRuntimeFixtures = (name: string): Record<string, string> => ({
  [`packages/${name}/src/domain/__fixtures__/runtime-apis.ts`]: runtimeFixture,
});

// The root tsconfig.json of the passing repository: a comment line, two checking flags that are on, one that is
// off, and options that check nothing. It has a fixture line for each flag that is on.
const tsconfigFlagsFixture = [
  "// @ts-expect-error -- fixture: strict: the parameter has no type",
  "export const a = (value) => String(value);",
  "// @ts-expect-error -- fixture: noUncheckedIndexedAccess: the element may be undefined",
  "export const b: string = list[0];",
  "",
].join("\n");
const rootTsconfig = [
  "{",
  '  "compilerOptions": {',
  '    "noEmit": true,',
  "    // Strictness shared by every project.",
  '    "strict": true,',
  '    "noUncheckedIndexedAccess": true,',
  '    "noUnusedLocals": false',
  "  }",
  "}",
  "",
].join("\n");

export const passingRepo: Readonly<Record<string, string>> = {
  ".node-version": "24.22.1\n",
  "tsconfig.json": rootTsconfig,
  "apps/api/src/__fixtures__/tsconfig-flags.ts": tsconfigFlagsFixture,
  "packages/claim/tsconfig.json": JSON.stringify({
    extends: "../../tsconfig.json",
    compilerOptions: { target: "es2024", lib: ["es2024"], types: [] },
  }),
  "package.json": JSON.stringify({
    devDependencies: { nx: "catalog:" },
    engines: { node: "^24" },
  }),
  "apps/api/package.json": JSON.stringify({ dependencies: { hono: "catalog:" } }),
  "apps/api/db/migrations/20260101000000_create_x.sql": migration(),
  "pnpm-workspace.yaml": 'catalog:\n  "@types/node": ^24\n  nx: 24.0.0\n',
  "mise.toml": '[tools]\nbetterleaks = "1.9.0"\nshellcheck = "0.11.0"\n',
  ".betterleaks.toml":
    'title = "x"\nbetterleaksMinVersion = "1.9.0"\n\n[extend]\nuseDefault = true\n',
  "packages/shared/package.json": JSON.stringify({ name: "@x/shared" }),
  ...srcFixtures("shared"),
  "packages/claim/package.json": JSON.stringify({ name: "@x/claim" }),
  ...srcFixtures("claim"),
  ...domainRuntimeFixtures("claim"),
  "packages/claim/src/domain/__fixtures__/boundaries.ts": moduleFixture,
  "packages/claim/src/domain/__fixtures__/purity.ts": domainFixture,
  "packages/claim/src/http/__fixtures__/boundaries.ts": moduleFixture,
  "vite.config.ts": [
    "const modules: Record<string, readonly string[]> = {",
    "  claim: [],",
    "};",
    "const layers: Record<string, readonly string[]> = {",
    "  domain: [],",
    '  http: ["domain"],',
    "};",
    "",
    "export default defineConfig({",
    "  lint: {",
    "    overrides: [",
    "      {",
    '        files: ["apps/api/src/**"],',
    "        rules: {",
    '          "import/no-nodejs-modules": "error",',
    '          "no-restricted-imports": [',
    '            "error",',
    '            { paths: ["node:fs"] },',
    "          ],",
    '          "no-restricted-globals": ["error", { name: "process" }],',
    "        },",
    "      },",
    "    ],",
    "  },",
    "});",
    "",
  ].join("\n"),
  "apps/api/vite.config.ts": 'export default { build: { target: "node24" } };\n',
  ".kiro/steering/external-docs.md":
    "---\ninclusion: auto\nname: external-docs\ndescription: when to read the docs.\n---\n\n# Docs\n",
  "docs/adr/0001-lefthook.md": "# ADR 0001\n",
  "docs/adr/0002-nx.md": "# ADR 0002\n",
  "docs/local-env-setup/setup.md": "# Setup\n\n## 3. Ubuntu の初期セットアップ\n",
  "tools/scripts/sh/guard-push.sh": "#!/bin/sh\ngit push --dry-run\n",
  ".github/workflows/ci.yml": [
    "jobs:",
    "  checks:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/checkout@v7",
    "      - name: Guard push",
    "        run: tools/scripts/sh/guard-push.sh",
    "  nx:",
    "    runs-on: ubuntu-26.04",
    "    steps: []",
    "  main:",
    "    needs: [checks, nx]",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - run: exit 0",
    "",
  ].join("\n"),
  ".github/workflows/commitlint.yml": [
    "on:",
    "  pull_request:",
    "jobs:",
    "  commitlint:",
    "    runs-on: ubuntu-26.04",
    "    steps: []",
    "",
  ].join("\n"),
  ".github/rulesets/protect-main.json": JSON.stringify({
    rules: [
      { type: "deletion" },
      {
        type: "required_status_checks",
        parameters: { required_status_checks: [{ context: "commitlint" }] },
      },
      { type: "code_scanning", parameters: { code_scanning_tools: [{ tool: "CodeQL" }] } },
    ],
  }),
  "lefthook.yml": [
    "# Docs: docs/adr/0001",
    "pre-commit:",
    "  jobs:",
    "    - name: scripts-test-tools",
    "      glob: mise.toml",
    "      run: tools/scripts/sh/guard-push.sh",
    "",
  ].join("\n"),
  ".kiro/hooks/pre-tool-use.json": JSON.stringify({
    hooks: [{ name: "pre-tool-use", trigger: "PreToolUse" }],
  }),
  // A check of the Kiro hooks: its first line names it.
  "tools/scripts/src/hooks/force-push.ts":
    "// block-force-push: refuse a force push.\nexport {};\n",
  "tools/scripts/src/hooks/shell-command.ts": "// The words of a shell command.\nexport {};\n",
  // An agent with rules, the setting that makes it the default, and the documents the rules are compared with.
  ".kiro/agents/factory.json": JSON.stringify(factoryAgent),
  ".kiro/settings/cli.json": JSON.stringify({ "chat.defaultAgent": "factory" }),
  "docs/tooling/external-docs.md":
    "# 外部ドキュメント\n\n| GitHub | https://docs.github.com/en/x |\n",
  "docs/tooling/agent-permissions.md": [
    "# エージェントの権限",
    "",
    "| 操作 | 区分 | 実装 | すり抜ける形 |",
    "| --- | --- | --- | --- |",
    "| 読む | 許可 | `agent: shell` | なし |",
    "| force push | 禁止 | `hook: block-force-push`、`agent: shell` | 変数 |",
    "",
  ].join("\n"),
  // The table that repo-policy compares with the configs above, as docs/tooling/assurance-catalog.md.
  "docs/tooling/assurance-catalog.md": [
    "# 保証カタログ",
    "",
    "| 名前 | 保証すること | ゲート | ローカルの写し | 証拠 | 検出力の確かめ方 |",
    "| --- | --- | --- | --- | --- | --- |",
    "| `ci.yml: Guard push` | x | `main` | `lefthook: pre-commit/scripts-test-tools` | log | `guard-push.test.ts` |",
    "| `ruleset: commitlint` | x | 必須チェック | | log | `commitlint.tools.test.ts` |",
    "| `ruleset: CodeQL` | x | ruleset | | alert | GitHub |",
    "| `ruleset: deletion` | x | ガードレール | | push | 静的な検査 |",
    "| `kiro-agent: factory` | x | ガードレール | | log | `rules.test.ts` |",
    "| `kiro: pre-tool-use/block-force-push` | x | ガードレール | | stderr | `force-push.test.ts` |",
    "",
  ].join("\n"),
};
