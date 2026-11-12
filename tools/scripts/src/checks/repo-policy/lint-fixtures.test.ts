// The checks of the fixtures that show a lint rule, a tsconfig flag, a layer or an Effect rule is on
// (./lint-fixtures.ts), each called alone on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import {
  domainFixture,
  moduleFixture,
  packageFiles,
  passingRepo,
  runtimeFixture,
} from "./fixtures/passing-repo.ts";
import { failuresOf, json, noModules, repo } from "./fixtures/repo.ts";
import {
  domainPurity,
  effectBoundaries,
  lintRulesHaveFixtures,
  moduleBoundaries,
  projectTsconfigs,
  tsconfigFlagsHaveFixtures,
} from "./lint-fixtures.ts";

const base = passingRepo;

describe("検出力 (#43): error の lint 規則のすべてに fixture があること", () => {
  const violations = failuresOf(lintRulesHaveFixtures);
  const config = base["vite.config.ts"] ?? "";
  const noFixture = (rule: string) =>
    `vite.config.ts sets ${rule} to error, but no fixture has \`oxlint-disable-next-line ${rule}\`. Add a line that the rule must report to a file in a __fixtures__/ directory of the project the rule is for, such as apps/api/src/__fixtures__/typed-rules.ts, so that turning the rule off, or an override that stops reaching the file, fails \`vp check\` (docs/tooling/ci.md ("lint の規則と tsconfig のフラグの fixture")).`;
  const withRules = (rules: string) =>
    config.replace("    overrides: [", `${rules}\n    overrides: [`);
  const fixture = (text: string, path = "apps/api/src/__fixtures__/more.ts") => ({ [path]: text });

  it.each([
    ["a rule", '"no-console": "error",'],
    ["a rule with options", '"no-console": ["error", { allow: ["warn"] }],'],
    ["a rule written with a line break after the bracket", '"no-console": [\n"error"],'],
    ["a rule on one line with others", 'rules: { "x/y": "off", "no-console": "error" },'],
    ["a rule with a space before the colon", '"no-console" : "error",'],
    ["a rule with no space after the colon", '"no-console":"error",'],
  ])("%s の fixture を求めること", (_, rule) => {
    expect(violations(repo({ "vite.config.ts": withRules(rule) }))).toEqual([
      noFixture("no-console"),
    ]);
  });

  it("fixture のない規則を、設定の順に 1 回ずつ挙げること", () => {
    const rules = '"b/second": "error",\n"a/first": ["error"],\n"b/second": "error",';
    expect(violations(repo({ "vite.config.ts": withRules(rules) }))).toEqual([
      noFixture("b/second"),
      noFixture("a/first"),
    ]);
  });

  it.each(["off", "warn"])("%s の規則には何も求めないこと", (severity) => {
    const rules = `"no-console": "${severity}",\n"x/y": ["${severity}", "error"],`;
    expect(violations(repo({ "vite.config.ts": withRules(rules) }))).toEqual([]);
  });

  it.each([
    ["a // comment", "// oxlint-disable-next-line no-console -- fixture\nconsole.log(1);\n"],
    ["a /* */ comment", "/* oxlint-disable-next-line no-console -- fixture */\nconsole.log(1);\n"],
    ["a comment in JSX braces", "{/* oxlint-disable-next-line no-console -- fixture */}\n"],
    ["an indented comment", "function f() {\n  // oxlint-disable-next-line no-console -- r\n}\n"],
    ["a comment with no reason", "// oxlint-disable-next-line no-console\nconsole.log(1);\n"],
    [
      "a comment with the rule last of several",
      "// oxlint-disable-next-line a/b, no-console -- r\n",
    ],
    [
      "a comment with the rule first of several",
      "// oxlint-disable-next-line no-console,a/b -- r\n",
    ],
    ["a /* */ comment of several rules", "/* oxlint-disable-next-line a/b, no-console */\n"],
    ["a /* */ comment closed with no space", "/* oxlint-disable-next-line no-console*/\n"],
    ["a /* */ comment of CRLF line ends", "/* oxlint-disable-next-line no-console */\r\nx;\r\n"],
    ["a /* */ comment with blanks after it", "/* oxlint-disable-next-line no-console */ \t\n"],
    [
      "a comment in JSX braces with a space before the brace",
      "{/* oxlint-disable-next-line no-console */ }\n",
    ],
    [
      "a comment in JSX braces with a space after the brace",
      "{ /* oxlint-disable-next-line no-console */}\n",
    ],
    [
      "a JSX comment with a blank after the brace",
      "{/* oxlint-disable-next-line no-console */} \n",
    ],
    ["a comment with no space after //", "//oxlint-disable-next-line no-console -- r\n"],
    ["a comment with several spaces", "//   oxlint-disable-next-line   no-console -- r\n"],
    ["a comment whose reason is only the separator", "// oxlint-disable-next-line no-console --\n"],
    [
      "a comment in a file with CRLF line ends",
      "// oxlint-disable-next-line no-console -- r\r\nx;\r\n",
    ],
  ])("fixture の %s を受け付けること", (_, text) => {
    expect(
      violations(repo({ "vite.config.ts": withRules('"no-console": "error",'), ...fixture(text) })),
    ).toEqual([]);
  });

  it.each([
    ["the name of another rule", "// oxlint-disable-next-line no-console-log -- r\n"],
    ["a longer name that ends the same", "// oxlint-disable-next-line my/no-console -- r\n"],
    ["a rule named only in the reason", "// oxlint-disable-next-line a/b -- no-console\n"],
    [
      "a rule named after the reason of another",
      "// oxlint-disable-next-line a/b -- r, no-console\n",
    ],
    [
      "a rule before a */ in the middle of the list",
      "/* oxlint-disable-next-line no-console */, a/b */\n",
    ],
    ["oxlint-disable-line", "// oxlint-disable-line no-console -- r\n"],
    ["oxlint-disable", "// oxlint-disable no-console -- r\n"],
    [
      "a comment that does not start its line",
      "const a = 1; // oxlint-disable-next-line no-console\n",
    ],
    ["a comment inside a string", "const a = '// oxlint-disable-next-line no-console -- r';\n"],
  ])("%s を拒否すること", (_, text) => {
    expect(
      violations(repo({ "vite.config.ts": withRules('"no-console": "error",'), ...fixture(text) })),
    ).toEqual([noFixture("no-console")]);
  });

  const annotation = "// oxlint-disable-next-line no-console -- fixture\n";
  it.each([
    "apps/web/src/__fixtures__/console.ts",
    "apps/web/src/__fixtures__/console.tsx",
    "tools/scripts/src/test/fixtures/console.test.ts",
    "packages/module-fixtures/src/domain/__fixtures__/deeper/console.ts",
    "__fixtures__/console.ts",
  ])("%s の中のコメントを数えること", (path) => {
    expect(
      violations(
        repo({ "vite.config.ts": withRules('"no-console": "error",'), [path]: annotation }),
      ),
    ).toEqual([]);
  });

  it.each([
    "apps/web/src/console.ts",
    "apps/web/src/fixtures-console.ts",
    "apps/web/src/__fixtures__/console.md",
    "apps/web/src/__fixtures__/console.js",
    "apps/web/src/__fixtures__/console.ts.snap",
    "apps/web/src/xfixtures/console.ts",
    "tools/scripts/src/checks/repo-policy/fixtures/console.ts",
    "tools/scripts/src/checks/other/__fixtures__/console.ts",
  ])("%s の中のコメントを数えないこと", (path) => {
    expect(
      violations(
        repo({ "vite.config.ts": withRules('"no-console": "error",'), [path]: annotation }),
      ),
    ).toEqual([noFixture("no-console")]);
  });

  it("vite.config.ts がないとき、何も求めないこと", () => {
    expect(violations(repo({ "vite.config.ts": undefined }))).toEqual([]);
  });

  it.each(["import/no-nodejs-modules", "no-restricted-imports", "no-restricted-globals"])(
    "%s の唯一の fixture がなくなったリポジトリを拒否すること",
    (rule) => {
      const files = Object.fromEntries(
        Object.entries(base)
          .filter(([path]) => /\/__fixtures__\//.test(path))
          .map(([path, text]) => [path, text.replaceAll(`next-line ${rule} `, "next-line x/y ")]),
      );
      expect(
        violations(repo(files)).filter((message) => message.startsWith("vite.config.ts sets")),
      ).toEqual([noFixture(rule)]);
    },
  );
});

describe("ADR 0020: 有効な tsconfig のフラグのすべてに fixture があること", () => {
  const violations = failuresOf(tsconfigFlagsHaveFixtures);
  const noFixture = (flag: string) =>
    `tsconfig.json turns on ${flag}, but no fixture has \`@ts-expect-error -- fixture: ${flag}\`. Add a line that the flag makes an error, in the form \`-- fixture: ${flag}: <why>\`, to apps/api/src/__fixtures__/tsconfig-flags.ts, so that removing the flag fails \`vp check\` (docs/tooling/ci.md ("lint の規則と tsconfig のフラグの fixture")).`;
  const tsconfig = (options: Record<string, unknown>) =>
    json({ compilerOptions: { noEmit: true, ...options } });
  const flagsFile = "apps/api/src/__fixtures__/tsconfig-flags.ts";
  const flagsFixture = (...flags: string[]) =>
    flags
      .map((flag) => `// @ts-expect-error -- fixture: ${flag}: why\nexport const x = 1;`)
      .join("\n");

  it("どの fixture も名指さないフラグを求めること", () => {
    expect(
      violations(repo({ "tsconfig.json": tsconfig({ strict: true, noImplicitAny: true }) })),
    ).toEqual([noFixture("noImplicitAny")]);
  });

  it("tsconfig.json がないとき、何も求めないこと", () => {
    expect(violations(repo({ "tsconfig.json": undefined }))).toEqual([]);
  });

  it("JSON として正しくない tsconfig.json を報告し、何も求めないこと", () => {
    expect(
      violations(repo({ "tsconfig.json": '{ "compilerOptions": { "strict": true, }' })),
    ).toEqual([expect.stringMatching(/^tsconfig\.json is not valid JSON \(/)]);
  });

  // Each flag with the value that turns its check on.
  it.each([
    ["allowUnreachableCode", false],
    ["allowUnusedLabels", false],
    ["alwaysStrict", true],
    ["erasableSyntaxOnly", true],
    ["exactOptionalPropertyTypes", true],
    ["noFallthroughCasesInSwitch", true],
    ["noImplicitAny", true],
    ["noImplicitOverride", true],
    ["noImplicitReturns", true],
    ["noImplicitThis", true],
    ["noPropertyAccessFromIndexSignature", true],
    ["noUncheckedIndexedAccess", true],
    ["noUncheckedSideEffectImports", true],
    ["noUnusedLocals", true],
    ["noUnusedParameters", true],
    ["strict", true],
    ["strictBindCallApply", true],
    ["strictBuiltinIteratorReturn", true],
    ["strictFunctionTypes", true],
    ["strictNullChecks", true],
    ["strictPropertyInitialization", true],
    ["useUnknownInCatchVariables", true],
    ["verbatimModuleSyntax", true],
  ])("%s を検査のフラグとして知り、その fixture で満たされること", (flag, on) => {
    const tsconfigText = tsconfig({ [flag]: on });
    expect(violations(repo({ "tsconfig.json": tsconfigText, [flagsFile]: "" }))).toEqual([
      noFixture(flag),
    ]);
    expect(
      violations(repo({ "tsconfig.json": tsconfigText, [flagsFile]: flagsFixture(flag) })),
    ).toEqual([]);
  });

  it("有効なフラグだけを求め、無効なフラグや何も検査しないフラグを求めないこと", () => {
    const options = {
      noEmit: true,
      skipLibCheck: true,
      module: "nodenext",
      noUnusedLocals: false,
      allowUnreachableCode: true,
    };
    expect(violations(repo({ "tsconfig.json": tsconfig(options), [flagsFile]: "" }))).toEqual([]);
  });

  it("allowUnreachableCode と allowUnusedLabels が false のとき求めること", () => {
    expect(
      violations(
        repo({
          "tsconfig.json": tsconfig({ allowUnreachableCode: false, allowUnusedLabels: false }),
          [flagsFile]: "",
        }),
      ),
    ).toEqual([noFixture("allowUnreachableCode"), noFixture("allowUnusedLabels")]);
  });

  it("コメントがインデントされた tsconfig.json を読み、文字列の中の // を残すこと", () => {
    const text =
      '{\n    // a comment\n  "compilerOptions": {\n\t// another\n    "strict": true,\n    "rootDir": "https://x"\n  }\n}\n';
    expect(violations(repo({ "tsconfig.json": text, [flagsFile]: "" }))).toEqual([
      noFixture("strict"),
    ]);
  });

  it.each([
    [
      "a name in a line that is not a @ts-expect-error",
      "// fixture: strict\nexport const x = 1;\n",
    ],
    ["a flag with a longer name", flagsFixture("strictNullChecks")],
    ["a flag whose name ends the same", flagsFixture("alwaysstrict", "xstrict")],
    ["a @ts-ignore", "// @ts-ignore -- fixture: strict\n"],
    [
      "a name in the reason of another flag",
      "// @ts-expect-error -- fixture: noImplicitAny: strict\n",
    ],
    ["a @ts-expect-error without the fixture form", "// @ts-expect-error -- strict\n"],
    ["a @ts-expect-error without a separator", "// @ts-expect-error fixture: strict\n"],
  ])("%s を拒否すること", (_, text) => {
    expect(
      violations(repo({ "tsconfig.json": tsconfig({ strict: true }), [flagsFile]: text })),
    ).toEqual([noFixture("strict")]);
  });

  it.each([
    "// @ts-expect-error -- fixture: strict\n",
    "// @ts-expect-error -- fixture: strict: the parameter has no type\n",
    "  // @ts-expect-error   --   fixture:   strict (noImplicitAny)\n",
  ])("%j に挙げたフラグを受け付けること", (text) => {
    expect(
      violations(repo({ "tsconfig.json": tsconfig({ strict: true }), [flagsFile]: text })),
    ).toEqual([]);
  });

  it("どの __fixtures__/ ディレクトリの fixture も数え、その外のものを数えないこと", () => {
    const options = { "tsconfig.json": tsconfig({ strict: true }), [flagsFile]: undefined };
    const text = flagsFixture("strict");
    expect(
      violations(repo({ ...options, "packages/module-fixtures/src/__fixtures__/flags.ts": text })),
    ).toEqual([]);
    expect(violations(repo({ ...options, "apps/api/src/flags.ts": text }))).toEqual([
      noFixture("strict"),
    ]);
    expect(
      violations(repo({ ...options, "tools/scripts/src/checks/x/fixtures/flags.ts": text })),
    ).toEqual([noFixture("strict")]);
  });
});

describe("ADR 0020: project の tsconfig.json が、検査のフラグをルートから採ること", () => {
  const violations = failuresOf(projectTsconfigs);
  const extendsRoot = (depth: number) => `${"../".repeat(depth)}tsconfig.json`;
  const project = (path: string, tsconfig: Record<string, unknown>) => ({
    [path]: json(tsconfig),
  });

  it("ルートを extends し、runtime だけを設定する project を通すこと", () => {
    expect(
      violations(
        repo(
          project("apps/web/tsconfig.json", {
            extends: extendsRoot(2),
            compilerOptions: { target: "es2022", lib: ["dom"], jsx: "react-jsx", module: "esnext" },
          }),
        ),
      ),
    ).toEqual([]);
  });

  it("compilerOptions のない project を通すこと", () => {
    expect(
      violations(repo(project("apps/web/tsconfig.json", { extends: extendsRoot(2) }))),
    ).toEqual([]);
  });

  it.each([
    ["no extends", {}],
    ["an extends that is not the root", { extends: "../tsconfig.base.json" }],
    ["an extends of the wrong depth", { extends: extendsRoot(1) }],
    ["an extends that is not a string", { extends: ["../../tsconfig.json"] }],
  ])("%s のある project を拒否すること", (_, tsconfig) => {
    expect(violations(repo(project("apps/web/tsconfig.json", tsconfig)))).toEqual([
      'apps/web/tsconfig.json must have "extends": "../../tsconfig.json", or the strictness of the root tsconfig.json does not reach it (docs/adr/0020).',
    ]);
  });

  it("project の深さに従うこと", () => {
    expect(
      violations(repo(project("tools/x/y/tsconfig.json", { extends: extendsRoot(3) }))),
    ).toEqual([]);
    expect(
      violations(repo(project("tools/x/y/tsconfig.json", { extends: extendsRoot(2) }))),
    ).toEqual([
      'tools/x/y/tsconfig.json must have "extends": "../../../tsconfig.json", or the strictness of the root tsconfig.json does not reach it (docs/adr/0020).',
    ]);
  });

  it.each([
    ["strict", false],
    ["noUncheckedIndexedAccess", false],
    ["allowUnreachableCode", true],
  ])("%s を設定する project を拒否すること", (flag, value) => {
    expect(
      violations(
        repo(
          project("apps/web/tsconfig.json", {
            extends: extendsRoot(2),
            compilerOptions: { target: "es2022", [flag]: value },
          }),
        ),
      ),
    ).toEqual([
      `apps/web/tsconfig.json sets ${flag}. A project sets its runtime only; put a checking flag in the root tsconfig.json, where apps/api/src/__fixtures__/tsconfig-flags.ts shows it (docs/adr/0020).`,
    ]);
  });

  it("各 project の問題を、それぞれ挙げること", () => {
    expect(
      violations(
        repo({
          ...project("apps/web/tsconfig.json", {
            compilerOptions: { strict: false, noImplicitAny: false },
          }),
          ...project("packages/claim/tsconfig.json", {
            extends: extendsRoot(2),
            compilerOptions: { strict: false },
          }),
        }),
      ),
    ).toEqual([
      'apps/web/tsconfig.json must have "extends": "../../tsconfig.json", or the strictness of the root tsconfig.json does not reach it (docs/adr/0020).',
      "apps/web/tsconfig.json sets strict. A project sets its runtime only; put a checking flag in the root tsconfig.json, where apps/api/src/__fixtures__/tsconfig-flags.ts shows it (docs/adr/0020).",
      "apps/web/tsconfig.json sets noImplicitAny. A project sets its runtime only; put a checking flag in the root tsconfig.json, where apps/api/src/__fixtures__/tsconfig-flags.ts shows it (docs/adr/0020).",
      "packages/claim/tsconfig.json sets strict. A project sets its runtime only; put a checking flag in the root tsconfig.json, where apps/api/src/__fixtures__/tsconfig-flags.ts shows it (docs/adr/0020).",
    ]);
  });

  it("ルートの tsconfig.json を project として検査しないこと", () => {
    expect(
      violations(repo({ "tsconfig.json": json({ compilerOptions: { target: "es2024" } }) })),
    ).toEqual([]);
  });

  it("tsconfig.json のコメントを読むこと", () => {
    const text = '{\n  // a comment\n  "compilerOptions": {}\n}\n';
    expect(violations(repo({ "apps/web/tsconfig.json": text }))).toEqual([
      'apps/web/tsconfig.json must have "extends": "../../tsconfig.json", or the strictness of the root tsconfig.json does not reach it (docs/adr/0020).',
    ]);
  });

  it("どの深さでも、tsconfig.json という名前のファイルだけを検査すること", () => {
    expect(violations(repo(project("apps/web/tsconfig.app.json", {})))).toEqual([]);
    expect(violations(repo(project("apps/web/xtsconfig.json", {})))).toEqual([]);
  });
});

describe("ADR 0026: packages/ のいずれかの package に、各 override の fixture があること", () => {
  const violations = failuresOf(moduleBoundaries);
  const config = base["vite.config.ts"] ?? "";
  const noFixture = (dir: string) =>
    `No packages/*/${dir}/__fixtures__/ has a fixture with \`oxlint-disable-next-line no-restricted-imports\`, so nothing shows the rule reaches ${dir}/ (docs/adr/0026).`;
  const noRuntime = (annotation: string) =>
    `No packages/*/src/__fixtures__/ has a fixture with \`oxlint-disable-next-line ${annotation}\`, so nothing shows the rule reaches src/ (docs/adr/0007).`;
  const noTest =
    "No packages/*/src/__fixtures__/ has a *.test.ts fixture with `oxlint-disable-next-line no-restricted-imports`, so nothing shows the override of the tests keeps the import restrictions (docs/adr/0007).";
  const noDomainRuntime = (annotation: string) =>
    `No packages/*/src/domain/__fixtures__/runtime-apis.ts has \`oxlint-disable-next-line ${annotation}\`, so nothing shows the override of domain keeps the runtime restrictions (docs/adr/0007).`;
  // Every fixture of module-fixtures, moved to another package.
  const movedTo = (name: string) =>
    Object.fromEntries(
      Object.entries(base).flatMap(([path, text]) => {
        if (!path.startsWith("packages/module-fixtures/src/") || !path.includes("/__fixtures__/"))
          return [];
        return [
          [path, undefined],
          [path.replace("packages/module-fixtures/", `packages/${name}/`), text],
        ];
      }),
    );

  it("どれか 1 つの package の fixture を通すこと: override はどの package にも同じく届く", () => {
    expect(
      violations(
        repo({
          ...packageFiles("approval"),
          ...movedTo("approval"),
        }),
      ),
    ).toEqual([]);
  });

  it("src/ か層の fixture のないリポジトリを拒否すること", () => {
    expect(
      violations(
        repo({
          "packages/module-fixtures/src/__fixtures__/boundaries.ts": undefined,
          "packages/module-fixtures/src/http/__fixtures__/boundaries.ts": undefined,
        }),
      ),
    ).toEqual([noFixture("src"), noFixture("src/http")]);
  });

  it("no-restricted-imports の disable コメントのない fixture を拒否すること", () => {
    expect(
      violations(
        repo({
          "packages/module-fixtures/src/domain/__fixtures__/boundaries.ts":
            '// oxlint-disable-next-line no-console -- fixture\nimport "@x/other";\n',
        }),
      ),
    ).toEqual([noFixture("src/domain")]);
  });

  it("そのディレクトリまたは package の __fixtures__/ の外にある fixture を拒否すること", () => {
    expect(
      violations(
        repo({
          "packages/module-fixtures/src/domain/__fixtures__/boundaries.ts": undefined,
          "packages/module-fixtures/src/domain/boundaries.ts": moduleFixture,
          "packages/module-fixtures/src/domain/deeper/__fixtures__/boundaries.ts": moduleFixture,
          "apps/api/src/domain/__fixtures__/boundaries.ts": moduleFixture,
          "packages/src/domain/__fixtures__/boundaries.ts": moduleFixture,
        }),
      ),
    ).toEqual([noFixture("src/domain")]);
  });

  it("__fixtures__/ の下のディレクトリにある fixture を数えること", () => {
    expect(
      violations(
        repo({
          "packages/module-fixtures/src/domain/__fixtures__/boundaries.ts": undefined,
          "packages/module-fixtures/src/domain/__fixtures__/deeper/boundaries.ts": moduleFixture,
        }),
      ),
    ).toEqual([]);
  });

  it("唯一の package が shared のとき、src/ の fixture だけを求めること", () => {
    expect(
      violations(
        repo({
          ...noModules,
          "packages/module-fixtures/package.json": undefined,
          ...Object.fromEntries(
            Object.keys(base)
              .filter((path) => /^packages\/module-fixtures\/src\/[^/]+\/__fixtures__\//.test(path))
              .map((path) => [path, undefined]),
          ),
        }),
      ),
    ).toEqual([]);
    expect(
      violations(
        repo({
          ...noModules,
          "packages/module-fixtures/package.json": undefined,
          "packages/module-fixtures/src/__fixtures__/boundaries.ts": undefined,
        }),
      ),
    ).toEqual([noFixture("src")]);
  });

  it("packages/ の下に package がないとき、何も求めないこと", () => {
    expect(
      violations(
        repo({
          ...noModules,
          "packages/module-fixtures/package.json": undefined,
          "packages/shared-kernel/package.json": undefined,
          // The rules of vite.config.ts still need their fixtures, outside packages/.
          "apps/api/src/__fixtures__/rules.ts": `${runtimeFixture}${moduleFixture}`,
          ...Object.fromEntries(
            Object.keys(base)
              .filter((path) => path.startsWith("packages/module-fixtures/src/"))
              .map((path) => [path, undefined]),
          ),
        }),
      ),
    ).toEqual([]);
  });

  it("runtime の禁止かテストの fixture のないリポジトリを拒否すること", () => {
    expect(
      violations(
        repo({
          "packages/module-fixtures/src/__fixtures__/runtime-apis.ts": runtimeFixture.replace(
            "no-restricted-properties",
            "no-console",
          ),
          "packages/module-fixtures/src/__fixtures__/boundaries.test.ts": undefined,
        }),
      ),
    ).toEqual([noTest, noRuntime("no-restricted-properties")]);
    expect(
      violations(repo({ "packages/module-fixtures/src/__fixtures__/runtime-apis.ts": undefined })),
    ).toEqual([
      noRuntime("no-restricted-globals"),
      noRuntime("no-restricted-properties"),
      noRuntime("import/no-nodejs-modules"),
    ]);
  });

  it("runtime の禁止にテストファイルを、テストにそれ以外のファイルを数えないこと", () => {
    expect(
      violations(
        repo({
          "packages/module-fixtures/src/__fixtures__/runtime-apis.ts": undefined,
          "packages/module-fixtures/src/__fixtures__/runtime-apis.test.ts": runtimeFixture,
          "packages/module-fixtures/src/__fixtures__/boundaries.test.ts": undefined,
          "packages/module-fixtures/src/__fixtures__/more.ts": moduleFixture,
        }),
      ),
    ).toEqual([
      noTest,
      noRuntime("no-restricted-globals"),
      noRuntime("no-restricted-properties"),
      noRuntime("import/no-nodejs-modules"),
    ]);
  });

  it("fixture が runtime の禁止を示さない domain を拒否すること", () => {
    const runtime = "packages/module-fixtures/src/domain/__fixtures__/runtime-apis.ts";
    expect(violations(repo({ [runtime]: undefined }))).toEqual([
      noDomainRuntime("no-restricted-globals"),
      noDomainRuntime("no-restricted-properties"),
    ]);
    expect(
      violations(
        repo({ [runtime]: runtimeFixture.replace("no-restricted-properties", "no-console") }),
      ),
    ).toEqual([noDomainRuntime("no-restricted-properties")]);
    expect(
      violations(
        repo({
          [runtime]: undefined,
          "packages/module-fixtures/src/domain/__fixtures__/other.ts": runtimeFixture,
        }),
      ),
    ).toEqual([
      noDomainRuntime("no-restricted-globals"),
      noDomainRuntime("no-restricted-properties"),
    ]);
  });

  it("vite.config.ts が挙げる層に従うこと", () => {
    const threeLayers = config.replace('  http: ["domain"],', '  http: ["domain"],\n  infra: [],');
    expect(violations(repo({ "vite.config.ts": threeLayers }))).toEqual([noFixture("src/infra")]);
  });

  it("vite.config.ts に layers のオブジェクトがないときだけ、src/ の fixture を求めること", () => {
    const none = config.replace("const layers", "const tiers");
    expect(
      violations(
        repo({
          "vite.config.ts": none,
          "packages/module-fixtures/src/domain/__fixtures__/boundaries.ts": undefined,
          "packages/module-fixtures/src/domain/__fixtures__/runtime-apis.ts": undefined,
          "packages/module-fixtures/src/http/__fixtures__/boundaries.ts": undefined,
        }),
      ),
    ).toEqual([]);
  });
});

describe("ADR 0027: いずれかのモジュールに、domain を純粋に保つ規則の fixture があること", () => {
  const violations = failuresOf(domainPurity);
  const config = base["vite.config.ts"] ?? "";
  const purity = "packages/module-fixtures/src/domain/__fixtures__/purity.ts";
  const noFixture = (rule: string) =>
    `No packages/*/src/domain/__fixtures__/ has a fixture with \`oxlint-disable-next-line ${rule}\`, so nothing shows the rule reaches domain/ (docs/adr/0027).`;
  const without = (rule: string) =>
    domainFixture
      .split("\n")
      .filter((line) => !line.includes(`oxlint-disable-next-line ${rule} `))
      .join("\n");

  it.each(["domain/no-throw", "no-restricted-globals", "no-restricted-properties"])(
    "fixture に %s の disable コメントのない domain を拒否すること",
    (rule) => {
      expect(violations(repo({ [purity]: without(rule) }))).toEqual([noFixture(rule)]);
    },
  );

  it("fixture のないすべての規則を、規則の順に挙げること", () => {
    expect(violations(repo({ [purity]: undefined }))).toEqual([
      noFixture("domain/no-throw"),
      noFixture("no-restricted-globals"),
      noFixture("no-restricted-properties"),
    ]);
  });

  it("似た名前の規則の disable コメントを拒否すること", () => {
    const similar = domainFixture.replace("domain/no-throw", "other/no-throw");
    expect(violations(repo({ [purity]: similar }))).toEqual([noFixture("domain/no-throw")]);
  });

  it("複数のファイルと複数のモジュールにまたがる fixture を通すこと", () => {
    const lines = domainFixture.split("\n");
    expect(
      violations(
        repo({
          [purity]: lines.slice(0, 2).join("\n"),
          "packages/module-fixtures/src/domain/__fixtures__/clock.ts": lines.slice(2, 4).join("\n"),
          ...packageFiles("approval"),
          "packages/approval/src/domain/__fixtures__/random.ts": lines.slice(4).join("\n"),
        }),
      ),
    ).toEqual([]);
  });

  it("domain の __fixtures__/ の外、または runtime-apis.ts にある fixture を拒否すること", () => {
    expect(
      violations(
        repo({
          [purity]: undefined,
          "packages/module-fixtures/src/domain/purity.ts": domainFixture,
          "packages/module-fixtures/src/http/__fixtures__/purity.ts": domainFixture,
          "packages/module-fixtures/src/domain/deeper/__fixtures__/purity.ts": domainFixture,
          "packages/module-fixtures/src/domain/__fixtures__/runtime-apis.ts": `${runtimeFixture}${domainFixture}`,
        }),
      ),
    ).toEqual([
      noFixture("domain/no-throw"),
      noFixture("no-restricted-globals"),
      noFixture("no-restricted-properties"),
    ]);
  });

  it("vite.config.ts に domain の層がないとき、または唯一の package が shared のとき、何も求めないこと", () => {
    expect(
      violations(
        repo({
          "vite.config.ts": config.replace("  domain: [],\n", ""),
          [purity]: undefined,
          "packages/module-fixtures/src/domain/__fixtures__/boundaries.ts": undefined,
        }),
      ),
    ).toEqual([]);
    expect(
      violations(
        repo({
          ...noModules,
          "packages/module-fixtures/package.json": undefined,
          [purity]: undefined,
          "packages/module-fixtures/src/domain/__fixtures__/boundaries.ts": undefined,
          "packages/module-fixtures/src/domain/__fixtures__/runtime-apis.ts": undefined,
          "packages/module-fixtures/src/http/__fixtures__/boundaries.ts": undefined,
        }),
      ),
    ).toEqual([]);
  });
});

describe("ADR 0028: application と infrastructure に、Effect の規則の fixture があること", () => {
  const violations = failuresOf(effectBoundaries);
  const config = base["vite.config.ts"] ?? "";
  const withLayers = (layers: string) =>
    config.replace('  http: ["domain"],', `  http: ["domain"],\n${layers}`);
  const effectTsgo = [
    "// oxlint-disable-next-line effecttsgo/floating-effect -- fixture",
    "// oxlint-disable-next-line effecttsgo/unstable-api-usage -- fixture",
    "// oxlint-disable-next-line effecttsgo/experimental-api-usage -- fixture",
  ].join("\n");
  const viteConfig = [
    "// oxlint-disable-next-line no-restricted-properties -- fixture",
    "// oxlint-disable-next-line no-restricted-imports -- fixture",
  ].join("\n");
  const fixtures = (layer: string) => ({
    [`packages/module-fixtures/src/${layer}/__fixtures__/effect-tsgo.ts`]: effectTsgo,
    [`packages/module-fixtures/src/${layer}/__fixtures__/effect.ts`]: viteConfig,
  });
  const missing = (layer: string, file: string, comment: string) =>
    `No packages/*/src/${layer}/__fixtures__/${file} has \`oxlint-disable-next-line ${comment}\`, so nothing shows the rule reaches ${layer}/ (docs/adr/0028).`;
  const both = withLayers("  application: [],\n  infrastructure: [],");

  it("vite.config.ts にどちらの層もないとき、何も求めないこと", () => {
    expect(violations(repo())).toEqual([]);
  });

  it("層が両方の fixture を持つモジュールを通すこと", () => {
    expect(
      violations(
        repo({
          "vite.config.ts": both,
          ...fixtures("application"),
          ...fixtures("infrastructure"),
          "packages/module-fixtures/src/application/__fixtures__/boundaries.ts": moduleFixture,
          "packages/module-fixtures/src/infrastructure/__fixtures__/boundaries.ts": moduleFixture,
        }),
      ),
    ).toEqual([]);
  });

  it("fixture が 1 つもない層に、すべての fixture を求めること", () => {
    expect(
      violations(
        repo({
          "vite.config.ts": withLayers("  application: [],"),
          "packages/module-fixtures/src/application/__fixtures__/boundaries.ts": moduleFixture,
        }),
      ),
    ).toEqual([
      missing("application", "effect-tsgo.ts", "effecttsgo/floating-effect"),
      missing("application", "effect-tsgo.ts", "effecttsgo/unstable-api-usage"),
      missing("application", "effect-tsgo.ts", "effecttsgo/experimental-api-usage"),
      missing("application", "effect.ts", "no-restricted-properties"),
      missing("application", "effect.ts", "no-restricted-imports"),
    ]);
  });

  it("disable コメントのない規則を 1 つ挙げること", () => {
    expect(
      violations(
        repo({
          "vite.config.ts": withLayers("  infrastructure: [],"),
          ...fixtures("infrastructure"),
          "packages/module-fixtures/src/infrastructure/__fixtures__/effect-tsgo.ts":
            effectTsgo.replace("effecttsgo/unstable-api-usage", "effecttsgo/other"),
          "packages/module-fixtures/src/infrastructure/__fixtures__/boundaries.ts": moduleFixture,
        }),
      ),
    ).toEqual([missing("infrastructure", "effect-tsgo.ts", "effecttsgo/unstable-api-usage")]);
  });

  it("各コメントをそれ自身のファイルで読むこと", () => {
    expect(
      violations(
        repo({
          "vite.config.ts": withLayers("  application: [],"),
          "packages/module-fixtures/src/application/__fixtures__/effect-tsgo.ts": `${effectTsgo}\n${viteConfig}`,
          "packages/module-fixtures/src/application/__fixtures__/boundaries.ts": moduleFixture,
        }),
      ),
    ).toEqual([
      missing("application", "effect.ts", "no-restricted-properties"),
      missing("application", "effect.ts", "no-restricted-imports"),
    ]);
  });

  it("ルートの packages/ の下にある package の package.json だけを、1 回求めること", () => {
    expect(
      violations(
        repo({
          "vite.config.ts": withLayers("  application: [],"),
          "packages/module-fixtures/src/application/__fixtures__/boundaries.ts": moduleFixture,
          "vendor/packages/other/package.json": "{}",
          "packages/claim/package.json.bak": "{}",
        }),
      ),
    ).toEqual([
      missing("application", "effect-tsgo.ts", "effecttsgo/floating-effect"),
      missing("application", "effect-tsgo.ts", "effecttsgo/unstable-api-usage"),
      missing("application", "effect-tsgo.ts", "effecttsgo/experimental-api-usage"),
      missing("application", "effect.ts", "no-restricted-properties"),
      missing("application", "effect.ts", "no-restricted-imports"),
    ]);
  });

  it("唯一の package が shared のとき、何も求めないこと", () => {
    expect(
      violations(
        repo({
          "vite.config.ts": both,
          ...noModules,
          "packages/module-fixtures/package.json": undefined,
          ...Object.fromEntries(
            Object.keys(base)
              .filter((path) => /^packages\/module-fixtures\/src\/[^/]+\/__fixtures__\//.test(path))
              .map((path) => [path, undefined]),
          ),
        }),
      ),
    ).toEqual([]);
  });

  it("shared には求めないこと", () => {
    expect(
      violations(
        repo({
          "vite.config.ts": both,
          ...fixtures("application"),
          ...fixtures("infrastructure"),
          "packages/module-fixtures/src/application/__fixtures__/boundaries.ts": moduleFixture,
          "packages/module-fixtures/src/infrastructure/__fixtures__/boundaries.ts": moduleFixture,
          ...packageFiles("shared-kernel"),
        }),
      ),
    ).toEqual([]);
  });
});

describe("ADR 0026: 辺", () => {
  const violations = failuresOf(moduleBoundaries);
  const config = base["vite.config.ts"] ?? "";
  const noFixture = (dir: string) =>
    `No packages/*/${dir}/__fixtures__/ has a fixture with \`oxlint-disable-next-line no-restricted-imports\`, so nothing shows the rule reaches ${dir}/ (docs/adr/0026).`;
  // The repository that passes with `config` for its vite.config.ts and no fixture of a layer, so that every
  // layer that the check reads from the config is named in a failure.
  const layersOf = (text: string) =>
    violations(
      repo({
        "vite.config.ts": text,
        ...Object.fromEntries(
          Object.keys(base)
            .filter((path) => /^packages\/module-fixtures\/src\/[^/]+\/__fixtures__\//.test(path))
            .map((path) => [path, undefined]),
        ),
      }),
    );
  const withBody = (body: string) =>
    config.replace('{\n  domain: [],\n  http: ["domain"],\n}', `{${body}}`);
  // layers after a line of another const, so that only the multiline `^` finds it.
  const after = (text: string) => text.replace("const scope", "let x;\nconst scope");

  it.each([
    ["a quoted key", '\n  "foo-bar": [],\n', ["foo-bar"]],
    ["a key of digits and an underscore", "\n  a_2: [],\n", ["a_2"]],
    ["keys on one line", ' a: ["b"], b: [] ', ["a", "b"]],
    ["a space before the colon", "\n  c : [],\n", ["c"]],
  ])("%s を読むこと", (_, body, layers) => {
    expect(layersOf(after(withBody(body)))).toEqual(
      layers.map((layer) => noFixture(`src/${layer}`)),
    );
  });

  it("最上位の `const layers` だけを読み、インデントされたものや長い名前のものを読まないこと", () => {
    const others = `const layers2 = { a: [] };\n${config.replace("const layers", "  const layers")}`;
    expect(layersOf(others)).toEqual([]);
  });

  it.each([
    "apps/packages/approval/package.json",
    "packages/approval/package.json.orig",
    "packages/claim/nested/package.json",
  ])("packages/ の下の package のマニフェストではない %s を通すこと", (path) => {
    expect(violations(repo({ [path]: "{}" }))).toEqual([]);
  });
});
