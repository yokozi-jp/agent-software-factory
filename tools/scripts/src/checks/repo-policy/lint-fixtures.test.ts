// The checks of the fixtures that show a lint rule, a tsconfig flag, a layer or an Effect rule is on (./lint-fixtures.ts), each called on a small repository held in memory: a case breaks one file of
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

describe("Detection power (#43): every lint rule that is an error has a fixture", () => {
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
  ])("asks for the fixture of %s", (_, rule) => {
    expect(violations(repo({ "vite.config.ts": withRules(rule) }))).toEqual([
      noFixture("no-console"),
    ]);
  });

  it("names each rule without a fixture once, in the order of the config", () => {
    const rules = '"b/second": "error",\n"a/first": ["error"],\n"b/second": "error",';
    expect(violations(repo({ "vite.config.ts": withRules(rules) }))).toEqual([
      noFixture("b/second"),
      noFixture("a/first"),
    ]);
  });

  it.each(["off", "warn"])("asks for nothing for a rule that is %s", (severity) => {
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
  ])("accepts %s in a fixture", (_, text) => {
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
  ])("refuses %s", (_, text) => {
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
  ])("counts the comment in %s", (path) => {
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
  ])("does not count the comment in %s", (path) => {
    expect(
      violations(
        repo({ "vite.config.ts": withRules('"no-console": "error",'), [path]: annotation }),
      ),
    ).toEqual([noFixture("no-console")]);
  });

  it("asks for nothing when vite.config.ts is missing", () => {
    expect(violations(repo({ "vite.config.ts": undefined }))).toEqual([]);
  });

  it.each(["import/no-nodejs-modules", "no-restricted-imports", "no-restricted-globals"])(
    "refuses a repository whose only fixture of %s is gone",
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

describe("ADR 0020: every tsconfig flag that is on has a fixture", () => {
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

  it("asks for a flag that no fixture names", () => {
    expect(
      violations(repo({ "tsconfig.json": tsconfig({ strict: true, noImplicitAny: true }) })),
    ).toEqual([noFixture("noImplicitAny")]);
  });

  it("asks for nothing when tsconfig.json is missing", () => {
    expect(violations(repo({ "tsconfig.json": undefined }))).toEqual([]);
  });

  it("reports a tsconfig.json that is not valid JSON, and asks for nothing", () => {
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
  ])("knows %s as a checking flag, and is satisfied by its fixture", (flag, on) => {
    const tsconfigText = tsconfig({ [flag]: on });
    expect(violations(repo({ "tsconfig.json": tsconfigText, [flagsFile]: "" }))).toEqual([
      noFixture(flag),
    ]);
    expect(
      violations(repo({ "tsconfig.json": tsconfigText, [flagsFile]: flagsFixture(flag) })),
    ).toEqual([]);
  });

  it("asks for the flags that are on, not for the ones that are off or that check nothing", () => {
    const options = {
      noEmit: true,
      skipLibCheck: true,
      module: "nodenext",
      noUnusedLocals: false,
      allowUnreachableCode: true,
    };
    expect(violations(repo({ "tsconfig.json": tsconfig(options), [flagsFile]: "" }))).toEqual([]);
  });

  it("asks for allowUnreachableCode and allowUnusedLabels when they are false", () => {
    expect(
      violations(
        repo({
          "tsconfig.json": tsconfig({ allowUnreachableCode: false, allowUnusedLabels: false }),
          [flagsFile]: "",
        }),
      ),
    ).toEqual([noFixture("allowUnreachableCode"), noFixture("allowUnusedLabels")]);
  });

  it("reads a tsconfig.json whose comments are indented, and keeps a // inside a string", () => {
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
  ])("refuses %s", (_, text) => {
    expect(
      violations(repo({ "tsconfig.json": tsconfig({ strict: true }), [flagsFile]: text })),
    ).toEqual([noFixture("strict")]);
  });

  it.each([
    "// @ts-expect-error -- fixture: strict\n",
    "// @ts-expect-error -- fixture: strict: the parameter has no type\n",
    "  // @ts-expect-error   --   fixture:   strict (noImplicitAny)\n",
  ])("accepts the flag named in %j", (text) => {
    expect(
      violations(repo({ "tsconfig.json": tsconfig({ strict: true }), [flagsFile]: text })),
    ).toEqual([]);
  });

  it("counts a fixture in any __fixtures__/ directory, and not one outside", () => {
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

describe("ADR 0020: a project tsconfig.json takes the checking flags from the root", () => {
  const violations = failuresOf(projectTsconfigs);
  const extendsRoot = (depth: number) => `${"../".repeat(depth)}tsconfig.json`;
  const project = (path: string, tsconfig: Record<string, unknown>) => ({
    [path]: json(tsconfig),
  });

  it("passes a project that extends the root and sets its runtime only", () => {
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

  it("passes a project with no compilerOptions", () => {
    expect(
      violations(repo(project("apps/web/tsconfig.json", { extends: extendsRoot(2) }))),
    ).toEqual([]);
  });

  it.each([
    ["no extends", {}],
    ["an extends that is not the root", { extends: "../tsconfig.base.json" }],
    ["an extends of the wrong depth", { extends: extendsRoot(1) }],
    ["an extends that is not a string", { extends: ["../../tsconfig.json"] }],
  ])("refuses a project with %s", (_, tsconfig) => {
    expect(violations(repo(project("apps/web/tsconfig.json", tsconfig)))).toEqual([
      'apps/web/tsconfig.json must have "extends": "../../tsconfig.json", or the strictness of the root tsconfig.json does not reach it (docs/adr/0020).',
    ]);
  });

  it("follows the depth of the project", () => {
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
  ])("refuses a project that sets %s", (flag, value) => {
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

  it("names each problem of each project", () => {
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

  it("does not check the root tsconfig.json as a project", () => {
    expect(
      violations(repo({ "tsconfig.json": json({ compilerOptions: { target: "es2024" } }) })),
    ).toEqual([]);
  });

  it("reads the comments of a tsconfig.json", () => {
    const text = '{\n  // a comment\n  "compilerOptions": {}\n}\n';
    expect(violations(repo({ "apps/web/tsconfig.json": text }))).toEqual([
      'apps/web/tsconfig.json must have "extends": "../../tsconfig.json", or the strictness of the root tsconfig.json does not reach it (docs/adr/0020).',
    ]);
  });

  it("checks a file named tsconfig.json only, at any depth", () => {
    expect(violations(repo(project("apps/web/tsconfig.app.json", {})))).toEqual([]);
    expect(violations(repo(project("apps/web/xtsconfig.json", {})))).toEqual([]);
  });
});

describe("ADR 0026: some package under packages/ has the fixtures of each override", () => {
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

  it("passes the fixtures in any one package: an override reaches every package alike", () => {
    expect(
      violations(
        repo({
          ...packageFiles("approval"),
          ...movedTo("approval"),
        }),
      ),
    ).toEqual([]);
  });

  it("refuses a repository without the fixture of src/ or of a layer", () => {
    expect(
      violations(
        repo({
          "packages/module-fixtures/src/__fixtures__/boundaries.ts": undefined,
          "packages/module-fixtures/src/http/__fixtures__/boundaries.ts": undefined,
        }),
      ),
    ).toEqual([noFixture("src"), noFixture("src/http")]);
  });

  it("refuses a fixture without the disable comment of no-restricted-imports", () => {
    expect(
      violations(
        repo({
          "packages/module-fixtures/src/domain/__fixtures__/boundaries.ts":
            '// oxlint-disable-next-line no-console -- fixture\nimport "@x/other";\n',
        }),
      ),
    ).toEqual([noFixture("src/domain")]);
  });

  it("refuses a fixture that is outside __fixtures__/ of its directory, or of a package", () => {
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

  it("counts a fixture in a directory under __fixtures__/", () => {
    expect(
      violations(
        repo({
          "packages/module-fixtures/src/domain/__fixtures__/boundaries.ts": undefined,
          "packages/module-fixtures/src/domain/__fixtures__/deeper/boundaries.ts": moduleFixture,
        }),
      ),
    ).toEqual([]);
  });

  it("asks only for the fixture of src/ when the only package is shared", () => {
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

  it("asks for nothing when there is no package under packages/", () => {
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

  it("refuses a repository without the fixtures of the runtime restrictions or of the tests", () => {
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

  it("does not count a test file for the runtime restrictions, nor another file for the tests", () => {
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

  it("refuses a domain whose fixture does not show the runtime restrictions", () => {
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

  it("follows the layers that vite.config.ts lists", () => {
    const threeLayers = config.replace('  http: ["domain"],', '  http: ["domain"],\n  infra: [],');
    expect(violations(repo({ "vite.config.ts": threeLayers }))).toEqual([noFixture("src/infra")]);
  });

  it("asks for the fixture of src/ only when vite.config.ts has no layers object", () => {
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

describe("ADR 0027: some module has the fixtures of the rules that keep domain pure", () => {
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
    "refuses a domain whose fixtures lack the disable comment of %s",
    (rule) => {
      expect(violations(repo({ [purity]: without(rule) }))).toEqual([noFixture(rule)]);
    },
  );

  it("names every rule that has no fixture, in the order of the rules", () => {
    expect(violations(repo({ [purity]: undefined }))).toEqual([
      noFixture("domain/no-throw"),
      noFixture("no-restricted-globals"),
      noFixture("no-restricted-properties"),
    ]);
  });

  it("refuses a disable comment of a rule of a similar name", () => {
    const similar = domainFixture.replace("domain/no-throw", "other/no-throw");
    expect(violations(repo({ [purity]: similar }))).toEqual([noFixture("domain/no-throw")]);
  });

  it("passes fixtures that are spread over several files, and over several modules", () => {
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

  it("refuses fixtures that are outside __fixtures__/ of domain, or in runtime-apis.ts", () => {
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

  it("asks nothing when vite.config.ts has no domain layer, or when the only package is shared", () => {
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

describe("ADR 0028: application and infrastructure have the fixtures of the Effect rules", () => {
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

  it("asks for nothing when vite.config.ts has neither layer", () => {
    expect(violations(repo())).toEqual([]);
  });

  it("passes a module whose layers have both fixtures", () => {
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

  it("asks a layer for every fixture when it has none", () => {
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

  it("names the one rule whose disable comment is missing", () => {
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

  it("reads each comment in its own file", () => {
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

  it("asks only for the package.json of a package under the root packages/, and once", () => {
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

  it("asks for nothing when the only package is shared", () => {
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

  it("does not ask shared", () => {
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

describe("ADR 0026: the edges", () => {
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
  ])("reads %s", (_, body, layers) => {
    expect(layersOf(after(withBody(body)))).toEqual(
      layers.map((layer) => noFixture(`src/${layer}`)),
    );
  });

  it("reads only a top-level `const layers`, not one indented or of a longer name", () => {
    const others = `const layers2 = { a: [] };\n${config.replace("const layers", "  const layers")}`;
    expect(layersOf(others)).toEqual([]);
  });

  it.each([
    "apps/packages/approval/package.json",
    "packages/approval/package.json.orig",
    "packages/claim/nested/package.json",
  ])("passes %s, which is not the manifest of a package under packages/", (path) => {
    expect(violations(repo({ [path]: "{}" }))).toEqual([]);
  });
});
