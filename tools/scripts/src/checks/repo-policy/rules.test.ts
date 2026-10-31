// The rules of repo-policy, called on a small repository held in memory: each case breaks one file of
// a repository that passes, and expects the message that names the problem. Reading git and the
// working tree (and the staged mode) is in cli.test.ts.
import { describe, expect, it } from "vite-plus/test";
import {
  apiDependencies,
  connectionPassFixture,
  connectionStopFixture,
  consoleFixture,
  domainFixture,
  eventsFiles,
  factoryAgent,
  migration,
  lintRestrictions,
  moduleFixture,
  outboxFixture,
  passingRepo,
  runtimeFixture,
  lintEffect,
  packageFiles,
  packageJson,
  sharedKernelExports,
} from "./fixtures/passing-repo.ts";
import { eventsPackages, modulePackageNames, packageNames, pathsHint } from "./modules.ts";
import { Tree } from "./tree.ts";
import { violations as allViolations, type Repo } from "./rules.ts";

const base = passingRepo;

// The failures about the table of lint restrictions and its fixtures (lintRestrictionsAgree). A test that removes
// the fixtures or the packages would hear about them too, so `violations` leaves them out; the tests of ADR 0050
// call `allViolations`. Every such failure names the table, or is the one template of a missing line.
const tableFailure = (failure: string): boolean =>
  failure.includes("lint-restrictions.json") || failure.includes("を書いた行がない。");
const violations = (repository: Repo): string[] =>
  allViolations(repository).filter((failure) => !tableFailure(failure));

interface Options {
  // Index modes that differ from the default (100755 for *.sh, 100644 otherwise).
  readonly modes?: Record<string, string>;
  readonly untracked?: Record<string, string>;
  readonly viteHooks?: boolean;
}

// A repository with the files of `base`, changed by `files` (undefined removes a file).
function repo(files: Record<string, string | undefined> = {}, options: Options = {}): Repo {
  const merged = new Map<string, string>();
  for (const [path, text] of Object.entries({ ...base, ...files }))
    if (text !== undefined) merged.set(path, text);
  const tracked = new Map(
    [...merged.keys()].map((path) => [
      path,
      options.modes?.[path] ?? (path.endsWith(".sh") ? "100755" : "100644"),
    ]),
  );
  const untracked = Object.entries(options.untracked ?? {});
  for (const [path, text] of untracked) merged.set(path, text);
  return {
    tracked,
    untrackedSteering: untracked.map(([path]) => path),
    viteHooks: options.viteHooks ?? false,
    read: (path) => merged.get(path),
  };
}

const json = (value: unknown): string => JSON.stringify(value, undefined, 2);

// The package.json of apps/api with `fields`, and the modules it depends on (docs/adr/0026).
const apiManifest = (fields: Record<string, unknown> = {}): string =>
  json({ dependencies: apiDependencies, ...fields });

// Files that remove every module of the passing repository, and the failures other than that moduleOrder names
// a module that is gone. A test of the fixtures of the overrides starts from a repository with no module.
const noModules: Record<string, undefined> = {
  "packages/claim/package.json": undefined,
  "packages/approval/package.json": undefined,
  "packages/closing/package.json": undefined,
};
const violationsWithoutOrder = (repository: Repo): string[] =>
  violations(repository).filter((failure) => !failure.includes(" is in moduleOrder in "));

describe("violations", () => {
  it("finds nothing in a repository that keeps every rule", () => {
    expect(violations(repo())).toEqual([]);
  });
});

describe("ADR 0002: Nx runs the tasks", () => {
  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "refuses @nx/vite in %s of any package.json",
    (field) => {
      expect(
        violations(
          repo({
            "apps/api/package.json": apiManifest(
              field === "dependencies"
                ? { dependencies: { ...apiDependencies, "@nx/vite": "24.0.0" } }
                : { [field]: { "@nx/vite": "24.0.0" } },
            ),
          }),
        ),
      ).toEqual([
        "apps/api/package.json depends on @nx/vite. Targets come from package.json scripts (docs/adr/0002).",
      ]);
    },
  );

  it("passes a package.json that names @nx/vite outside its dependencies", () => {
    expect(
      violations(repo({ "apps/api/package.json": apiManifest({ description: "not @nx/vite" }) })),
    ).toEqual([]);
  });

  it("refuses a run block in a vite.config.ts", () => {
    expect(
      violations(
        repo({ "apps/web/vite.config.ts": "export default {\n  run: { cache: true },\n};\n" }),
      ),
    ).toEqual([
      "apps/web/vite.config.ts has a `run` block. Task running and caching belong to Nx (docs/adr/0002).",
    ]);
  });

  it("passes a run key that is not at the top of the config", () => {
    expect(
      violations(
        repo({ "apps/web/vite.config.ts": "export default {\n  test: { run: 1 },\n};\n" }),
      ),
    ).toEqual([]);
  });
});

describe("ADR 0001: lefthook owns the Git hooks", () => {
  const message = ".vite-hooks exists. Git hooks are managed by lefthook.yml (docs/adr/0001).";

  it("refuses a .vite-hooks directory in the working tree", () => {
    expect(violations(repo({}, { viteHooks: true }))).toEqual([message]);
  });

  it("refuses a tracked file in .vite-hooks", () => {
    expect(violations(repo({ ".vite-hooks/pre-commit": "x\n" }))).toEqual([message]);
  });
});

describe("ADR 0003, 0009: one betterleaks version", () => {
  it("refuses a .betterleaks.toml whose minimum version is not the one in mise.toml", () => {
    expect(violations(repo({ "mise.toml": '[tools]\nbetterleaks = "9.9.9"\n' }))).toEqual([
      ".betterleaks.toml betterleaksMinVersion must equal the betterleaks version in mise.toml (9.9.9).",
    ]);
  });

  it.each([
    ["no betterleaks", '[tools]\nshellcheck = "0.11.0"\n'],
    ["a version that is not a string", "[tools]\nbetterleaks = 1\n"],
    ["betterleaks outside [tools]", '[env]\nbetterleaks = "1.9.0"\n'],
  ])("refuses a mise.toml with %s", (_, text) => {
    expect(violations(repo({ "mise.toml": text }))).toEqual([
      "mise.toml must pin betterleaks to an exact version (docs/adr/0009).",
    ]);
  });

  it("reads the version however the TOML is written", () => {
    const mise = "[tools]\n# pinned\n\"betterleaks\"   =   '1.9.0' # v1 only\n";
    expect(violations(repo({ "mise.toml": mise }))).toEqual([]);
  });

  it("refuses a repository without mise.toml", () => {
    expect(violations(repo({ "mise.toml": undefined }))).toEqual([
      "mise.toml must pin betterleaks to an exact version (docs/adr/0009).",
    ]);
  });

  it("refuses a .betterleaks.toml without the minimum version", () => {
    expect(
      violations(repo({ ".betterleaks.toml": "[extend]\nbetterleaksMinVersion = '1.9.0'\n" })),
    ).toEqual([
      ".betterleaks.toml betterleaksMinVersion must equal the betterleaks version in mise.toml (1.9.0).",
    ]);
  });
});

