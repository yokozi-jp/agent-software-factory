// The rules of repo-policy, called on a small repository held in memory: each case breaks one file of
// a repository that passes, and expects the message that names the problem. Reading git and the
// working tree (and the staged mode) is in cli.test.ts.
import { describe, expect, it } from "vite-plus/test";
import {
  domainFixture,
  domainRuntimeFixtures,
  factoryAgent,
  migration,
  moduleFixture,
  passingRepo,
  runtimeFixture,
  srcFixtures,
} from "./fixtures/passing-repo.ts";
import { violations, type Repo } from "./rules.ts";

const base = passingRepo;

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
        violations(repo({ "apps/api/package.json": json({ [field]: { "@nx/vite": "24.0.0" } }) })),
      ).toEqual([
        "apps/api/package.json depends on @nx/vite. Targets come from package.json scripts (docs/adr/0002).",
      ]);
    },
  );

  it("passes a package.json that names @nx/vite outside its dependencies", () => {
    expect(
      violations(repo({ "apps/api/package.json": json({ description: "not @nx/vite" }) })),
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
    "packages/claim/src/domain/__fixtures__/deeper/console.ts",
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
    expect(violations(repo({ "vite.config.ts": undefined }))).toEqual([
      "packages/claim is not in `modules` in vite.config.ts, so no rule stops its imports. Add it with the modules it may import (docs/adr/0026).",
    ]);
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
        violations(repo(files)).filter((message) => message.startsWith("vite.config.ts")),
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
      '{\n    // a comment\n  "compilerOptions": {\n\t// another\n    "strict": true,\n    "baseUrl": "https://x"\n  }\n}\n';
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
      violations(repo({ ...options, "packages/claim/src/__fixtures__/flags.ts": text })),
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

describe("ADR 0026: every package under packages/ has its boundaries and their fixtures", () => {
  const config = base["vite.config.ts"] ?? "";
  const notInModules = (name: string) =>
    `packages/${name} is not in \`modules\` in vite.config.ts, so no rule stops its imports. Add it with the modules it may import (docs/adr/0026).`;
  const noFixture = (name: string, dir: string) =>
    `packages/${name}/${dir}/__fixtures__/ has no fixture with \`oxlint-disable-next-line no-restricted-imports\`, so nothing shows the rule reaches ${dir}/ (docs/adr/0026).`;
  const module = (name: string, dirs: readonly string[]) => ({
    [`packages/${name}/package.json`]: "{}",
    ...Object.fromEntries(
      dirs.map((dir) => [`packages/${name}/${dir}/__fixtures__/boundaries.ts`, moduleFixture]),
    ),
    ...srcFixtures(name),
    ...domainRuntimeFixtures(name),
    // The fixtures of the rules that keep domain pure are checked on their own, below.
    [`packages/${name}/src/domain/__fixtures__/purity.ts`]: domainFixture,
  });

  it("refuses a module that vite.config.ts does not list", () => {
    expect(violations(repo(module("approval", ["src", "src/domain", "src/http"])))).toEqual([
      notInModules("approval"),
    ]);
  });

  it("refuses a module without the fixture of src/ or of a layer", () => {
    expect(
      violations(
        repo({
          "packages/claim/src/__fixtures__/boundaries.ts": undefined,
          "packages/claim/src/http/__fixtures__/boundaries.ts": undefined,
        }),
      ),
    ).toEqual([noFixture("claim", "src"), noFixture("claim", "src/http")]);
  });

  it("refuses a fixture without the disable comment of no-restricted-imports", () => {
    expect(
      violations(
        repo({
          "packages/claim/src/domain/__fixtures__/boundaries.ts":
            '// oxlint-disable-next-line no-console -- fixture\nimport "@x/other";\n',
        }),
      ),
    ).toEqual([noFixture("claim", "src/domain")]);
  });

  it("refuses a fixture that is outside __fixtures__/ of its directory", () => {
    expect(
      violations(
        repo({
          "packages/claim/src/domain/__fixtures__/boundaries.ts": undefined,
          "packages/claim/src/domain/boundaries.ts": moduleFixture,
          "packages/claim/src/domain/deeper/__fixtures__/boundaries.ts": moduleFixture,
        }),
      ),
    ).toEqual([noFixture("claim", "src/domain")]);
  });

  it("asks shared for the fixture of src/ only, and not for an entry in modules", () => {
    expect(
      violations(repo({ "packages/shared/src/__fixtures__/boundaries.ts": undefined })),
    ).toEqual([noFixture("shared", "src")]);
  });

  it("refuses a package without the fixtures of the runtime restrictions or of the tests", () => {
    const noRuntime = (annotation: string) =>
      `packages/claim/src/__fixtures__/ has no fixture with \`oxlint-disable-next-line ${annotation}\`, so nothing shows the rule reaches src/ (docs/adr/0007).`;
    expect(
      violations(
        repo({
          "packages/claim/src/__fixtures__/runtime-apis.ts": runtimeFixture.replace(
            "no-restricted-properties",
            "no-console",
          ),
          "packages/claim/src/__fixtures__/boundaries.test.ts": undefined,
        }),
      ),
    ).toEqual([
      "packages/claim/src/__fixtures__/ has no *.test.ts fixture with `oxlint-disable-next-line no-restricted-imports`, so nothing shows the override of the tests keeps the import restrictions (docs/adr/0007).",
      noRuntime("no-restricted-properties"),
    ]);
    expect(
      violations(repo({ "packages/shared/src/__fixtures__/runtime-apis.ts": undefined })),
    ).toEqual([
      noRuntime("no-restricted-globals").replace("claim", "shared"),
      noRuntime("no-restricted-properties").replace("claim", "shared"),
      noRuntime("import/no-nodejs-modules").replace("claim", "shared"),
    ]);
  });

  it("refuses a module whose domain fixture does not show the runtime restrictions", () => {
    const noDomainRuntime = (annotation: string) =>
      `packages/claim/src/domain/__fixtures__/runtime-apis.ts has no \`oxlint-disable-next-line ${annotation}\`, so nothing shows the override of domain keeps the runtime restrictions (docs/adr/0007).`;
    expect(
      violations(repo({ "packages/claim/src/domain/__fixtures__/runtime-apis.ts": undefined })),
    ).toEqual([
      noDomainRuntime("no-restricted-globals"),
      noDomainRuntime("no-restricted-properties"),
    ]);
    expect(
      violations(
        repo({
          "packages/claim/src/domain/__fixtures__/runtime-apis.ts": runtimeFixture.replace(
            "no-restricted-properties",
            "no-console",
          ),
        }),
      ),
    ).toEqual([noDomainRuntime("no-restricted-properties")]);
  });

  it("follows the layers that vite.config.ts lists", () => {
    const threeLayers = config.replace('  http: ["domain"],', '  http: ["domain"],\n  infra: [],');
    expect(violations(repo({ "vite.config.ts": threeLayers }))).toEqual([
      noFixture("claim", "src/infra"),
    ]);
  });

  it("refuses every module when vite.config.ts has no modules object", () => {
    const none = config.replace("const modules", "const packages");
    expect(violations(repo({ "vite.config.ts": none }))).toEqual([notInModules("claim")]);
  });

  it("asks a module for the fixture of src/ only when vite.config.ts has no layers object", () => {
    const none = config.replace("const layers", "const tiers");
    expect(
      violations(
        repo({
          "vite.config.ts": none,
          "packages/claim/src/domain/__fixtures__/boundaries.ts": undefined,
          "packages/claim/src/http/__fixtures__/boundaries.ts": undefined,
        }),
      ),
    ).toEqual([]);
  });
});

describe("ADR 0027: the domain of every module has the fixtures of the rules that keep it pure", () => {
  const config = base["vite.config.ts"] ?? "";
  const purity = "packages/claim/src/domain/__fixtures__/purity.ts";
  const noFixture = (name: string, rule: string) =>
    `packages/${name}/src/domain/__fixtures__/ has no fixture with \`oxlint-disable-next-line ${rule}\`, so nothing shows the rule reaches domain/ (docs/adr/0027).`;
  const without = (rule: string) =>
    domainFixture
      .split("\n")
      .filter((line) => !line.includes(`oxlint-disable-next-line ${rule} `))
      .join("\n");

  it.each(["domain/no-throw", "no-restricted-globals", "no-restricted-properties"])(
    "refuses a domain whose fixtures lack the disable comment of %s",
    (rule) => {
      expect(violations(repo({ [purity]: without(rule) }))).toEqual([noFixture("claim", rule)]);
    },
  );

  it("names every rule that has no fixture, in the order of the rules", () => {
    expect(violations(repo({ [purity]: undefined }))).toEqual([
      noFixture("claim", "domain/no-throw"),
      noFixture("claim", "no-restricted-globals"),
      noFixture("claim", "no-restricted-properties"),
    ]);
  });

  it("refuses a disable comment of a rule of a similar name", () => {
    const similar = domainFixture.replace("domain/no-throw", "other/no-throw");
    expect(violations(repo({ [purity]: similar }))).toEqual([
      noFixture("claim", "domain/no-throw"),
    ]);
  });

  it("passes fixtures that are spread over several files of __fixtures__/", () => {
    const lines = domainFixture.split("\n");
    expect(
      violations(
        repo({
          [purity]: lines.slice(0, 2).join("\n"),
          "packages/claim/src/domain/__fixtures__/clock.ts": lines.slice(2).join("\n"),
        }),
      ),
    ).toEqual([]);
  });

  it("refuses fixtures that are outside __fixtures__/ of domain", () => {
    expect(
      violations(
        repo({
          [purity]: undefined,
          "packages/claim/src/domain/purity.ts": domainFixture,
          "packages/claim/src/http/__fixtures__/purity.ts": domainFixture,
          "packages/claim/src/domain/deeper/__fixtures__/purity.ts": domainFixture,
        }),
      ),
    ).toEqual([
      noFixture("claim", "domain/no-throw"),
      noFixture("claim", "no-restricted-globals"),
      noFixture("claim", "no-restricted-properties"),
    ]);
  });

  it("asks each module, and not shared", () => {
    expect(
      violations(
        repo({
          "packages/shared/src/__fixtures__/purity.ts": undefined,
          "packages/approval/package.json": "{}",
          ...srcFixtures("approval"),
          ...domainRuntimeFixtures("approval"),
          "packages/approval/src/domain/__fixtures__/boundaries.ts": moduleFixture,
          "packages/approval/src/http/__fixtures__/boundaries.ts": moduleFixture,
          "vite.config.ts": config.replace(
            "  claim: [],\n",
            '  claim: [],\n  approval: ["claim"],\n',
          ),
        }),
      ),
    ).toEqual([
      noFixture("approval", "domain/no-throw"),
      noFixture("approval", "no-restricted-globals"),
      noFixture("approval", "no-restricted-properties"),
    ]);
  });

  it("asks nothing when vite.config.ts has no domain layer", () => {
    const none = config.replace("  domain: [],\n", "");
    expect(
      violations(
        repo({
          "vite.config.ts": none,
          [purity]: undefined,
          "packages/claim/src/domain/__fixtures__/boundaries.ts": undefined,
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
    [`packages/claim/src/${layer}/__fixtures__/effect-tsgo.ts`]: effectTsgo,
    [`packages/claim/src/${layer}/__fixtures__/effect.ts`]: viteConfig,
  });
  const missing = (layer: string, file: string, comment: string) =>
    `packages/claim/src/${layer}/__fixtures__/${file} has no \`oxlint-disable-next-line ${comment}\`, so nothing shows the rule reaches ${layer}/ (docs/adr/0028).`;
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
          "packages/claim/src/application/__fixtures__/boundaries.ts": moduleFixture,
          "packages/claim/src/infrastructure/__fixtures__/boundaries.ts": moduleFixture,
        }),
      ),
    ).toEqual([]);
  });

  it("asks a layer for every fixture when it has none", () => {
    expect(
      violations(
        repo({
          "vite.config.ts": withLayers("  application: [],"),
          "packages/claim/src/application/__fixtures__/boundaries.ts": moduleFixture,
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
          "packages/claim/src/infrastructure/__fixtures__/effect-tsgo.ts": effectTsgo.replace(
            "effecttsgo/unstable-api-usage",
            "effecttsgo/other",
          ),
          "packages/claim/src/infrastructure/__fixtures__/boundaries.ts": moduleFixture,
        }),
      ),
    ).toEqual([missing("infrastructure", "effect-tsgo.ts", "effecttsgo/unstable-api-usage")]);
  });

  it("reads each comment in its own file", () => {
    expect(
      violations(
        repo({
          "vite.config.ts": withLayers("  application: [],"),
          "packages/claim/src/application/__fixtures__/effect-tsgo.ts": `${effectTsgo}\n${viteConfig}`,
          "packages/claim/src/application/__fixtures__/boundaries.ts": moduleFixture,
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
          "packages/claim/src/application/__fixtures__/boundaries.ts": moduleFixture,
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

  it("does not ask shared", () => {
    expect(
      violations(
        repo({
          "vite.config.ts": both,
          ...fixtures("application"),
          ...fixtures("infrastructure"),
          "packages/claim/src/application/__fixtures__/boundaries.ts": moduleFixture,
          "packages/claim/src/infrastructure/__fixtures__/boundaries.ts": moduleFixture,
          "packages/shared/package.json": JSON.stringify({ name: "@x/shared" }),
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
  const wrapper = "tools/scripts/sh/other.sh";
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
  const path = "apps/api/db/migrations/20260102000000_add_y.sql";
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
      downProblem,
      lockProblem,
      `${other} has a down section that is not only \`DO $$ BEGIN RAISE EXCEPTION '...'; END $$;\`. Migrations go forward only (docs/adr/0025).`,
      `${other} does not start its up section with SET LOCAL lock_timeout. Add it, or mark the file transaction:false (docs/adr/0025).`,
    ]);
  });

  it("does not read files outside db/migrations, or that are not SQL", () => {
    expect(
      violations(
        repo({
          "apps/api/db/bootstrap.sql": "SELECT 1;\n",
          "apps/api/db/migrations/README.md": "",
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
    expect(violations(repo({ "apps/api/package.json": json(manifest) }))).toEqual([
      "apps/api/package.json depends on @nx/vite. Targets come from package.json scripts (docs/adr/0002).",
    ]);
  });

  it("passes dependency fields that are null", () => {
    expect(violations(repo({ "apps/api/package.json": json({ dependencies: null }) }))).toEqual([]);
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
  const notInModules = (name: string) =>
    `packages/${name} is not in \`modules\` in vite.config.ts, so no rule stops its imports. Add it with the modules it may import (docs/adr/0026).`;
  const config = base["vite.config.ts"] ?? "";
  const noLayers = config.replace('{\n  domain: [],\n  http: ["domain"],\n}', "{}");
  // The vite.config.ts that passes, with `body` in its modules object, no layers, and a line before modules.
  const modulesConfig = (body: string) =>
    `const scope = "x";\n${noLayers.replace("{\n  claim: [],\n}", `{${body}}`)}`;
  const onlyPackage = (name: string, body: string) =>
    repo({
      "packages/claim/package.json": undefined,
      [`packages/${name}/package.json`]: "{}",
      ...srcFixtures(name),
      "vite.config.ts": modulesConfig(body),
    });

  it.each([
    ["a quoted key", "foo-bar", '\n  "foo-bar": [],\n'],
    ["a key of digits and an underscore", "a_2", "\n  a_2: [],\n"],
    ["keys on one line", "b", ' a: ["b"], b: [] '],
    ["a space before the colon", "c", "\n  c : [],\n"],
  ])("reads %s", (_, name, body) => {
    expect(violations(onlyPackage(name, body))).toEqual([]);
  });

  it("does not take a module that another module may import for a key", () => {
    expect(violations(onlyPackage("claim", '\n  approval: ["claim"],\n'))).toEqual([
      notInModules("claim"),
    ]);
  });

  it("reads only a top-level `const modules`, not one indented or of a longer name", () => {
    const others = `const modules2 = { claim: [] };\n${noLayers.replace("const modules", "  const modules")}`;
    expect(violations(repo({ "vite.config.ts": others }))).toEqual([notInModules("claim")]);
  });

  it.each([
    "apps/packages/approval/package.json",
    "packages/approval/package.json.orig",
    "packages/claim/nested/package.json",
  ])("passes %s, which is not the manifest of a package under packages/", (path) => {
    expect(violations(repo({ [path]: "{}" }))).toEqual([]);
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
  const wrapper = "tools/scripts/sh/other.sh";
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