describe("Detection power (#43): every lint rule that is an error has a fixture", () => {
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
      violationsWithoutOrder(
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
      violationsWithoutOrder(
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
      violationsWithoutOrder(
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
      violationsWithoutOrder(
        repo({
          "vite.config.ts": config.replace("  domain: [],\n", ""),
          [purity]: undefined,
          "packages/module-fixtures/src/domain/__fixtures__/boundaries.ts": undefined,
        }),
      ),
    ).toEqual([]);
    expect(
      violationsWithoutOrder(
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
      violationsWithoutOrder(
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

describe("steering frontmatter (docs/knowledge/steering-authoring.md)", () => {
  const guide = "(docs/knowledge/steering-authoring.md)";
  const steering = (frontmatter: string) => ({
    ".kiro/steering/x.md": `---\n${frontmatter}---\n\n# X\n`,
  });

  it("passes each inclusion, and fileMatch with a one-line array", () => {
    for (const inclusion of ["always", "manual", "auto"])
      expect(
        violations(repo(steering(`inclusion: ${inclusion}\nname: x\ndescription: d\n`))),
      ).toEqual([]);
    expect(
      violations(
        repo(
          steering(
            'inclusion: fileMatch\nfileMatchPattern: ["**/*.ts", "a"]\nname: x\ndescription: d\n',
          ),
        ),
      ),
    ).toEqual([]);
  });

  it("refuses a file without frontmatter", () => {
    expect(violations(repo({ ".kiro/steering/x.md": "no frontmatter\n" }))).toEqual([
      `.kiro/steering/x.md: must start with a frontmatter block ${guide}`,
    ]);
  });

  it("refuses frontmatter that is not closed", () => {
    expect(
      violations(
        repo({ ".kiro/steering/x.md": "---\ninclusion: auto\nname: x\ndescription: d\n" }),
      ),
    ).toEqual([`.kiro/steering/x.md: frontmatter is not closed ${guide}`]);
  });

  it("names every missing or wrong field", () => {
    expect(violations(repo(steering("inclusion: sometimes\nname: y\n")))).toEqual([
      `.kiro/steering/x.md: inclusion must be always, fileMatch, manual or auto ${guide}`,
      `.kiro/steering/x.md: name must be "x" ${guide}`,
      `.kiro/steering/x.md: description is required ${guide}`,
    ]);
  });

  it("refuses an empty description", () => {
    expect(violations(repo(steering('inclusion: auto\nname: x\ndescription: ""\n')))).toEqual([
      `.kiro/steering/x.md: description is required ${guide}`,
    ]);
  });

  it("requires fileMatchPattern for fileMatch, and only for fileMatch", () => {
    expect(violations(repo(steering("inclusion: fileMatch\nname: x\ndescription: d\n")))).toEqual([
      `.kiro/steering/x.md: fileMatchPattern is required for inclusion: fileMatch ${guide}`,
    ]);
    expect(
      violations(
        repo(steering('inclusion: auto\nfileMatchPattern: ["a"]\nname: x\ndescription: d\n')),
      ),
    ).toEqual([`.kiro/steering/x.md: fileMatchPattern is only for inclusion: fileMatch ${guide}`]);
  });

  it.each([
    ["a block list", "fileMatchPattern:\n  - a\n"],
    ["a string", "fileMatchPattern: a\n"],
  ])("refuses fileMatchPattern written as %s", (_, pattern) => {
    expect(
      violations(repo(steering(`inclusion: fileMatch\n${pattern}name: x\ndescription: d\n`))),
    ).toEqual([`.kiro/steering/x.md: fileMatchPattern must be a one-line array ${guide}`]);
  });

  it("refuses frontmatter that is not valid YAML", () => {
    expect(
      violations(repo(steering("inclusion: auto\nname: x\ndescription: javascript: x\n"))),
    ).toEqual([
      `.kiro/steering/x.md: frontmatter is not valid YAML (Nested mappings are not allowed in compact mappings) ${guide}`,
    ]);
  });

  it("checks untracked steering files too", () => {
    expect(
      violations(repo({}, { untracked: { ".kiro/steering/broken.md": "no frontmatter\n" } })),
    ).toEqual([`.kiro/steering/broken.md: must start with a frontmatter block ${guide}`]);
  });

  it("checks only the Markdown files in .kiro/steering", () => {
    expect(
      violations(repo({ ".kiro/steering/notes.txt": "x\n", ".kiro/skills/a/SKILL.md": "x\n" })),
    ).toEqual([]);
  });
});

describe("git on another repository, never from a shell wrapper", () => {
  const wrapper = "tools/scripts/sh/guard-push.sh";
  const anywhere = (path: string) =>
    `${path} runs git on another repository. A shell wrapper runs git only on the repository it runs in; write a test that needs another repository in TypeScript, with gitIn (docs/adr/0024).`;

  it.each([
    ["git init", "git init -q /tmp/x"],
    ["git clone", "git clone -q a b"],
    ["git -C", 'git -C "$1" commit -m x'],
    ["--git-dir", "git --git-dir=/tmp/x/.git log"],
    ["GIT_DIR=", "GIT_DIR=/tmp/x git log"],
    ["git init at the end of a line", "cd /tmp/x && git init"],
  ])("refuses %s in a shell wrapper", (_, line) => {
    expect(violations(repo({ [wrapper]: `#!/bin/sh\n${line}\n` }))).toEqual([anywhere(wrapper)]);
  });

  it.each([
    ["a word that ends in git", "legit init"],
    ["git with another command", "git initialize"],
    ["a git command on this repository", "git rev-parse --show-toplevel"],
  ])("passes %s", (_, line) => {
    expect(violations(repo({ [wrapper]: `#!/bin/sh\n${line}\n` }))).toEqual([]);
  });

  it("applies only to tools/scripts/sh/*.sh, and not to the upstream skills", () => {
    expect(
      violations(
        repo({
          "tools/scripts/src/checks/other.ts": "// git -C dir, git init, GIT_DIR=x\n",
          "tools/scripts/sh/nested/a.sh": "git init x\n",
          "tools/scripts/sh/other.txt": "git init x\n",
          "tools/scripts/sh/other.sh.bak": "git init x\n",
          "apps/tools/scripts/sh/other.sh": "git init x\n",
          "other/run.sh": "git init x\n",
          ".agents/skills/a/run.sh": "git init x\n",
          ".kiro/skills/a/run.sh": "git init x\n",
        }),
      ),
    ).toEqual([]);
  });
});

describe("shell scripts are executable in git", () => {
  it("refuses a shell script whose index mode is not 100755", () => {
    const path = "tools/scripts/sh/guard-push.sh";
    expect(violations(repo({}, { modes: { [path]: "100644" } }))).toEqual([
      `${path} is not executable in git. Run \`chmod +x ${path}\` and stage it again.`,
    ]);
  });

  it("checks only tools/scripts/sh/*.sh, so not the upstream skills", () => {
    const paths = [".agents/skills/a/x.sh", ".kiro/skills/a/x.sh", "other/x.sh"];
    const files = Object.fromEntries(paths.map((path) => [path, "x\n"]));
    const modes = Object.fromEntries(paths.map((path) => [path, "100644"]));
    expect(violations(repo(files, { modes }))).toEqual([]);
  });
});

describe("every shell wrapper has a process test", () => {
  const path = "tools/scripts/sh/other.sh";
  const test = "tools/scripts/src/sh/other.test.ts";
  const missing = `${path} has no process test. Write ${test}, with a stub tool from src/test/stubs.ts that checks what the script hands to the tool and its exit code (docs/tooling/ci.md, "検査を足すとき" の 5).`;

  it("refuses a wrapper with no src/sh/<name>.test.ts", () => {
    expect(violations(repo({ [path]: "#!/bin/sh\ntrue\n" }))).toEqual([missing]);
  });

  it("passes a wrapper with its test", () => {
    expect(violations(repo({ [path]: "#!/bin/sh\ntrue\n", [test]: "// test\n" }))).toEqual([]);
  });

  it("does not take the test of the real tool for the process test", () => {
    const tools = "tools/scripts/src/sh/other.tools.test.ts";
    expect(violations(repo({ [path]: "#!/bin/sh\ntrue\n", [tools]: "// test\n" }))).toEqual([
      missing,
    ]);
  });

  it("checks only tools/scripts/sh/*.sh, so not the upstream skills", () => {
    expect(violations(repo({ ".agents/skills/a/run.sh": "x\n", "other/run.sh": "x\n" }))).toEqual(
      [],
    );
  });
});

describe("ADR 0013: one Node.js major version", () => {
  it.each(["v24.1.2\n", "24\n", "24.22.1\n\n# comment\n", "\n# pinned\n24.22.1\n"])(
    "passes a .node-version of %j",
    (version) => {
      expect(violations(repo({ ".node-version": version }))).toEqual([]);
    },
  );

  it("refuses a .node-version that moves alone", () => {
    expect(violations(repo({ ".node-version": "25\n" }))).toEqual([
      "package.json engines.node (24) must be Node.js 25, the major of .node-version (docs/adr/0013).",
      "pnpm-workspace.yaml catalog @types/node (24) must be Node.js 25, the major of .node-version (docs/adr/0013).",
      "apps/api/vite.config.ts builds for node24, but .node-version is Node.js 25 (docs/adr/0013).",
    ]);
  });

  it.each(["lts\n", "", undefined])("refuses a .node-version of %j", (version) => {
    expect(violations(repo({ ".node-version": version }))).toEqual([
      ".node-version must start with a Node.js version such as 24 or 24.22.1 (docs/adr/0013).",
    ]);
  });

  it("refuses engines.node of another major, and names an unreadable one", () => {
    expect(violations(repo({ "package.json": json({ engines: { node: ">=25" } }) }))).toEqual([
      "package.json engines.node (25) must be Node.js 24, the major of .node-version (docs/adr/0013).",
    ]);
    expect(violations(repo({ "package.json": json({}) }))).toEqual([
      "package.json engines.node (unreadable) must be Node.js 24, the major of .node-version (docs/adr/0013).",
    ]);
  });

  it("refuses a @types/node catalog of another major, and names an unreadable one", () => {
    expect(
      violations(repo({ "pnpm-workspace.yaml": 'catalog:\n  "@types/node": 25.0.1\n' })),
    ).toEqual([
      "pnpm-workspace.yaml catalog @types/node (25) must be Node.js 24, the major of .node-version (docs/adr/0013).",
    ]);
    expect(violations(repo({ "pnpm-workspace.yaml": "packages: []\n" }))).toEqual([
      "pnpm-workspace.yaml catalog @types/node (unreadable) must be Node.js 24, the major of .node-version (docs/adr/0013).",
    ]);
  });

  it("reads the catalog however the YAML is written", () => {
    const flow = 'catalog: { "@types/node": "~24.3.0" }\n';
    expect(violations(repo({ "pnpm-workspace.yaml": flow }))).toEqual([]);
  });

  it("refuses a build target of another major in any vite.config.ts", () => {
    expect(
      violations(
        repo({ "apps/web/vite.config.ts": 'export default { build: { target: "node25" } };\n' }),
      ),
    ).toEqual([
      "apps/web/vite.config.ts builds for node25, but .node-version is Node.js 24 (docs/adr/0013).",
    ]);
  });
});

describe("one PostgreSQL version in compose.local.yaml and postgresImage (#515)", () => {
  const connection = "packages/db/src/testing/connection.ts";
  const compose = (image: string): string => `services:\n  postgres:\n    image: ${image}\n`;

  // The passing repo's compose has a digest after the tag; this case has none.
  it("passes a compose tag without a digest", () => {
    expect(violations(repo({ "compose.local.yaml": compose("postgres:18") }))).toEqual([]);
  });

  it("refuses a compose that moves alone, and a postgresImage that moves alone", () => {
    expect(violations(repo({ "compose.local.yaml": compose("postgres:19@sha256:abc") }))).toEqual([
      `compose.local.yaml postgres image (postgres:19) must be the tag of postgresImage in ${connection} (postgres:18) (docs/tooling/local-worker.md).`,
    ]);
    expect(
      violations(repo({ [connection]: 'export const postgresImage = "postgres:17";\n' })),
    ).toEqual([
      `compose.local.yaml postgres image (postgres:18) must be the tag of postgresImage in ${connection} (postgres:17) (docs/tooling/local-worker.md).`,
    ]);
  });

  it("names a compose without the postgres image, and a postgresImage that is not a literal", () => {
    expect(violations(repo({ "compose.local.yaml": "services: {}\n" }))).toEqual([
      "compose.local.yaml must set services.postgres.image (docs/tooling/local-worker.md).",
    ]);
    expect(violations(repo({ [connection]: "export const postgresImage = image;\n" }))).toEqual([
      `${connection} must set postgresImage to a string literal (docs/tooling/local-worker.md).`,
    ]);
  });
});

describe("ADR numbers are unique", () => {
  it("refuses two ADRs with the same number", () => {
    expect(violations(repo({ "docs/adr/0001-duplicate.md": "# x\n" }))).toEqual([
      "ADR 0001 is used by more than one file: docs/adr/0001-duplicate.md docs/adr/0001-lefthook.md",
    ]);
  });

  it("does not count files that are not ADRs", () => {
    expect(
      violations(repo({ "docs/adr/index.md": "# x\n", "docs/adr/0001/notes.md": "# x\n" })),
    ).toEqual([]);
  });
});

describe("ADR 0025: migrations go forward only", () => {
  const path = "packages/db/migrations/20260102000000_add_y.sql";
  const downProblem = `${path} has a down section that is not only \`DO $$ BEGIN RAISE EXCEPTION '...'; END $$;\`. Migrations go forward only (docs/adr/0025).`;
  const lockProblem = `${path} does not start its up section with SET LOCAL lock_timeout. Add it, or mark the file transaction:false (docs/adr/0025).`;

  it("passes a migration with a raising down and a lock_timeout", () => {
    expect(violations(repo({ [path]: migration() }))).toEqual([]);
  });

  it("passes comments around the statements and a lower-case down", () => {
    expect(
      violations(
        repo({
          [path]: migration({
            up: "-- why\nset local lock_timeout = '3s';\nALTER TABLE x ADD COLUMN y int;\n",
            down: "-- irreversible\ndo $$ begin raise exception 'no'; end $$;\n",
          }),
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["an empty down", ""],
    ["a down with only a comment", "-- nothing\n"],
    ["a down that drops the table", "DROP TABLE x;\n"],
    [
      "a down that raises and then drops",
      "DO $$ BEGIN RAISE EXCEPTION 'no'; END $$;\nDROP TABLE x;\n",
    ],
    ["a down that does something else in the block", "DO $$ BEGIN DROP TABLE x; END $$;\n"],
  ])("refuses %s", (_name, down) => {
    expect(violations(repo({ [path]: migration({ down }) }))).toEqual([downProblem]);
  });

  it("refuses a migration without a down section", () => {
    expect(
      violations(
        repo({
          [path]: "-- migrate:up\nSET LOCAL lock_timeout = '5s';\nCREATE TABLE y (id int);\n",
        }),
      ),
    ).toEqual([downProblem]);
  });

  it("refuses an up section that does not start with SET LOCAL lock_timeout", () => {
    expect(
      violations(
        repo({
          [path]: migration({ up: "CREATE TABLE y (id int);\nSET LOCAL lock_timeout = '5s';\n" }),
        }),
      ),
    ).toEqual([lockProblem]);
  });

  it("refuses an up section that is empty", () => {
    expect(violations(repo({ [path]: migration({ up: "" }) }))).toEqual([lockProblem]);
  });

  it("does not ask a transaction:false file for lock_timeout", () => {
    expect(
      violations(
        repo({
          [path]: migration({
            upOptions: " transaction:false",
            up: "CREATE INDEX CONCURRENTLY y_idx ON x (id);\n",
          }),
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["a statement before the block", "SELECT 1;\nDO $$ BEGIN RAISE EXCEPTION 'no'; END $$;\n"],
    ["a statement after the block", "DO $$ BEGIN RAISE EXCEPTION 'no'; END $$;\nSELECT 1;\n"],
    ["a block that raises with an empty message", "DO $$ BEGIN RAISE EXCEPTION ''; END $$;\n"],
  ])("refuses a down with %s", (_name, down) => {
    expect(violations(repo({ [path]: migration({ down }) }))).toEqual([downProblem]);
  });

  it.each([
    ["written compactly, without the last semicolon", "DO $$BEGIN RAISE EXCEPTION 'x';END$$"],
    [
      "written over several lines with wide spacing",
      "DO   $$\n  BEGIN\n\tRAISE   EXCEPTION   'x'   ;\n  END   $$   ;\n",
    ],
    ["with a `--` inside the message", "DO $$ BEGIN RAISE EXCEPTION 'a -- b'; END $$;\n"],
  ])("passes a down %s", (_name, down) => {
    expect(violations(repo({ [path]: migration({ down }) }))).toEqual([]);
  });

  it.each([
    ["spaces", "SET   LOCAL   lock_timeout = '5s';\n"],
    ["lines", "SET\nLOCAL\nlock_timeout = '5s';\n"],
    ["an indented comment before it", "  -- why\n\t-- and why\nSET LOCAL lock_timeout = '5s';\n"],
    [
      "a comment that mentions the marker",
      "-- run it -- migrate: later\nSET LOCAL lock_timeout = '5s';\n",
    ],
  ])("passes an up section with %s", (_name, up) => {
    expect(violations(repo({ [path]: migration({ up }) }))).toEqual([]);
  });

  it("reads the lock_timeout of the up section, not the one in the down section", () => {
    expect(
      violations(repo({ [path]: migration({ up: "", down: "SET LOCAL lock_timeout = '5s';\n" }) })),
    ).toEqual([downProblem, lockProblem]);
  });

  it("reads an up section that comes after the down section, to the last character", () => {
    const sql =
      "-- migrate:down\nDO $$ BEGIN RAISE EXCEPTION 'no'; END $$;\n-- migrate:up\nSET LOCAL lock_timeout";
    expect(violations(repo({ [path]: sql }))).toEqual([]);
  });

  it("refuses a migration without an up section", () => {
    const sql = "-- migrate:down\nDO $$ BEGIN RAISE EXCEPTION 'no'; END $$;\n";
    expect(violations(repo({ [path]: sql }))).toEqual([lockProblem]);
  });

  it("refuses transaction:false that is only another word", () => {
    expect(
      violations(
        repo({ [path]: migration({ upOptions: " transaction:falsy", up: "SELECT 1;\n" }) }),
      ),
    ).toEqual([lockProblem]);
  });

  it("checks a migration at the root of the repository, not a file that only starts like one", () => {
    expect(
      violations(repo({ "db/migrations/20260104000000_w.sql": "", "db/migrations/x.sql.bak": "" })),
    ).toEqual([
      `db/migrations/20260104000000_w.sql has a down section that is not only \`DO $$ BEGIN RAISE EXCEPTION '...'; END $$;\`. Migrations go forward only (docs/adr/0025).`,
      "db/migrations/20260104000000_w.sql does not start its up section with SET LOCAL lock_timeout. Add it, or mark the file transaction:false (docs/adr/0025).",
    ]);
  });

  it("reports both problems of one file, and the file of another module", () => {
    const other = "packages/claim/db/migrations/20260103000000_z.sql";
    expect(
      violations(repo({ [path]: migration({ up: "SELECT 1;\n", down: "" }), [other]: "" })),
    ).toEqual([
      `${other} has a down section that is not only \`DO $$ BEGIN RAISE EXCEPTION '...'; END $$;\`. Migrations go forward only (docs/adr/0025).`,
      `${other} does not start its up section with SET LOCAL lock_timeout. Add it, or mark the file transaction:false (docs/adr/0025).`,
      downProblem,
      lockProblem,
    ]);
  });

  it("does not read files outside db/migrations, or that are not SQL", () => {
    expect(
      violations(
        repo({
          "packages/db/bootstrap.sql": "SELECT 1;\n",
          "packages/db/migrations/README.md": "",
          "docs/migrations/x.sql": "",
        }),
      ),
    ).toEqual([]);
  });
});

describe("every job of ci.yml is in the needs of main", () => {
  const ci = base[".github/workflows/ci.yml"] ?? "";
  const extra = `${ci}  extra:\n    runs-on: ubuntu-26.04\n    steps: []\n`;
  const notNeeded =
    '.github/workflows/ci.yml: the main job must list `extra` in its needs, or a failure of `extra` will not block a merge (docs/tooling/ci.md ("ci.yml の検証")).';

  it("refuses a job that main does not need", () => {
    expect(violations(repo({ ".github/workflows/ci.yml": extra }))).toEqual([notNeeded]);
  });

  it.each([
    ["a one-line list", "    needs: [checks, nx, extra]"],
    ["a block list", "    needs:\n      - checks\n      - nx\n      - extra"],
    ["a flow list over several lines", "    needs: [\n      checks,\n      nx, extra,\n    ]"],
  ])("reads needs written as %s", (_, needs) => {
    const ci = extra.replace("    needs: [checks, nx]", needs);
    expect(violations(repo({ ".github/workflows/ci.yml": ci }))).toEqual([]);
  });

  // The step keeps the row of the catalog in the fixture.
  const step = "    steps: [{ name: Guard push, run: x }]\n";

  it("reads needs written as a single job", () => {
    const single = `jobs:\n  build:\n${step}  main:\n    needs: build\n    steps: []\n`;
    expect(violations(repo({ ".github/workflows/ci.yml": single }))).toEqual([]);
  });

  it("refuses every job when there is no main", () => {
    const none = `jobs:\n  build:\n${step}`;
    expect(violations(repo({ ".github/workflows/ci.yml": none }))).toEqual([
      '.github/workflows/ci.yml: the main job must list `build` in its needs, or a failure of `build` will not block a merge (docs/tooling/ci.md ("ci.yml の検証")).',
    ]);
  });

  // check-repo-policy.sh stopped with an error from awk.
  it("refuses a repository without ci.yml", () => {
    expect(violations(repo({ ".github/workflows/ci.yml": undefined }))).toEqual([
      '.github/workflows/ci.yml does not exist. Its main job is the required status check (docs/tooling/ci.md ("ci.yml の検証")).',
    ]);
  });
});

describe("the assurance catalog has one row per sensor of the configs", () => {
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
});

describe("every required check of the ruleset is a job that runs on pull_request", () => {
  const workflow = ".github/workflows/commitlint.yml";
  const job = "jobs:\n  commitlint:\n    steps: []\n";
  const waits = (check: string) =>
    `.github/rulesets/protect-main.json requires the check "${check}", but no job of a workflow that runs on pull_request has that name, so a pull request waits for it forever (docs/tooling/ci.md ("ci.yml の job")).`;

  it("refuses a required check that no job reports", () => {
    const renamed = "on: pull_request\njobs:\n  lint:\n    steps: []\n";
    expect(violations(repo({ [workflow]: renamed }))).toEqual([waits("commitlint")]);
  });

  it.each([
    ["only on push", "on:\n  push:\n"],
    ["on pull_request_target", "on: pull_request_target\n"],
    ["on a list without pull_request", "on: [push, workflow_dispatch]\n"],
    ["without on", ""],
  ])("refuses a job of a workflow that runs %s", (_, on) => {
    expect(violations(repo({ [workflow]: on + job }))).toEqual([waits("commitlint")]);
  });

  it.each([
    ["a string", "on: pull_request\n"],
    ["a list", "on: [push, pull_request]\n"],
    ["a map", "on:\n  pull_request:\n    types: [opened]\n"],
  ])("reads on written as %s", (_, on) => {
    expect(violations(repo({ [workflow]: on + job }))).toEqual([]);
  });

  it("matches the name of a job when it has one, as GitHub names the check", () => {
    const named = (name: string) =>
      `on: pull_request\njobs:\n  lint:\n    name: ${name}\n    steps: []\n`;
    expect(violations(repo({ [workflow]: named("commitlint") }))).toEqual([]);
    const idOnly = "on: pull_request\njobs:\n  commitlint:\n    name: Commit lint\n    steps: []\n";
    expect(violations(repo({ [workflow]: idOnly }))).toEqual([waits("commitlint")]);
  });

  it("reads every workflow of .github/workflows, but not files elsewhere", () => {
    const yaml = {
      [workflow]: undefined,
      ".github/workflows/lint.yaml": `on: pull_request\n${job}`,
    };
    expect(violations(repo(yaml))).toEqual([]);
    const elsewhere = {
      [workflow]: undefined,
      ".github/workflows/old/lint.yml": `on: pull_request\n${job}`,
      ".github/workflows/lint.yml.bak": `on: pull_request\n${job}`,
      "apps/.github/workflows/lint.yml": `on: pull_request\n${job}`,
      ".github/lint.yml": `on: pull_request\n${job}`,
    };
    expect(violations(repo(elsewhere))).toEqual([waits("commitlint")]);
  });
});

describe("every Nx target that ci.yml runs has a command in docs/tooling/commands.md", () => {
  const ci = base[".github/workflows/ci.yml"] ?? "";
  const runs = (command: string) =>
    ci.replace("run: tools/scripts/sh/guard-push.sh", `run: ${command}`);
  const commands = (...rows: string[]) =>
    ["# 開発コマンド", "", "| やりたいこと | コマンド |", "| --- | --- |", ...rows, ""].join("\n");
  const missing = (target: string) =>
    `.github/workflows/ci.yml runs the Nx target ${target}, but docs/tooling/commands.md has no nx command that runs it. Add the command a person runs to its table (docs/tooling/ci.md ("検査を足すとき")).`;

  it("refuses a target of nx affected that commands.md does not run", () => {
    expect(
      violations(
        repo({
          ".github/workflows/ci.yml": runs("pnpm exec nx affected -t check db-types-check"),
          "docs/tooling/commands.md": commands("| 検査 | `pnpm exec nx affected -t check` |"),
        }),
      ),
    ).toEqual([missing("db-types-check")]);
  });

  it.each([
    ["the -t list of nx affected", "`pnpm exec nx affected -t check db-types-check`"],
    ["the --targets list of nx run-many", "`pnpm exec nx run-many --targets=db-types-check,check`"],
    ["nx <target> <project>", "`pnpm exec nx db-types-check api` と `pnpm exec nx check api`"],
    ["nx run <project>:<target>", "`pnpm exec nx run api:db-types-check`、`nx run api:check`"],
  ])("passes targets that commands.md runs in %s", (_, cell) => {
    expect(
      violations(
        repo({
          ".github/workflows/ci.yml": runs("pnpm exec nx affected -t check db-types-check"),
          "docs/tooling/commands.md": commands(`| 検査 | ${cell} |`),
        }),
      ),
    ).toEqual([]);
  });

  it("reads the targets after other flags, after --targets with = or a space, and of every nx command", () => {
    const step = [
      "|",
      "          pnpm exec nx run-many --targets=lint-effect,mutation",
      "          pnpm exec nx affected --base=x --head=y -t test db-types-check --parallel=1 && pnpm exec nx affected --targets build",
    ].join("\n");
    expect(
      violations(
        repo({ ".github/workflows/ci.yml": runs(step), "docs/tooling/commands.md": commands() }),
      ),
    ).toEqual(["lint-effect", "mutation", "test", "db-types-check", "build"].map(missing));
  });

  it("reads the inline code after a fenced code block", () => {
    const fenced = ["```sh", "pnpm install", "```", "", "| 検査 | `pnpm exec nx check api` |", ""];
    expect(
      violations(
        repo({
          ".github/workflows/ci.yml": runs("pnpm exec nx affected -t check"),
          "docs/tooling/commands.md": fenced.join("\n"),
        }),
      ),
    ).toEqual([]);
  });

  it("finds no target in nx commands that run none", () => {
    const step =
      "pnpm exec nx show projects --affected && pnpm exec nx affected --graph && echo onx affected -t x";
    expect(
      violations(
        repo({ ".github/workflows/ci.yml": runs(step), "docs/tooling/commands.md": commands() }),
      ),
    ).toEqual([]);
  });

  it("does not count a target that commands.md names outside an nx command", () => {
    expect(
      violations(
        repo({
          ".github/workflows/ci.yml": runs("pnpm exec nx affected -t db-types-check"),
          "docs/tooling/commands.md": commands(
            "| nx で db-types-check を流す | `pnpm db-types-check` |",
          ),
        }),
      ),
    ).toEqual([missing("db-types-check")]);
  });
});

describe("the pnpm catalog has no workspace packages", () => {
  const refused = (where: string, name: string) =>
    `pnpm-workspace.yaml ${where} has ${name}: workspace:*. A workspace package is not a catalog entry: write "workspace:*" in the package.json that depends on it and run pnpm install. With catalogMode: prefer, \`pnpm add <package>@workspace:*\` puts it in the catalog.`;

  it("refuses a workspace: version in the default catalog", () => {
    const workspace = `${base["pnpm-workspace.yaml"] ?? ""}  "@x/shared": workspace:*\n`;
    expect(violations(repo({ "pnpm-workspace.yaml": workspace }))).toEqual([
      refused("catalog", "@x/shared"),
    ]);
  });

  it("refuses a workspace: version in a named catalog", () => {
    const workspace = `${base["pnpm-workspace.yaml"] ?? ""}catalogs:\n  tools:\n    "@x/shared": workspace:^\n`;
    expect(violations(repo({ "pnpm-workspace.yaml": workspace }))).toEqual([
      refused("catalogs.tools", "@x/shared").replace("workspace:*.", "workspace:^."),
    ]);
  });
});

describe("configuration files that cannot be parsed", () => {
  it.each([
    [".github/workflows/ci.yml", "jobs: [\n"],
    ["pnpm-workspace.yaml", "catalog: [\n"],
  ])("names %s and the parser error", (path, text) => {
    const failures = violations(repo({ [path]: text }));
    expect(
      failures.filter((failure) => failure.startsWith(`${path} is not valid YAML (`)),
    ).toHaveLength(1);
  });

  it.each([
    ["mise.toml", "[tools\n"],
    [".betterleaks.toml", "betterleaksMinVersion = \n"],
  ])("names %s and the parser error", (path, text) => {
    const failures = violations(repo({ [path]: text }));
    expect(
      failures.filter((failure) => failure.startsWith(`${path} is not valid TOML (`)),
    ).toHaveLength(1);
  });

  it("reads a comment line only in a tsconfig.json: in any other JSON file it is an error", () => {
    expect(violations(repo({ "apps/api/package.json": '// comment\n{"name": "x"}\n' }))[0]).toMatch(
      /^apps\/api\/package\.json is not valid JSON \(.+\)$/,
    );
  });

  it("names a package.json that is not JSON", () => {
    expect(violations(repo({ "apps/api/package.json": "{\n" }))[0]).toMatch(
      /^apps\/api\/package\.json is not valid JSON \(.+\)$/,
    );
  });
});

describe("references to docs/ from outside docs/", () => {
  const cite = (line: string, path = "lefthook.yml") => ({
    [path]: `${base["lefthook.yml"] ?? ""}# ${line}\n`,
  });

  it.each([
    ["a file", "see docs/local-env-setup/setup.md"],
    [
      "a heading without its number",
      'see docs/local-env-setup/setup.md ("Ubuntu の初期セットアップ")',
    ],
    [
      "a heading with its number",
      'see docs/local-env-setup/setup.md ("3. Ubuntu の初期セットアップ")',
    ],
    [
      "a heading in a JSON string",
      'see docs/local-env-setup/setup.md (\\"Ubuntu の初期セットアップ\\")',
    ],
    ["an ADR number", "(docs/adr/0002)"],
    ["an ADR file", "docs/adr/0002-nx.md"],
    ["an ADR number at the end of a line", "docs/adr/0002"],
    ["a path inside another path", "see apps/docs/missing.md and ../docs/missing.md"],
    ["an ADR number with more digits", "docs/adr/99999"],
  ])("passes %s that exists", (_, line) => {
    expect(violations(repo(cite(line)))).toEqual([]);
  });

  it("refuses a file that does not exist", () => {
    expect(violations(repo(cite("see docs/tooling/missing.md")))).toEqual([
      "lefthook.yml cites docs/tooling/missing.md, which does not exist.",
    ]);
  });

  it("refuses a heading that does not exist", () => {
    expect(violations(repo(cite('see docs/local-env-setup/setup.md ("No such heading")')))).toEqual(
      [
        'lefthook.yml cites the heading "No such heading" in docs/local-env-setup/setup.md, which has no such heading.',
      ],
    );
  });

  it("matches the whole heading line, not a part of it", () => {
    expect(violations(repo(cite('docs/local-env-setup/setup.md ("Ubuntu")')))).toEqual([
      'lefthook.yml cites the heading "Ubuntu" in docs/local-env-setup/setup.md, which has no such heading.',
    ]);
  });

  it("refuses an ADR number that does not exist", () => {
    expect(violations(repo(cite("docs/adr/9999")))).toEqual([
      "lefthook.yml cites docs/adr/9999, which does not exist.",
    ]);
  });

  it("names every reference of a line", () => {
    expect(violations(repo(cite("docs/adr/9998 and docs/adr/9999.")))).toEqual([
      "lefthook.yml cites docs/adr/9998, which does not exist.",
      "lefthook.yml cites docs/adr/9999, which does not exist.",
    ]);
  });

  it("checks the code and the tests of tools/scripts", () => {
    expect(
      violations(
        repo({
          "tools/scripts/src/checks/other.ts": "// docs/tooling/missing.md\n",
          "tools/scripts/src/checks/other.test.ts": "// docs/adr/9999\n",
        }),
      ),
    ).toEqual([
      "tools/scripts/src/checks/other.test.ts cites docs/adr/9999, which does not exist.",
      "tools/scripts/src/checks/other.ts cites docs/tooling/missing.md, which does not exist.",
    ]);
  });

  it.each([
    "docs/tooling/a.md",
    ".agents/skills/a/SKILL.md",
    ".kiro/skills/a/SKILL.md",
    "research/a.md",
    "tools/scripts/src/checks/adr-check/rules.test.ts",
    "tools/scripts/src/checks/repo-policy/rules.test.ts",
    "tools/scripts/src/checks/repo-policy/fixtures/passing-repo.ts",
    "pnpm-lock.yaml",
  ])("does not check %s, which may cite missing docs on purpose", (path) => {
    expect(violations(repo({ [path]: "docs/adr/9999\n" }))).toEqual([]);
  });

  it("checks a path that only has research/ inside it", () => {
    expect(violations(repo({ "apps/research/a.md": "docs/adr/9999\n" }))).toEqual([
      "apps/research/a.md cites docs/adr/9999, which does not exist.",
    ]);
  });

  it("does not read binary files", () => {
    expect(violations(repo({ "assets/a.png": "\0docs/adr/9999\n" }))).toEqual([]);
  });

  it("counts a doc only if the tree has it", () => {
    expect(
      violations(
        repo({
          "docs/local-env-setup/setup.md": undefined,
          ...cite("docs/local-env-setup/setup.md"),
        }),
      ),
    ).toEqual(["lefthook.yml cites docs/local-env-setup/setup.md, which does not exist."]);
  });
});

// The edges of each check: inputs just inside and just outside what it matches.
describe("ADR 0002: the edges", () => {
  it("refuses @nx/vite in the root package.json", () => {
    const root = json({ engines: { node: "^24" }, devDependencies: { "@nx/vite": "24.0.0" } });
    expect(violations(repo({ "package.json": root }))).toEqual([
      "package.json depends on @nx/vite. Targets come from package.json scripts (docs/adr/0002).",
    ]);
  });

  // check-repo-policy.sh grepped the whole package.json for "@nx/vite".
  it.each([
    ["overrides", { overrides: { "@nx/vite": "-" } }],
    ["resolutions", { resolutions: { "@nx/vite": "-" } }],
    ["pnpm.overrides", { pnpm: { overrides: { "@nx/vite": "-" } } }],
    ["a list", { pnpm: { packageExtensions: [{}, { x: { "@nx/vite": "-" } }] } }],
  ])("refuses @nx/vite as a key in %s", (_, manifest) => {
    expect(violations(repo({ "apps/api/package.json": apiManifest(manifest) }))).toEqual([
      "apps/api/package.json depends on @nx/vite. Targets come from package.json scripts (docs/adr/0002).",
    ]);
  });

  it("passes dependency fields that are null", () => {
    expect(
      violations(
        repo({
          "apps/api/package.json": apiManifest({
            devDependencies: null,
            peerDependencies: null,
            optionalDependencies: null,
          }),
        }),
      ),
    ).toEqual([]);
  });

  it("refuses a run block with spaces before its colon", () => {
    const config = `${base["vite.config.ts"] ?? ""}  run  : {}\n`;
    expect(violations(repo({ "vite.config.ts": config }))).toEqual([
      "vite.config.ts has a `run` block. Task running and caching belong to Nx (docs/adr/0002).",
    ]);
  });

  it("passes a run key nested deeper in the config", () => {
    const nested = "export default {\n  test: {\n    run: 1,\n  },\n};\n";
    expect(violations(repo({ "apps/web/vite.config.ts": nested }))).toEqual([]);
  });
});

describe("ADR 0026: the edges", () => {
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

describe("ADR 0026: the package.json of every package under packages/", () => {
  const path = "packages/claim/package.json";
  const messages = {
    name: `${path} must have the name "@agent-software-factory/claim", the scope and the directory (docs/adr/0026).`,
    exports: `${path} must have the exports {".":"./src/index.ts"}, so that another package can import only its src/index.ts (docs/adr/0026).`,
    index:
      "packages/module-fixtures/src/index.ts, the public API that the exports name, does not exist (docs/adr/0026).",
    nx: `${path} must have the Nx project name "claim" (nx.name), the name of its directory (docs/adr/0026).`,
    check: `${path} must have the check script "vp check", so that Nx lints and type-checks the package (docs/adr/0026).`,
  };

  it.each([
    ["a name of another scope", { name: "@x/claim" }, messages.name],
    ["a name of another directory", { name: "@agent-software-factory/claims" }, messages.name],
    ["no exports", { exports: undefined }, messages.exports],
    [
      "exports of a subpath too",
      { exports: { ".": "./src/index.ts", "./x": "./src/x.ts" } },
      messages.exports,
    ],
    ["exports of another file", { exports: { ".": "./index.ts" } }, messages.exports],
    ["exports as a string", { exports: "./src/index.ts" }, messages.exports],
    ["no Nx project name", { nx: { tags: ["type:module"] } }, messages.nx],
    [
      "an Nx project name of another directory",
      { nx: { name: "claims", tags: ["type:module"] } },
      messages.nx,
    ],
  ])("refuses a package.json with %s", (_, fields, message) => {
    expect(violations(repo({ [path]: packageJson("claim", fields) }))).toEqual([message]);
  });

  it.each([
    ["no check script", { "lint-effect": lintEffect }],
    ["another check script", { check: "vp lint", "lint-effect": lintEffect }],
  ])("refuses a package with %s", (_, scripts) => {
    expect(violations(repo({ [path]: packageJson("claim", { scripts }) }))).toEqual([
      messages.check,
    ]);
  });

  it("refuses a package without its src/index.ts, and names every problem of an empty package.json", () => {
    expect(violations(repo({ "packages/module-fixtures/src/index.ts": undefined }))).toEqual([
      messages.index,
    ]);
    expect(
      violations(repo({ "packages/shared-kernel/package.json": "{}" })).filter((failure) =>
        failure.startsWith("packages/shared-kernel/"),
      ),
    ).toEqual([
      'packages/shared-kernel/package.json must have the name "@agent-software-factory/shared-kernel", the scope and the directory (docs/adr/0026).',
      `packages/shared-kernel/package.json must have the exports ${JSON.stringify(sharedKernelExports)}, the contract and one entry for each feature, and nothing else (docs/adr/0051).`,
      'packages/shared-kernel/package.json must have the Nx project name "shared-kernel" (nx.name), the name of its directory (docs/adr/0026).',
      'packages/shared-kernel/package.json must have the check script "vp check", so that Nx lints and type-checks the package (docs/adr/0026).',
    ]);
  });
});

describe("ADR 0026: the modules depend one way, by their package.json", () => {
  const table = "tools/scripts/src/checks/repo-policy/modules.ts";
  const manifest = (name: string, fields: Record<string, Record<string, string>> = {}) =>
    packageFiles(name, fields);
  const wrong = (from: string, field: string, to: string) =>
    `packages/${from}/package.json has @agent-software-factory/${to} in ${field}. A module depends only on shared-kernel and the modules after it in closing → approval → claim, and shared-kernel, module-fixtures, ui, i18n, telemetry and logging on none: move the code that needs ${to}, or move what both need into shared-kernel (docs/adr/0026).`;
  const workspace = { "@agent-software-factory/claim": "workspace:*" };

  it("passes each module with the modules it may depend on, and shared", () => {
    expect(
      violations(
        repo({
          ...manifest("approval", { dependencies: workspace }),
          ...manifest("closing", {
            dependencies: {
              "@agent-software-factory/approval": "workspace:*",
              "@agent-software-factory/shared-kernel": "workspace:*",
            },
            devDependencies: workspace,
          }),
        }),
      ),
    ).toEqual([]);
  });

  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "refuses a module that depends on a module after it, in %s",
    (field) => {
      expect(
        violations(
          repo(
            manifest("claim", { [field]: { "@agent-software-factory/approval": "workspace:*" } }),
          ),
        ),
      ).toEqual([wrong("claim", field, "approval")]);
    },
  );

  it("refuses shared-kernel that depends on a module or on itself, and a module on another package of the workspace", () => {
    expect(
      violations(
        repo({
          ...manifest("shared-kernel", {
            dependencies: workspace,
            devDependencies: { "@agent-software-factory/shared-kernel": "workspace:*" },
          }),
          ...manifest("approval", {
            dependencies: { "@agent-software-factory/api": "workspace:*" },
          }),
        }),
      ),
    ).toEqual([
      wrong("approval", "dependencies", "api"),
      wrong("shared-kernel", "dependencies", "claim"),
      wrong("shared-kernel", "devDependencies", "shared-kernel"),
    ]);
  });

  it("refuses a module that depends on itself, or on a module before it", () => {
    expect(
      violations(
        repo(
          manifest("approval", {
            dependencies: {
              "@agent-software-factory/approval": "workspace:*",
              "@agent-software-factory/closing": "workspace:*",
            },
          }),
        ),
      ),
    ).toEqual([
      wrong("approval", "dependencies", "approval"),
      wrong("approval", "dependencies", "closing"),
    ]);
  });

  it("asks module-fixtures for no place in moduleOrder, and refuses any package of the workspace it depends on", () => {
    expect(violations(repo(manifest("module-fixtures")))).toEqual([]);
    expect(
      violations(
        repo(
          manifest("module-fixtures", {
            dependencies: {
              "@agent-software-factory/shared-kernel": "workspace:*",
              effect: "catalog:",
            },
            devDependencies: workspace,
          }),
        ),
      ),
    ).toEqual([
      wrong("module-fixtures", "dependencies", "shared-kernel"),
      wrong("module-fixtures", "devDependencies", "claim"),
    ]);
  });

  it("asks module-fixtures for the check script, like a module", () => {
    expect(
      violations(
        repo({
          "packages/module-fixtures/package.json": packageJson("module-fixtures", {
            scripts: { "lint-effect": lintEffect },
          }),
        }),
      ),
    ).toEqual([
      'packages/module-fixtures/package.json must have the check script "vp check", so that Nx lints and type-checks the package (docs/adr/0026).',
    ]);
  });

  it("asks module-fixtures for the lint-effect script, like a module", () => {
    expect(
      violations(
        repo({
          ...manifest("module-fixtures"),
          "packages/module-fixtures/package.json": packageJson("module-fixtures", {
            scripts: { check: "vp check" },
          }),
        }),
      ),
    ).toEqual([
      `packages/module-fixtures/package.json must have the lint-effect script "${lintEffect}", so that effect-tsgo checks the module (docs/adr/0028).`,
    ]);
  });

  it("asks ui for no place in moduleOrder, no index.ts, no lint-effect script, and its own exports", () => {
    const uiExports = {
      "./globals.css": "./src/styles/globals.css",
      "./components/*": "./src/components/*.tsx",
      "./hooks/*": "./src/hooks/*.ts",
      "./lib/*": "./src/lib/*.ts",
    };
    const ui = (fields: Record<string, unknown>) => ({
      "packages/ui/package.json": packageJson("ui", { exports: uiExports, ...fields }),
    });
    expect(violations(repo(ui({})))).toEqual([]);
    expect(violations(repo(ui({ exports: { ".": "./src/index.ts" } })))).toEqual([
      `packages/ui/package.json must have the exports ${JSON.stringify(uiExports)}, the folders of the parts and the CSS and nothing else (docs/adr/0034).`,
    ]);
    expect(
      violations(
        repo(ui({ dependencies: { "@agent-software-factory/shared-kernel": "workspace:*" } })),
      ),
    ).toEqual([wrong("ui", "dependencies", "shared-kernel")]);
  });

  it("refuses a module that depends on ui", () => {
    expect(
      violations(
        repo(manifest("claim", { dependencies: { "@agent-software-factory/ui": "workspace:*" } })),
      ),
    ).toEqual([wrong("claim", "dependencies", "ui")]);
  });

  it("asks i18n for no place in moduleOrder, no lint-effect script, and refuses a workspace package it depends on", () => {
    const i18n = (fields: Record<string, unknown>) => ({
      "packages/i18n/package.json": packageJson("i18n", fields),
      "packages/i18n/src/index.ts": "",
    });
    expect(violations(repo(i18n({})))).toEqual([]);
    expect(
      violations(
        repo(i18n({ dependencies: { "@agent-software-factory/shared-kernel": "workspace:*" } })),
      ),
    ).toEqual([wrong("i18n", "dependencies", "shared-kernel")]);
  });

  it("refuses a module that depends on i18n", () => {
    expect(
      violations(
        repo(
          manifest("claim", { dependencies: { "@agent-software-factory/i18n": "workspace:*" } }),
        ),
      ),
    ).toEqual([wrong("claim", "dependencies", "i18n")]);
  });

  it("passes a dependency outside the workspace, and one of a longer scope", () => {
    expect(
      violations(
        repo(
          manifest("claim", {
            dependencies: { effect: "catalog:", "@agent-software-factory-x/approval": "1.0.0" },
          }),
        ),
      ),
    ).toEqual([]);
  });

  it("refuses a package under packages/ that is not a module of the table", () => {
    expect(violations(repo(manifest("billing", { dependencies: workspace })))).toEqual([
      `packages/billing is not in moduleOrder in ${table}, so nothing checks which modules it depends on. Add it in the direction the modules depend (docs/adr/0026, docs/domain-model/add-module.md).`,
    ]);
  });
});

// The parts of the fixture of packages/db (docs/adr/0038), and a file that has all three.
describe("ADR 0026: the events package of each module", () => {
  const events = (module: string) => `packages/${module}/events/package.json`;
  const wrongDependency = (module: string, field: string, dependency: string) =>
    `${events(module)} has @agent-software-factory/${dependency} in ${field}. An events package depends on zod and shared-kernel only: the schemas of the events must not pull in the code of a module (docs/adr/0026).`;
  const workspace = { "@agent-software-factory/claim": "workspace:*" };

  it("passes the events packages of the passing repository", () => {
    expect(violations(repo())).toEqual([]);
  });

  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "refuses an events package that depends on a package of the workspace but shared-kernel, in %s",
    (field) => {
      expect(violations(repo(eventsFiles("approval", { [field]: workspace })))).toEqual([
        wrongDependency("approval", field, "claim"),
      ]);
    },
  );

  it("refuses an events package that depends on the module it belongs to", () => {
    expect(
      violations(
        repo(
          eventsFiles("claim", {
            dependencies: { "@agent-software-factory/claim": "workspace:*" },
          }),
        ),
      ),
    ).toEqual([wrongDependency("claim", "dependencies", "claim")]);
  });

  it("refuses an events package that has the tag type:module", () => {
    expect(
      violations(
        repo(eventsFiles("claim", { nx: { name: "claim-events", tags: ["type:module"] } })),
      ),
    ).toEqual([
      `${events("claim")} has the tag type:module. An events package is not a module: a module is a name of moduleOrder, and the tag would ask for a place there (docs/adr/0026).`,
    ]);
  });

  it("takes package.json and events/package.json from packages/<name>/ only, and by that exact name", () => {
    const stray = {
      "vendor/packages/stray/events/package.json": "{}",
      "packages/stray/events/package.json.bak": "{}",
      "vendor/packages/stray/package.json": "{}",
      "packages/stray/package.json.bak": "{}",
    };
    expect(eventsPackages(new Tree(repo(stray)))).toEqual(eventsPackages(new Tree(repo())));
    expect(packageNames(new Tree(repo(stray)))).toEqual(packageNames(new Tree(repo())));
  });

  it("leaves shared-kernel, ui, i18n, telemetry, logging and db out of the module packages", () => {
    const names = ["shared-kernel", "ui", "i18n", "telemetry", "logging", "db"];
    const tree = new Tree(
      repo(Object.fromEntries(names.map((name) => [`packages/${name}/package.json`, "{}"]))),
    );
    expect(packageNames(tree)).toEqual(expect.arrayContaining(names));
    expect(modulePackageNames(tree).filter((name) => names.includes(name))).toEqual([]);
    expect(modulePackageNames(tree)).toContain("module-fixtures");
  });

  it("says in the hint what to write for the @/* import", () => {
    expect(pathsHint).toContain("compilerOptions.paths");
    expect(pathsHint).toContain("./src/");
    expect(pathsHint).toContain("docs/adr/0033");
  });

  it("refuses an events package under a directory that is not a module of moduleOrder", () => {
    expect(violations(repo(eventsFiles("shared-kernel")))).toEqual([
      `packages/shared-kernel/events is an events package, but shared-kernel is not a module of moduleOrder in tools/scripts/src/checks/repo-policy/modules.ts. Only a module has one (docs/adr/0026, docs/domain-model/add-module.md).`,
    ]);
  });

  it("refuses the name of an events package in moduleOrder", () => {
    expect(
      eventsPackages(new Tree(repo()), ["closing", "approval", "claim", "claim-events"]),
    ).toEqual([
      "claim-events is in moduleOrder in tools/scripts/src/checks/repo-policy/modules.ts, but it is the name of an events package, which is not a module. Take it out; an events package is not in moduleOrder (docs/adr/0026).",
    ]);
  });

  it("refuses a module with no events package", () => {
    expect(
      violations(
        repo({ ...eventsFiles("claim"), "packages/claim/events/package.json": undefined }),
      ),
    ).toEqual([
      `packages/claim has no events package at packages/claim/events/package.json. Every module has one, for the events it sends to the other modules (docs/adr/0026, docs/domain-model/add-module.md).`,
    ]);
  });

  it("refuses the name, the exports, the Nx project name, the check script and the index.ts that differ", () => {
    expect(
      violations(
        repo({
          ...eventsFiles("claim", {
            name: "@agent-software-factory/claim",
            exports: { ".": "./src/index.ts", "./x": "./src/x.ts" },
            scripts: {},
            nx: { name: "claim" },
          }),
          "packages/claim/events/src/index.ts": undefined,
        }),
      ),
    ).toEqual([
      `${events("claim")} must have the name "@agent-software-factory/claim-events", the scope and the module and events (docs/adr/0026).`,
      `${events("claim")} must have the exports {".":"./src/index.ts"}, so that another package can import only its src/index.ts (docs/adr/0026).`,
      `packages/claim/events/src/index.ts, the public API that the exports name, does not exist (docs/adr/0026).`,
      `${events("claim")} must have the test script "vp test run", so that Nx runs the check of the past versions of the events (docs/async/event-contract.md).`,
      `${events("claim")} must have the Nx project name "claim-events" (nx.name), the module and events (docs/adr/0026).`,
      `${events("claim")} must have the check script "vp check", so that Nx lints and type-checks the package (docs/adr/0026).`,
    ]);
  });

  it("refuses an events package with no test script, no versions test or no fixture", () => {
    expect(
      violations(
        repo({
          ...eventsFiles("claim", { scripts: { check: "vp check" } }),
          "packages/claim/events/test/versions.test.ts": undefined,
          "packages/claim/events/test/fixtures/claim.done.v1.json": undefined,
        }),
      ),
    ).toEqual([
      `${events("claim")} must have the test script "vp test run", so that Nx runs the check of the past versions of the events (docs/async/event-contract.md).`,
      "packages/claim/events/test/versions.test.ts does not exist. It checks the schemas against the fixtures of the past versions (docs/async/event-contract.md).",
      "packages/claim/events/test/fixtures/ has no <kind>.v<version>.json. Each event has a fixture of its current version (docs/async/event-contract.md).",
    ]);
  });

  it("lets each module depend on the events package of any module, itself included", () => {
    const events = (module: string) => ({
      [`@agent-software-factory/${module}-events`]: "workspace:*",
    });
    expect(
      violations(
        repo({
          ...packageFiles("claim", {
            dependencies: {
              "@agent-software-factory/shared-kernel": "workspace:*",
              ...events("closing"),
            },
          }),
          ...packageFiles("approval", {
            dependencies: { "@agent-software-factory/claim": "workspace:*", ...events("approval") },
            devDependencies: events("claim"),
          }),
        }),
      ),
    ).toEqual([]);
  });

  it("refuses a module that depends on the events package of a module that does not exist, and shared-kernel on any", () => {
    expect(
      violations(
        repo({
          ...packageFiles("claim", {
            dependencies: { "@agent-software-factory/billing-events": "workspace:*" },
          }),
          ...packageFiles("shared-kernel", {
            dependencies: { "@agent-software-factory/claim-events": "workspace:*" },
          }),
        }),
      ),
    ).toEqual([
      `packages/claim/package.json has @agent-software-factory/billing-events in dependencies. A module depends only on shared-kernel and the modules after it in closing → approval → claim, and shared-kernel, module-fixtures, ui, i18n, telemetry and logging on none: move the code that needs billing-events, or move what both need into shared-kernel (docs/adr/0026).`,
      `packages/shared-kernel/package.json has @agent-software-factory/claim-events in dependencies. A module depends only on shared-kernel and the modules after it in closing → approval → claim, and shared-kernel, module-fixtures, ui, i18n, telemetry and logging on none: move the code that needs claim-events, or move what both need into shared-kernel (docs/adr/0026).`,
    ]);
  });

  it("still refuses a module that depends on the body of a module before it", () => {
    expect(
      violations(
        repo(
          packageFiles("claim", {
            dependencies: { "@agent-software-factory/approval": "workspace:*" },
          }),
        ),
      ),
    ).toEqual([
      `packages/claim/package.json has @agent-software-factory/approval in dependencies. A module depends only on shared-kernel and the modules after it in closing → approval → claim, and shared-kernel, module-fixtures, ui, i18n, telemetry and logging on none: move the code that needs approval, or move what both need into shared-kernel (docs/adr/0026).`,
    ]);
  });
});

describe("ADR 0026: a module with the tag type:module is registered everywhere", () => {
  const order = "tools/scripts/src/checks/repo-policy/modules.ts";
  const guide = "Follow docs/domain-model/add-module.md.";

  it("passes the modules of the passing repository, each in moduleOrder, the dependencies of apps/api and app.ts", () => {
    expect(violations(repo())).toEqual([]);
  });

  it("refuses a package with the tag that is not in moduleOrder", () => {
    expect(
      violations(repo(packageFiles("extra", { nx: { name: "extra", tags: ["type:module"] } }))),
    ).toEqual([
      `packages/extra is not in moduleOrder in ${order}, so nothing checks which modules it depends on. Add it in the direction the modules depend (docs/adr/0026, docs/domain-model/add-module.md).`,
      `packages/extra has the tag type:module but is not in moduleOrder in ${order}. ${guide}`,
      'apps/api/package.json must have @agent-software-factory/extra: "workspace:*" in dependencies, since packages/extra has the tag type:module. ' +
        guide,
      `apps/api/src/app.ts must import @agent-software-factory/extra, since packages/extra has the tag type:module. ${guide}`,
    ]);
  });

  it.each([
    ["no tag", { nx: { name: "claim" } }],
    ["another tag", { nx: { name: "claim", tags: ["type:util"] } }],
    ["tags that are not a list", { nx: { name: "claim", tags: "type:module" } }],
  ])("refuses a name of moduleOrder whose package has %s", (_, fields) => {
    expect(violations(repo(packageFiles("claim", fields)))).toEqual([
      `claim is in moduleOrder in ${order}, but no package under packages/ named claim has the tag type:module in nx.tags of its package.json. ${guide}`,
    ]);
  });

  it("refuses a name of moduleOrder that has no package", () => {
    expect(violations(repo({ "packages/closing/package.json": undefined }))).toEqual([
      `closing is in moduleOrder in ${order}, but no package under packages/ named closing has the tag type:module in nx.tags of its package.json. ${guide}`,
    ]);
  });

  it("refuses a module that apps/api lacks in dependencies, lists with a version, or lists only in devDependencies", () => {
    const { "@agent-software-factory/claim": _, ...others } = apiDependencies;
    const message = `apps/api/package.json must have @agent-software-factory/claim: "workspace:*" in dependencies, since packages/claim has the tag type:module. ${guide}`;
    const withApi = (fields: Record<string, unknown>) =>
      violations(repo({ "apps/api/package.json": json(fields) }));
    expect(withApi({ dependencies: others })).toEqual([message]);
    expect(
      withApi({ dependencies: { ...others, "@agent-software-factory/claim": "1.0.0" } }),
    ).toEqual([message]);
    expect(
      withApi({
        dependencies: others,
        devDependencies: { "@agent-software-factory/claim": "workspace:*" },
      }),
    ).toEqual([message]);
  });

  it("refuses an apps/api/src/app.ts that does not import a module", () => {
    const path = "apps/api/src/app.ts";
    expect(violations(repo({ [path]: 'import "@agent-software-factory/approval";\n' }))).toEqual([
      expect.stringContaining(`${path} must import @agent-software-factory/claim,`),
      expect.stringContaining(`${path} must import @agent-software-factory/closing,`),
    ]);
    expect(violations(repo({ [path]: undefined }))).toHaveLength(3);
  });

  it("takes a type import, a side-effect import and an import of several lines", () => {
    const imports = [
      'import type { X } from "@agent-software-factory/claim";',
      'import "@agent-software-factory/approval";',
      'import {\n  Y,\n} from "@agent-software-factory/closing";',
    ].join("\n");
    expect(violations(repo({ "apps/api/src/app.ts": imports }))).toEqual([]);
  });
});

describe("ADR 0038: db depends on the modules by type only, and only apps/api and apps/worker depend on db", () => {
  const dbExports = {
    "./node": "./src/node.ts",
    "./seed": "./src/seed/index.ts",
    "./testing": "./src/testing/index.ts",
  };
  const db = (fields: Record<string, unknown> = {}) => ({
    "packages/db/package.json": packageJson("db", {
      exports: dbExports,
      scripts: { check: "vp check" },
      ...fields,
    }),
    "packages/db/src/node.ts": "export {};\n",
  });
  const claim = { "@agent-software-factory/claim": "workspace:*" };
  const dbDependency = { "@agent-software-factory/db": "workspace:*" };
  const dbHas = (dependency: string, field: string) =>
    `packages/db/package.json has @agent-software-factory/${dependency} in ${field}. db depends on the modules by \`import type\` only, so it lists them in devDependencies and no other package of the workspace: move the code that needs ${dependency} out of db (docs/adr/0038).`;
  const refused = (path: string, field: string) =>
    `${path} has @agent-software-factory/db in ${field}. Only apps/api and apps/worker depend on db: the modules, shared-kernel, ui and the other apps and tools have no use for the tools of the database (docs/adr/0038).`;

  it("passes db with the modules in devDependencies, without a place in moduleOrder or a lint-effect script", () => {
    expect(
      violations(repo({ ...db({ devDependencies: claim, dependencies: { pg: "catalog:" } }) })),
    ).toEqual([]);
  });

  it("passes apps/api that depends on db", () => {
    expect(
      violations(
        repo({
          ...db(),
          "apps/api/package.json": apiManifest({
            dependencies: { ...apiDependencies, ...dbDependency },
          }),
        }),
      ),
    ).toEqual([]);
  });

  it("passes apps/worker that depends on db", () => {
    expect(
      violations(
        repo({
          ...db(),
          "apps/worker/package.json": packageJson("worker", {
            dependencies: dbDependency,
          }),
        }),
      ),
    ).toEqual([]);
  });

  it.each(["dependencies", "peerDependencies", "optionalDependencies"])(
    "refuses db that depends on a module in %s",
    (field) => {
      expect(violations(repo({ ...db({ [field]: claim }) }))).toEqual([dbHas("claim", field)]);
    },
  );

  it.each(["shared-kernel", "ui", "api", "web"])(
    "refuses db that depends on %s, even in devDependencies",
    (name) => {
      expect(
        violations(
          repo({
            ...db({ devDependencies: { [`@agent-software-factory/${name}`]: "workspace:*" } }),
          }),
        ),
      ).toEqual([dbHas(name, "devDependencies")]);
    },
  );

  it("refuses db that depends on itself or on a package that is not a module", () => {
    expect(
      violations(
        repo({
          ...db({
            devDependencies: {
              "@agent-software-factory/db": "workspace:*",
              "@agent-software-factory/billing": "workspace:*",
            },
          }),
        }),
      ),
    ).toEqual([dbHas("db", "devDependencies"), dbHas("billing", "devDependencies")]);
  });

  it("passes db's dependencies outside the workspace, and of a longer scope", () => {
    expect(
      violations(
        repo({
          ...db({
            devDependencies: { "@agent-software-factory-x/claim": "1.0.0", typescript: "catalog:" },
          }),
        }),
      ),
    ).toEqual([]);
  });

  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "refuses a module, shared-kernel, ui or an app other than apps/api that depends on db, in %s",
    (field) => {
      expect(
        violations(
          repo({
            ...db(),
            "packages/claim/package.json": packageJson("claim", { [field]: dbDependency }),
            "packages/shared-kernel/package.json": packageJson("shared-kernel", {
              [field]: dbDependency,
            }),
            "apps/web/package.json": json({ [field]: dbDependency }),
          }),
        ),
      ).toEqual([
        refused("apps/web/package.json", field),
        refused("packages/claim/package.json", field),
        refused("packages/shared-kernel/package.json", field),
      ]);
    },
  );

  it("refuses the root package.json that depends on db", () => {
    expect(
      violations(
        repo({
          ...db(),
          "package.json": json({
            engines: { node: "^24" },
            devDependencies: { nx: "catalog:", ...dbDependency },
          }),
        }),
      ),
    ).toEqual([refused("package.json", "devDependencies")]);
  });

  it("does not ask who depends on db when there is no db", () => {
    expect(
      violations(repo({ "apps/web/package.json": json({ dependencies: dbDependency }) })),
    ).toEqual([]);
  });

  it.each([
    ["exports of the production entry only", { "./node": "./src/node.ts" }],
    ["no seed", { "./node": "./src/node.ts", "./testing": "./src/testing/index.ts" }],
    ["a subpath too", { ...dbExports, "./x": "./src/x.ts" }],
  ])("refuses db with %s", (_, exports) => {
    expect(violations(repo({ ...db({ exports }) }))).toEqual([
      `packages/db/package.json must have the exports ${JSON.stringify(dbExports)}, the Node-only entry of production, the seed and the tools of the tests, and nothing else (docs/adr/0038, 0051).`,
    ]);
  });

  it("asks db for the check script and the file of every export, like every package", () => {
    expect(
      violations(repo({ ...db({ scripts: {} }), "packages/db/src/node.ts": undefined })),
    ).toEqual([
      "packages/db/src/node.ts, the public API that the exports name, does not exist (docs/adr/0026).",
      'packages/db/package.json must have the check script "vp check", so that Nx lints and type-checks the package (docs/adr/0026).',
    ]);
  });
});

describe("ADR 0048: packages/telemetry", () => {
  const exports = { ".": "./src/index.ts", "./node": "./src/node.ts" };
  const withTelemetry = (fields: Record<string, unknown> = {}) =>
    repo(packageFiles("telemetry", { exports, ...fields }));

  it("passes telemetry with its two exports", () => {
    expect(violationsWithoutOrder(withTelemetry())).toEqual([]);
  });

  it("is not a module: it is left out of the module packages and may depend on none", () => {
    const tree = new Tree(withTelemetry());
    expect(modulePackageNames(tree)).not.toContain("telemetry");
    expect(
      violations(
        withTelemetry({ dependencies: { "@agent-software-factory/claim": "workspace:*" } }),
      ),
    ).toEqual([
      "packages/telemetry/package.json has @agent-software-factory/claim in dependencies. A module depends only on shared-kernel and the modules after it in closing → approval → claim, and shared-kernel, module-fixtures, ui, i18n, telemetry and logging on none: move the code that needs claim, or move what both need into shared-kernel (docs/adr/0026).",
    ]);
  });

  it.each([
    ["only the entry for any code", { ".": "./src/index.ts" }],
    ["a subpath too", { ...exports, "./x": "./src/x.ts" }],
  ])("refuses telemetry with %s", (_, wrong) => {
    expect(violations(repo(packageFiles("telemetry", { exports: wrong })))).toEqual([
      `packages/telemetry/package.json must have the exports ${JSON.stringify(exports)}, the entry for any code and the Node-only entry that starts the SDK, and nothing else (docs/adr/0048).`,
    ]);
  });
});

describe("ADR 0049: packages/logging", () => {
  const exports = {
    ".": "./src/index.ts",
    "./node": "./src/node.ts",
    "./testing": "./src/testing.ts",
  };

  it("passes logging with its three exports", () => {
    const withLogging = repo(packageFiles("logging", { exports }));
    expect(violations(withLogging)).toEqual([]);
    expect(modulePackageNames(new Tree(withLogging))).not.toContain("logging");
  });

  it("refuses logging with an export other than the three entries", () => {
    expect(
      violations(repo(packageFiles("logging", { exports: { ".": "./src/index.ts" } }))),
    ).toEqual([
      `packages/logging/package.json must have the exports ${JSON.stringify(exports)}, the entry for any code, the Node-only entry that creates the pino logger, and the tools of the tests, and nothing else (docs/adr/0049).`,
    ]);
  });
});

describe("ADR 0026: nothing resolves a package that a package.json does not declare", () => {
  const resolves = (path: string, what: string) =>
    `${path} ${what}, which lets a package resolve a package that its package.json does not declare. The direction between the modules rests on that not resolving (docs/adr/0026).`;
  // paths and alias also say what to write for `@/*`; baseUrl and the pnpm settings do not.
  const resolvesWithHint = (path: string, what: string) => `${resolves(path, what)} ${pathsHint}`;
  const workspace = base["pnpm-workspace.yaml"] ?? "";

  it.each(["paths", "baseUrl"])(
    "refuses a tsconfig.json that sets %s, at the root or in a project",
    (option) => {
      expect(
        violations(
          repo({
            "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, [option]: {} } }),
            "packages/claim/tsconfig.json": JSON.stringify({
              extends: "../../tsconfig.json",
              compilerOptions: { [option]: "." },
            }),
          }),
        ).filter((failure) => failure.includes("lets a package resolve")),
      ).toEqual([
        (option === "paths" ? resolvesWithHint : resolves)(
          "packages/claim/tsconfig.json",
          `sets compilerOptions.${option}`,
        ),
        (option === "paths" ? resolvesWithHint : resolves)(
          "tsconfig.json",
          `sets compilerOptions.${option}`,
        ),
      ]);
    },
  );

  it("passes a tsconfig.json whose paths only name files under its own src/", () => {
    expect(
      violations(
        repo({
          "apps/web/tsconfig.json": JSON.stringify({
            compilerOptions: { paths: { "@/*": ["./src/*"] } },
          }),
        }),
      ).filter((failure) => failure.includes("lets a package resolve")),
    ).toEqual([]);
  });

  it.each([
    ["a target outside src/", { "@/*": ["../../packages/closing/src/*"] }],
    ["a target that leaves src/ with ..", { "@/*": ["./src/../../x"] }],
    ["a target that is not a list", { "@/*": "./src/*" }],
    ["an empty list of targets", { "@/*": [] }],
    ["one entry outside src/", { "@/*": ["./src/*"], "#x": ["./lib/x.ts"] }],
    ["one target outside src/ in a list", { "@/*": ["./src/*", "../x/*"] }],
    ["a target that is not a string", { "@/*": [5] }],
  ])("refuses a tsconfig.json whose paths have %s", (_name, paths) => {
    expect(
      violations(
        repo({ "apps/web/tsconfig.json": JSON.stringify({ compilerOptions: { paths } }) }),
      ).filter((failure) => failure.includes("lets a package resolve")),
    ).toEqual([resolvesWithHint("apps/web/tsconfig.json", "sets compilerOptions.paths")]);
  });

  it.each([
    ["an alias", "resolve: { alias: { x: 'y' } },"],
    ["an alias with a space before the colon", "alias : [],"],
    ["an alias in the shorthand", "resolve: { alias },"],
    ["an alias in the shorthand with others", "resolve: { alias, dedupe },"],
    ["an alias after a URL", 'base: "https://x", alias: {},'],
    ["an alias after a comment line", "// a comment\nalias: {},"],
  ])("refuses a vite.config.ts with %s", (_, line) => {
    expect(
      violations(repo({ "apps/web/vite.config.ts": `export default {\n  ${line}\n};\n` })),
    ).toEqual([resolvesWithHint("apps/web/vite.config.ts", "sets an alias")]);
  });

  it("keeps what comes before a comment on the line of the alias", () => {
    expect(
      violations(repo({ "apps/web/vite.config.ts": "export default {alias}// a comment\n" })),
    ).toEqual([resolvesWithHint("apps/web/vite.config.ts", "sets an alias")]);
  });

  it("passes the word alias that is not a key, and a key of a longer name", () => {
    expect(
      violations(
        repo({
          "apps/web/vite.config.ts":
            "// global is an alias, of globalThis: { alias }\nexport default { realias: 1, aliases: [] };\n",
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["shamefullyHoist: true", "sets shamefullyHoist"],
    ["nodeLinker: hoisted", "sets nodeLinker: hoisted"],
    [
      'publicHoistPattern:\n  - "*"',
      "has * in publicHoistPattern, which hoists @agent-software-factory/approval",
    ],
    [
      'publicHoistPattern:\n  - "*eslint*"\n  - "@agent-software-factory/*"',
      "has @agent-software-factory/* in publicHoistPattern, which hoists @agent-software-factory/approval",
    ],
    [
      'publicHoistPattern:\n  - "@agent-software-factory/claim"',
      "has @agent-software-factory/claim in publicHoistPattern, which hoists @agent-software-factory/claim",
    ],
    [
      'publicHoistPattern:\n  - "*claim*"',
      "has *claim* in publicHoistPattern, which hoists @agent-software-factory/claim",
    ],
  ])("refuses a pnpm-workspace.yaml with %s", (setting, what) => {
    expect(violations(repo({ "pnpm-workspace.yaml": `${workspace}${setting}\n` }))).toEqual([
      resolves("pnpm-workspace.yaml", what),
    ]);
  });

  it("refuses a pattern that hoists any package under packages/, and only the packages there", () => {
    const pattern = 'publicHoistPattern:\n  - "@agent-software-factory/extra"\n';
    expect(violations(repo({ "pnpm-workspace.yaml": `${workspace}${pattern}` }))).toEqual([]);
    expect(
      violations(
        repo({
          "pnpm-workspace.yaml": `${workspace}${pattern}`,
          ...packageFiles("extra"),
        }),
      ),
    ).toContainEqual(
      resolves(
        "pnpm-workspace.yaml",
        "has @agent-software-factory/extra in publicHoistPattern, which hoists @agent-software-factory/extra",
      ),
    );
  });

  it.each([
    "shamefullyHoist: false",
    "nodeLinker: isolated",
    'publicHoistPattern:\n  - "*eslint*"\n  - "@agent-software-factory-x/*"\n  - "@agent-software-factory/claim-x"\n  - "x@agent-software-factory/claim"\n  - 1',
    "publicHoistPattern: '*'",
  ])("passes a pnpm-workspace.yaml with %s", (setting) => {
    expect(violations(repo({ "pnpm-workspace.yaml": `${workspace}${setting}\n` }))).toEqual([]);
  });
});

describe("ADR 0028: every module runs the Effect lint", () => {
  const missing = (name: string) =>
    `packages/${name}/package.json must have the lint-effect script "${lintEffect}", so that effect-tsgo checks the module (docs/adr/0028).`;

  it.each([
    ["no lint-effect script", {}],
    [
      "a lint-effect script of one layer",
      { "lint-effect": lintEffect.replace(" src/infrastructure", "") },
    ],
    [
      "a lint-effect script of another config",
      { "lint-effect": lintEffect.replace("oxlint.effect", "oxlint") },
    ],
  ])("refuses a module with %s", (_, scripts) => {
    expect(
      violations(
        repo({
          "packages/claim/package.json": packageJson("claim", {
            scripts: { check: "vp check", ...scripts },
          }),
        }),
      ),
    ).toEqual([missing("claim")]);
  });

  it("refuses a module without the lint-effect script, and does not ask shared", () => {
    expect(
      violations(
        repo({
          "packages/claim/package.json": packageJson("claim", { scripts: { check: "vp check" } }),
          "packages/shared-kernel/package.json": packageJson("shared-kernel", {
            scripts: { check: "vp check", "lint-effect": "x" },
          }),
        }),
      ),
    ).toEqual([missing("claim")]);
  });
});

describe("steering frontmatter: the edges", () => {
  const guide = "(docs/knowledge/steering-authoring.md)";

  it("names the file by its whole name", () => {
    expect(violations(repo({ ".kiro/steering/long-name.md": "no frontmatter\n" }))).toEqual([
      `.kiro/steering/long-name.md: must start with a frontmatter block ${guide}`,
    ]);
  });

  it.each(['" "', "1"])("refuses a description of %s", (description) => {
    const text = `---\ninclusion: auto\nname: x\ndescription: ${description}\n---\n`;
    expect(violations(repo({ ".kiro/steering/x.md": text }))).toEqual([
      `.kiro/steering/x.md: description is required ${guide}`,
    ]);
  });

  // The untracked files come from the pathspec .kiro/steering/*.md, whose * matches / too (gitglossary(7)).
  it("checks tracked steering files at any depth, as the pathspec does for untracked ones", () => {
    expect(violations(repo({ ".kiro/steering/sub/y.md": "x\n" }))).toEqual([
      `.kiro/steering/sub/y.md: must start with a frontmatter block ${guide}`,
    ]);
  });

  it("does not check other files that look like steering", () => {
    expect(
      violations(
        repo({
          ".kiro/steering/old.md.bak": "x\n",
          ".kiro/steeringx.md": "x\n",
          "apps/.kiro/steering/x.md": "x\n",
        }),
      ),
    ).toEqual([]);
  });
});

describe("git on another repository: the edges", () => {
  const wrapper = "tools/scripts/sh/guard-push.sh";
  const anywhere = (path: string) =>
    `${path} runs git on another repository. A shell wrapper runs git only on the repository it runs in; write a test that needs another repository in TypeScript, with gitIn (docs/adr/0024).`;

  it.each([
    ["git and init apart", "#!/bin/sh\ngit  init x\n"],
    ["git and -C apart", "#!/bin/sh\ngit  -C x log\n"],
    ["git at the start of the file", "git clone a b\n"],
    ["git init at the end of the file", "#!/bin/sh\ngit init"],
  ])("refuses %s", (_, text) => {
    expect(violations(repo({ [wrapper]: text }))).toEqual([anywhere(wrapper)]);
  });

  // check-repo-policy.sh grepped line by line, so a match never spans two lines.
  it.each([
    ["git and init", "echo git\ninit x\n"],
    ["git and -C", "echo git\n-C x\n"],
    ["-C and its argument", "git -C\nx\n"],
  ])("passes %s on separate lines", (_, text) => {
    expect(violations(repo({ [wrapper]: `#!/bin/sh\n${text}` }))).toEqual([]);
  });
});

describe("ADR 0013: the edges", () => {
  it("refuses a .node-version that does not start with the version", () => {
    expect(violations(repo({ ".node-version": "lts-24\n" }))).toEqual([
      ".node-version must start with a Node.js version such as 24 or 24.22.1 (docs/adr/0013).",
    ]);
  });

  it("reads a @types/node catalog entry that YAML reads as a number", () => {
    expect(violations(repo({ "pnpm-workspace.yaml": 'catalog:\n  "@types/node": 24\n' }))).toEqual(
      [],
    );
  });

  it.each([["latest"], [["24"]], [{ major: 24 }]])(
    "names an engines.node of %j unreadable",
    (node) => {
      expect(violations(repo({ "package.json": json({ engines: { node } }) }))).toEqual([
        "package.json engines.node (unreadable) must be Node.js 24, the major of .node-version (docs/adr/0013).",
      ]);
    },
  );

  it("reads a build target written without a space", () => {
    const config = 'export default { build: { target:"node25" } };\n';
    expect(violations(repo({ "apps/web/vite.config.ts": config }))).toEqual([
      "apps/web/vite.config.ts builds for node25, but .node-version is Node.js 24 (docs/adr/0013).",
    ]);
  });
});

describe("ADR numbers: the edges", () => {
  it("does not count files that only look like ADRs", () => {
    expect(
      violations(repo({ "docs/adr/0001-old.md.bak": "# x\n", "apps/docs/adr/0001-a.md": "# x\n" })),
    ).toEqual([]);
  });
});

describe("configuration files that cannot be parsed: the messages", () => {
  it.each([
    [
      ".github/workflows/ci.yml",
      "jobs: [\n",
      "YAML (YAMLParseError: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1)",
    ],
    ["mise.toml", "[tools\n", "TOML (Error: Invalid TOML document: illegal character in key)"],
    [
      "apps/api/package.json",
      "{\n",
      "JSON (SyntaxError: Expected property name or '}' in JSON at position 2 (line 2 column 1))",
    ],
  ])("names %s and the first line of the parser error", (path, text, error) => {
    expect(violations(repo({ [path]: text }))[0]).toBe(`${path} is not valid ${error}`);
  });

  it("reports a file once, however many checks read it", () => {
    const failures = violations(repo({ "package.json": "{\n" }));
    expect(failures.filter((failure) => failure.startsWith("package.json is not valid"))).toEqual([
      "package.json is not valid JSON (SyntaxError: Expected property name or '}' in JSON at position 2 (line 2 column 1))",
    ]);
  });
});

describe("references from docs/ to files of the code", () => {
  const cite = (line: string, path = "docs/tooling/ci.md") => ({
    [path]: `# A doc\n\n${line}\n`,
  });
  const missing = (path: string, source = "docs/tooling/ci.md") =>
    `${source} cites ${path}, which does not exist. The file was moved or removed: write its path now, or the directory it is in.`;

  it.each([
    ["a path", "`tools/a.ts`", ["tools/a.ts"]],
    ["two paths", "`apps/a.json` and `packages/b/c.d.ts`", ["apps/a.json", "packages/b/c.d.ts"]],
    ["a path in a dot directory", "`.github/a/b.txt`", [".github/a/b.txt"]],
    ["a Kiro file", "`.kiro/a-b.txt`", [".kiro/a-b.txt"]],
    ["a type file", "`types/a.d.ts`", ["types/a.d.ts"]],
    ["a path in a sentence", "see `tools/a_b/@c.ts` for it", ["tools/a_b/@c.ts"]],
  ])("passes %s that exists", (_, line, exists) => {
    expect(
      violations(repo({ ...cite(line), ...Object.fromEntries(exists.map((path) => [path, ""])) })),
    ).toEqual([]);
  });

  it.each([
    ["tools/scripts/src/checks/repo-policy/missing.ts"],
    [".github/workflows/missing.yml"],
    [".kiro/hooks/missing.json"],
    ["tools/scripts/src/checks/repo-policy/cli.ts.map"],
    ["packages/module-fixtures/src/missing.ts"],
    ["apps/api/missing.json"],
    ["types/missing.d.ts"],
    ["tools/scripts/src/a-b_c.d/@x.ts"],
  ])("refuses `%s`, which does not exist", (path) => {
    expect(violations(repo(cite(`\`${path}\``)))).toEqual([missing(path)]);
  });

  it("names each citing doc, and each path once per citation", () => {
    expect(
      violations(
        repo({
          ...cite("`tools/a.ts` and `tools/b.ts`", "docs/a.md"),
          ...cite("`tools/a.ts`", "docs/tooling/b.md"),
        }),
      ),
    ).toEqual([
      missing("tools/a.ts", "docs/a.md"),
      missing("tools/b.ts", "docs/a.md"),
      missing("tools/a.ts", "docs/tooling/b.md"),
    ]);
  });

  it.each([
    ["a directory", "`tools/scripts/src/`"],
    ["a directory without a slash", "`tools/scripts`"],
    ["a glob", "`packages/*/src/index.ts`"],
    ["a placeholder", "`packages/<module>/src/index.ts`"],
    ["a path with a line number", "`tools/scripts/src/a.ts:12`"],
    ["a path in plain text", "see tools/scripts/src/a.ts"],
    ["a path under another top-level directory", "`scripts/a.sh` and `research/a.md`"],
    ["a code span of several words", "`node tools/a.ts`"],
  ])("skips %s", (_, line) => {
    expect(violations(repo(cite(line)))).toEqual([]);
  });

  it("checks the ADRs too", () => {
    expect(violations(repo(cite("`tools/a.ts`", "docs/adr/0002-nx.md")))).toEqual([
      missing("tools/a.ts", "docs/adr/0002-nx.md"),
    ]);
  });

  it("skips a file that is not Markdown, and a file outside docs/", () => {
    expect(
      violations(
        repo({
          ...cite("`tools/a.ts`", "docs/tooling/a.txt"),
          ...cite("`tools/a.ts`", "README.md"),
        }),
      ),
    ).toEqual([]);
  });
});

describe("references to docs/: the edges", () => {
  const withSetup = (setup: string, line: string) => ({
    "docs/local-env-setup/setup.md": setup,
    "lefthook.yml": `${base["lefthook.yml"] ?? ""}# ${line}\n`,
  });

  it.each([
    "apps/docs/a.md",
    "apps/.agents/a.sh",
    "apps/.kiro/skills/a.md",
    "apps/tools/scripts/src/checks/adr-check/a.test.ts",
    "tools/scripts/src/checks/adr-check/a.test.ts.bak",
    "apps/pnpm-lock.yaml",
    "pnpm-lock.yaml.bak",
  ])("checks %s", (path) => {
    expect(violations(repo({ [path]: "docs/adr/9999\n" }))).toEqual([
      `${path} cites docs/adr/9999, which does not exist.`,
    ]);
  });

  it("passes a heading with a number of two digits", () => {
    const files = withSetup(
      "# Setup\n\n## 10. Ubuntu の初期セットアップ\n",
      'docs/local-env-setup/setup.md ("Ubuntu の初期セットアップ")',
    );
    expect(violations(repo(files))).toEqual([]);
  });

  it.each([
    ["a number inside the heading", "## Node 24. Ubuntu", "Node Ubuntu"],
    ["text that is not a heading", "see # Ubuntu", "Ubuntu"],
  ])("does not drop %s", (_, line, heading) => {
    const files = withSetup(`# Setup\n\n${line}\n`, `docs/local-env-setup/setup.md ("${heading}")`);
    expect(violations(repo(files))).toEqual([
      `lefthook.yml cites the heading "${heading}" in docs/local-env-setup/setup.md, which has no such heading.`,
    ]);
  });

  it("passes a file cited without a heading, whatever it holds", () => {
    expect(violations(repo(withSetup("# Setup", "docs/local-env-setup/setup.md")))).toEqual([]);
  });

  it("does not count a file of another type as an ADR", () => {
    const files = {
      "docs/adr/0003-notes.txt": "x\n",
      "lefthook.yml": `${base["lefthook.yml"] ?? ""}# docs/adr/0003\n`,
    };
    expect(violations(repo(files))).toEqual([
      "lefthook.yml cites docs/adr/0003, which does not exist.",
    ]);
  });
});

describe("the permissions of the agents (docs/tooling/agent-permissions.md)", () => {
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

  it("wants a row for the agent in the catalog, and none for an agent that is gone", () => {
    const rows = (base[catalogPath] ?? "")
      .split("\n")
      .filter((line) => !line.includes("kiro-agent"));
    expect(violations(repo({ [catalogPath]: rows.join("\n") }))).toEqual([
      `\`kiro-agent: factory\` has no row in ${catalogPath}. Add a row for the agent.`,
    ]);
    const extra = `${base[catalogPath] ?? ""}| \`kiro-agent: gone\` | x | g | | | t |\n`;
    expect(violations(repo({ [catalogPath]: extra }))).toEqual([
      `${catalogPath} names \`kiro-agent: gone\`, which is not in an agent of .kiro/agents/<name>.json.`,
    ]);
  });
});

describe("ADR 0050: the table of lint restrictions and its fixtures agree", () => {
  type Table = typeof lintRestrictions;
  const tablePath = "lint-restrictions.json";
  const howTo = 'docs/tooling/ci.md ("禁止の表")';
  const outbox = "packages/module-fixtures/src/__fixtures__/outbox.ts";
  const outboxTest = "apps/api/src/__fixtures__/outbox.test.ts";
  const connectionTest = "apps/api/src/__fixtures__/connection.test.ts";
  const consoleFile = "packages/module-fixtures/src/__fixtures__/console.ts";
  // A copy of the table of the passing repository, changed by `change`.
  const table = (change: (copy: Table) => void): string => {
    const copy = structuredClone(lintRestrictions);
    change(copy);
    return JSON.stringify(copy);
  };
  const failures = (files: Record<string, string | undefined>) =>
    allViolations(repo(files)).filter(tableFailure);
  const noStop = (file: string, rule: string, text: string, reason: string, adr: string) =>
    `\`${file}\` に、\`oxlint-disable-next-line ${rule}\` の次の行で \`${text}\` を書いた行がない。${reason} (${adr})。`;
  const noPass = (file: string, text: string, reason: string, adr: string) =>
    `\`${file}\` に、disable のコメントを前に置かずに \`${text}\` を書いた行がない。${reason} (${adr})。`;
  const unlistedStop = (file: string, line: number, rule: string, key: string) =>
    `\`${file}\` の ${line} 行目は \`${rule}\` で止める行だが、${tablePath} の ${key} に、このファイルでこの行を止める行がない。表に行を足すか、fixture から行を消す (${howTo})。`;
  const unlistedPass = (file: string, line: number, key: string) =>
    `\`${file}\` の ${line} 行目は通す行 (前の行に disable のコメントがなく、import か ${key} の文字列を書いた行) だが、${tablePath} の ${key} に、このファイルでこの行を通す行がない。表に行を足すか、fixture から行を消す (${howTo})。`;
  const sqsMissing = noStop(
    outbox,
    "no-restricted-imports",
    '"@x/sqs"',
    "Outbox を通す",
    "docs/adr/0029",
  );

  it("passes when every row has its line, and every line of the fixtures has its row", () => {
    expect(allViolations(repo())).toEqual([]);
  });

  describe("a row of the table", () => {
    it("asks for the line it stops, below the disable comment of its rule", () => {
      expect(failures({ [outbox]: undefined })).toEqual([sqsMissing]);
      expect(failures({ [outbox]: "export const other = 1;\n" })).toEqual([sqsMissing]);
    });

    it("does not count a disable comment that is not on the line above", () => {
      const apart = outboxFixture.replace("\nimport", "\n\nimport");
      expect(failures({ [outbox]: apart })).toEqual([
        sqsMissing,
        unlistedPass(outbox, 3, "outbox"),
      ]);
    });

    it("does not count a disable comment of another rule", () => {
      const other = outboxFixture.replace("no-restricted-imports", "no-restricted-globals");
      expect(failures({ [outbox]: other })).toEqual([
        sqsMissing,
        unlistedStop(outbox, 2, "no-restricted-globals", "outbox"),
      ]);
    });

    it("asks for the line it lets through, with no disable comment above it", () => {
      const missing = noPass(connectionTest, '"pg"', "テストは pool を作る", "docs/adr/0029");
      expect(failures({ [connectionTest]: undefined })).toEqual([missing]);
      expect(failures({ [connectionTest]: connectionStopFixture })).toEqual([
        missing,
        unlistedStop(connectionTest, 2, "no-restricted-imports", "connection"),
      ]);
    });

    it("reads the rule among the rules of the comment, before its reason", () => {
      const several = outboxFixture.replace(
        "no-restricted-imports -- fixture",
        "a/b, no-restricted-imports -- fixture: no-restricted-globals",
      );
      expect(failures({ [outbox]: several })).toEqual([unlistedStop(outbox, 2, "a/b", "outbox")]);
      const inReason = outboxFixture.replace(
        "no-restricted-imports -- fixture",
        "a/b -- no-restricted-imports",
      );
      expect(failures({ [outbox]: inReason })).toEqual([
        sqsMissing,
        unlistedStop(outbox, 2, "a/b", "outbox"),
      ]);
    });

    it("reads a /* */ comment and an indented one", () => {
      const block = outboxFixture.replace(
        "// oxlint-disable-next-line no-restricted-imports -- fixture",
        "  /* oxlint-disable-next-line no-restricted-imports */",
      );
      expect(failures({ [outbox]: block })).toEqual([]);
    });

    it("does not tell a type import from a value import: a disable comment above a type import fails `vp check`", () => {
      const typeOnly = outboxFixture.replace('import "@x/sqs"', 'import type { X } from "@x/sqs"');
      expect(failures({ [outbox]: typeOnly })).toEqual([]);
    });

    it("asks every file of the row", () => {
      expect(failures({ [outbox]: undefined, [outboxTest]: undefined })).toEqual([
        sqsMissing,
        noStop(outboxTest, "no-restricted-imports", '"@x/sqs"', "Outbox を通す", "docs/adr/0029"),
      ]);
    });
  });

  describe("a line of a fixture of the table", () => {
    it("is refused when the table drops the row that stops it", () => {
      const dropped = table((copy) => {
        copy.console.rows.pop();
      });
      expect(failures({ [tablePath]: dropped })).toEqual([
        unlistedStop(consoleFile, 4, "no-restricted-properties", "console"),
      ]);
    });

    it("is refused when the table drops the row that lets it through", () => {
      const dropped = table((copy) => {
        copy.connection.rows.pop();
      });
      expect(failures({ [tablePath]: dropped })).toEqual([
        unlistedPass(connectionTest, 1, "connection"),
      ]);
    });

    it("is read in any file named after a key of the table, also one that no row names", () => {
      const other = "apps/api/src/routes/__fixtures__/connection.ts";
      expect(failures({ [other]: connectionStopFixture })).toEqual([
        unlistedStop(other, 2, "no-restricted-imports", "connection"),
      ]);
      expect(failures({ [other.replace(".ts", ".test.ts")]: connectionPassFixture })).toEqual([
        unlistedPass(other.replace(".ts", ".test.ts"), 1, "connection"),
      ]);
    });

    it("is not read in a file of another name, outside __fixtures__/, or in the fixtures of the checks", () => {
      expect(
        failures({
          "apps/api/src/__fixtures__/connections.ts": connectionStopFixture,
          "apps/api/src/connection.ts": connectionStopFixture,
          "apps/api/src/__fixtures__/connection.md": connectionStopFixture,
          "tools/scripts/src/checks/other/__fixtures__/connection.ts": connectionStopFixture,
        }),
      ).toEqual([]);
    });

    it("passes a line of a fixture that has no text of the restriction", () => {
      expect(
        failures({
          [connectionTest]: `${connectionPassFixture}export const x = 1;\n// a note on "pg"\n`,
        }),
      ).toEqual([]);
    });
  });

  describe("the values of a restriction", () => {
    it("asks each file that stops the restriction for a row of each value", () => {
      const added = table((copy) => {
        copy.outbox.values.push("@x/ses");
      });
      const missing = (file: string) =>
        `${tablePath} の outbox は \`@x/ses\` を止めるが、\`${file}\` に、それを書いて止める行が表にない。表と fixture に止める行を足す (${howTo})。`;
      expect(failures({ [tablePath]: added })).toEqual([missing(outbox), missing(outboxTest)]);
    });

    it("counts a value only as a whole name in the text of a row", () => {
      const longer = table((copy) => {
        copy.outbox.values = ["@x/sq"];
      });
      expect(failures({ [tablePath]: longer })).toHaveLength(2);
      const inProperty = table((copy) => {
        copy.console.values = ["globalThis"];
      });
      expect(failures({ [tablePath]: inProperty })).toEqual([]);
    });
  });

  describe("the message of a restriction", () => {
    const noMention = (key: string, mention: string) =>
      `${tablePath} の ${key} の message に \`${mention}\` がない。止められた人が、代わりに書くものと ADR を知るため (${howTo})。`;

    it("names what to write instead, and the ADR", () => {
      const without = table((copy) => {
        copy.outbox.message = "Do not send from here.";
      });
      expect(failures({ [tablePath]: without })).toEqual([
        noMention("outbox", "enqueueOutbox"),
        noMention("outbox", "docs/adr/0029"),
      ]);
    });

    it("is not asked of a restriction without a message", () => {
      const without = table((copy) => {
        copy.console.mentions = ["Logger"];
      });
      expect(failures({ [tablePath]: without })).toEqual([]);
    });
  });

  describe("the files of a row", () => {
    it("are named after the key, in a __fixtures__/ directory", () => {
      const renamed = table((copy) => {
        copy.connection.rows[0]?.files.push(
          "apps/api/src/__fixtures__/bypass.ts",
          "apps/api/src/connection.ts",
        );
      });
      const wrong = (file: string) =>
        `${tablePath} の connection の行が \`${file}\` を挙げるが、fixture のファイルは __fixtures__/connection.ts か __fixtures__/connection.test.ts にする (${howTo})。`;
      expect(failures({ [tablePath]: renamed })).toEqual([
        wrong("apps/api/src/__fixtures__/bypass.ts"),
        wrong("apps/api/src/connection.ts"),
      ]);
    });
  });

  describe("the table itself", () => {
    it("is asked for", () => {
      expect(failures({ [tablePath]: undefined })).toEqual([
        `${tablePath} がない。lint で止める import と呼び出しと、その fixture の行を並べる表で、vite.config.ts と repo-policy が読む (${howTo})。`,
      ]);
    });

    it("is reported once when it is not JSON, and asks for nothing", () => {
      expect(allViolations(repo({ [tablePath]: "{" }))).toEqual([
        expect.stringMatching(/^lint-restrictions\.json is not valid JSON/),
      ]);
    });

    it.each([
      ["a restriction that is not an object", { outbox: [] }, "outbox", "オブジェクト"],
      [
        "an adr that is not text",
        { outbox: { ...lintRestrictions.outbox, adr: 1 } },
        "outbox.adr",
        "文字列",
      ],
      [
        "values with one that is not text",
        { outbox: { ...lintRestrictions.outbox, values: ["@x/sqs", 1] } },
        "outbox.values",
        "文字列の配列",
      ],
      [
        "mentions that are missing",
        { outbox: { ...lintRestrictions.outbox, mentions: undefined } },
        "outbox.mentions",
        "文字列の配列",
      ],
      [
        "mentions that are one text",
        { outbox: { ...lintRestrictions.outbox, mentions: "enqueueOutbox" } },
        "outbox.mentions",
        "文字列の配列",
      ],
      [
        "a message that is not text",
        { outbox: { ...lintRestrictions.outbox, message: 1 } },
        "outbox.message",
        "文字列",
      ],
      [
        "rows that are not an array",
        { outbox: { ...lintRestrictions.outbox, rows: {} } },
        "outbox.rows",
        "配列",
      ],
    ])("refuses %s, and leaves the restriction out", (_, value, where, what) => {
      expect(failures({ [tablePath]: JSON.stringify(value) })).toEqual([
        `${tablePath} の ${where} が${what}でない (${howTo})。`,
      ]);
    });

    const [row] = lintRestrictions.outbox.rows;
    it.each([
      ["a row that is not an object", 1, "", "オブジェクト"],
      ["a row without files", { ...row, files: undefined }, ".files", "空でない文字列の配列"],
      ["a row with no file", { ...row, files: [] }, ".files", "空でない文字列の配列"],
      [
        "a row with a blank file",
        { ...row, files: [outbox, " "] },
        ".files",
        "空でない文字列の配列",
      ],
      ["a row with an empty text", { ...row, text: "" }, ".text", "空でない文字列"],
      ["a row without a rule", { ...row, rule: undefined }, ".rule", "空でない文字列"],
      ["a row with a blank reason", { ...row, reason: " " }, ".reason", "空でない文字列"],
      [
        "a row whose expect is neither stop nor pass",
        { ...row, expect: "allow" },
        ".expect",
        '"stop" か "pass"',
      ],
    ])("refuses %s, and leaves the row out", (_, wrong, field, what) => {
      const value = { outbox: { ...lintRestrictions.outbox, rows: [row, wrong] } };
      expect(failures({ [tablePath]: JSON.stringify(value) })).toEqual([
        `${tablePath} の outbox.rows[1]${field} が${what}でない (${howTo})。`,
      ]);
    });

    it("refuses a table that is not an object", () => {
      expect(failures({ [tablePath]: "[]" })).toEqual([
        `${tablePath} の最上位がオブジェクトでない (${howTo})。`,
      ]);
    });
  });

  describe("the lines of a fixture", () => {
    it.each([
      ["no space after //", "//oxlint-disable-next-line no-restricted-imports"],
      ["two spaces before the rule", "// oxlint-disable-next-line  no-restricted-imports"],
      [
        "a /* */ comment closed with no space",
        "/* oxlint-disable-next-line no-restricted-imports*/",
      ],
      ["a comment with a reason", "// oxlint-disable-next-line no-restricted-imports -- why"],
      [
        "a reason that is only the separator",
        "// oxlint-disable-next-line no-restricted-imports --",
      ],
    ])("reads a disable comment with %s", (_, comment) => {
      expect(failures({ [outbox]: `${comment}\nimport "@x/sqs";\n` })).toEqual([]);
    });

    it("does not read an empty rule after a comma", () => {
      const comma =
        '// oxlint-disable-next-line no-restricted-imports, -- fixture\nimport "@x/sqs";\n';
      expect(failures({ [outbox]: comma })).toEqual([]);
    });

    it("does not read a disable comment after code", () => {
      const after =
        'const a = 1; // oxlint-disable-next-line no-restricted-imports\nimport "@x/sqs";\n';
      expect(failures({ [outbox]: after })).toEqual([
        sqsMissing,
        unlistedPass(outbox, 2, "outbox"),
      ]);
    });

    it("skips a line of blanks between the comment and the line", () => {
      const apart = outboxFixture.replace("\nimport", "\n  \nimport");
      expect(failures({ [outbox]: apart })).toEqual([
        sqsMissing,
        unlistedPass(outbox, 3, "outbox"),
      ]);
    });

    it("skips the comments, and reads a comment after code as code", () => {
      const commented = [
        '// a note on "@x/sqs"',
        '  // an indented note on "@x/sqs"',
        "/*",
        ' * a block on "@x/sqs"',
        " */",
        "// oxlint-disable-next-line no-restricted-imports -- fixture",
        'import "@x/sqs"; // the client',
        "",
      ].join("\n");
      expect(failures({ [outbox]: commented })).toEqual([]);
    });

    it("asks for a row of a line that lets through any text of the restriction", () => {
      const bare = `${consoleFixture}export const c: unknown = console;\n`;
      expect(failures({ [consoleFile]: bare })).toEqual([unlistedPass(consoleFile, 5, "console")]);
    });

    it("reads a fixture at the root, and not one with another extension", () => {
      expect(
        failures({
          "__fixtures__/connection.ts": connectionStopFixture,
          "apps/api/src/__fixtures__/connection.ts.bak": connectionStopFixture,
        }),
      ).toEqual([
        unlistedStop("__fixtures__/connection.ts", 2, "no-restricted-imports", "connection"),
      ]);
    });

    it.each([
      ["an import of a module for its effects", 'import "node:fs";'],
      ["an import of names", 'import { a } from "node:fs";'],
      ["a type import", '  import type { A } from "node:fs";'],
      ["a re-export", 'export { a } from "node:fs";'],
    ])("asks for a row of %s that is let through, even when no row has its text", (_, line) => {
      expect(failures({ [connectionTest]: `${connectionPassFixture}${line}\n` })).toEqual([
        unlistedPass(connectionTest, 2, "connection"),
      ]);
    });

    it.each([
      ["a constant that holds a text", 'export const a = "node:fs";'],
      ["a name that starts with import", 'const imported = from("node:fs");'],
      ["a call with from in its name", 'exportFrom("node:fs");'],
    ])("does not take %s for an import", (_, line) => {
      expect(failures({ [connectionTest]: `${connectionPassFixture}${line}\n` })).toEqual([]);
    });

    it("passes an import that a row lets through, though no other row has its text", () => {
      const withRow = table((copy) => {
        copy.connection.rows.push({
          files: [connectionTest],
          rule: "no-restricted-imports",
          text: '"node:fs"',
          expect: "pass",
          reason: "x",
        });
      });
      expect(
        failures({
          [tablePath]: withRow,
          [connectionTest]: `${connectionPassFixture}import "node:fs";\n`,
        }),
      ).toEqual([]);
    });

    it("asks the values only of the files that stop them, not of those that let a line through", () => {
      const other = "apps/api/src/__fixtures__/connection.ts";
      const passOnly = table((copy) => {
        copy.connection.rows.push({
          files: [other],
          rule: "no-restricted-imports",
          text: "export const x",
          expect: "pass",
          reason: "x",
        });
      });
      expect(failures({ [tablePath]: passOnly, [other]: "export const x = 1;\n" })).toEqual([]);
    });
  });
});

describe("ADR 0033: each part of packages/ui has a story next to it", () => {
  const components = "packages/ui/src/components";

  it("passes a part with a story and a story with no part", () => {
    expect(
      violations(
        repo({
          [`${components}/button.tsx`]: "export {};",
          [`${components}/button.stories.tsx`]: "export {};",
          [`${components}/orphan.stories.tsx`]: "export {};",
        }),
      ),
    ).toEqual([]);
  });

  it("names a part with no story, and the file to add", () => {
    expect(violations(repo({ [`${components}/dialog.tsx`]: "export {};" }))).toEqual([
      `${components}/dialog.tsx has no story. Add ${components}/dialog.stories.tsx, whose play functions are the part's component test (docs/adr/0033).`,
    ]);
  });

  it("names every part with no story, at any depth", () => {
    expect(
      violations(
        repo({
          [`${components}/button.tsx`]: "export {};",
          [`${components}/button.stories.tsx`]: "export {};",
          [`${components}/dialog.tsx`]: "export {};",
          [`${components}/form/field.tsx`]: "export {};",
        }),
      ).map((failure) => failure.split(" ")[0]),
    ).toEqual([`${components}/dialog.tsx`, `${components}/form/field.tsx`]);
  });

  it("wants the story next to the part, not in another directory", () => {
    expect(
      violations(
        repo({
          [`${components}/form/field.tsx`]: "export {};",
          [`${components}/field.stories.tsx`]: "export {};",
        }),
      ),
    ).toHaveLength(1);
  });

  it("reads only tsx files in packages/ui/src/components", () => {
    expect(
      violations(
        repo({
          [`${components}/helper.ts`]: "export {};",
          [`${components}/button.test.tsx`]: "export {};",
          "packages/ui/src/lib/format.tsx": "export {};",
          "packages/ui/src/componentsx/part.tsx": "export {};",
          "apps/web/src/components/menu.tsx": "export {};",
        }),
      ),
    ).toEqual([]);
  });
});

describe("ADR 0040: a writer of a module goes through withIdempotencyKey", () => {
  const store = "packages/claim/src/application/submit-claim.ts";
  const importing = (names: string): string =>
    `import { ${names} } from "@agent-software-factory/shared-kernel/${names.includes("withIdempotencyKey") ? "idempotency-db" : "tenant-db"}";\nexport {};\n`;
  const failure = (path: string): string =>
    `${path} opens a transaction but does not use withIdempotencyKey. A write of an HTTP request goes through withIdempotencyKey of @agent-software-factory/shared-kernel/idempotency-db; a writer that is not one (a consumer, a batch) says why with a line \`// idempotency-exempt: <reason>\` (docs/adr/0040).`;

  it("passes a file that opens a transaction and uses withIdempotencyKey", () => {
    expect(
      violations(repo({ [store]: importing("inTenantTransaction, withIdempotencyKey") })),
    ).toEqual([]);
  });

  it("names a file that opens a transaction without withIdempotencyKey", () => {
    expect(violations(repo({ [store]: importing("inTenantTransaction") }))).toEqual([
      failure(store),
    ]);
  });

  it("reads an import over several lines, and beginTenantTransaction", () => {
    const path = "packages/closing/src/infrastructure/close.ts";
    expect(
      violations(
        repo({
          [path]:
            'import {\n  Database,\n  beginTenantTransaction,\n} from "@agent-software-factory/shared-kernel/tenant-db";\n',
        }),
      ),
    ).toEqual([failure(path)]);
  });

  it("does not take a mention in a comment for the use", () => {
    expect(
      violations(repo({ [store]: `// withIdempotencyKey\n${importing("inTenantTransaction")}` })),
    ).toEqual([failure(store)]);
  });

  it("passes a file with a line that says why it is exempt", () => {
    expect(
      violations(
        repo({
          [store]: `// idempotency-exempt: a consumer of the queue, deduplicated by processed_message\n${importing("inTenantTransaction")}`,
        }),
      ),
    ).toEqual([]);
  });

  it("does not take an exemption without a reason", () => {
    expect(
      violations(repo({ [store]: `// idempotency-exempt:\n${importing("inTenantTransaction")}` })),
    ).toEqual([failure(store)]);
  });

  it("passes a file that does not open a transaction", () => {
    expect(violations(repo({ [store]: importing("Database") }))).toEqual([]);
  });

  it("reads only the application and infrastructure layers, without tests and fixtures", () => {
    const text = importing("inTenantTransaction");
    expect(
      violations(
        repo({
          "packages/claim/src/domain/rule.ts": text,
          "packages/claim/src/application/submit-claim.test.ts": text,
          "packages/claim/src/application/__fixtures__/bypass.ts": text,
          "packages/shared-kernel/src/messaging/consumer.ts": text,
          "apps/api/src/db/idempotency.ts": text,
        }),
      ),
    ).toEqual([]);
  });

  describe("the header name of apps/web is the one of shared-kernel", () => {
    const api = "packages/shared-kernel/src/idempotency-http/idempotency-http.ts";
    const web = "apps/web/src/lib/use-idempotent-mutation.ts";
    const declare = (name: string): string => `export const IDEMPOTENCY_KEY_HEADER = "${name}";\n`;
    const mismatch = (webName: string, apiName: string): string =>
      `${web} has IDEMPOTENCY_KEY_HEADER ${JSON.stringify(webName)}, but ${api} has ${JSON.stringify(apiName)}. apps/web does not import shared-kernel, so keep the two the same (docs/adr/0040).`;

    it("passes the same name", () => {
      expect(
        violations(repo({ [api]: declare("Idempotency-Key"), [web]: declare("Idempotency-Key") })),
      ).toEqual([]);
    });

    it("names a web that declares another name", () => {
      expect(
        violations(repo({ [api]: declare("Idempotency-Key"), [web]: declare("X-Key") })),
      ).toEqual([mismatch("X-Key", "Idempotency-Key")]);
    });

    it("names a web whose declaration is gone", () => {
      expect(
        violations(repo({ [api]: declare("Idempotency-Key"), [web]: "export {};\n" })),
      ).toEqual([
        `${web} has IDEMPOTENCY_KEY_HEADER undefined, but ${api} has "Idempotency-Key". apps/web does not import shared-kernel, so keep the two the same (docs/adr/0040).`,
      ]);
    });
  });
});
