// Checks that every lint rule, tsconfig flag, module layer and Effect rule has a fixture that shows it is on (#43, #230; docs/adr/0020, 0026, 0027, 0028).
import { modulePackageNames, packageNames } from "./modules.ts";
import { Tree, record } from "./tree.ts";

// The fixtures that show a lint rule or a tsconfig flag is on (#43, #230): a file under a `__fixtures__/` or
// `fixtures/` directory that breaks the rule or the flag on purpose, each such line marked with
//   // oxlint-disable-next-line <rule>[, <rule>] -- <reason>   for a rule
//   // @ts-expect-error -- <reason that names the flag>        for a flag
// Both fail `vp check` when they are unused (`reportUnusedDisableDirectives`, TS2578), so a rule or a flag that
// is turned off, or an override whose `files` stop reaching the file, fails the check. The fixtures of the
// checks themselves (tools/scripts/src/checks/) are the input of their tests, not a fixture of this kind.
const fixtureFile = /(?:^|\/)(?:__fixtures__|fixtures)\/(?:.*\/)?[^/]+\.tsx?$/;

const fixtureTexts = (tree: Tree): string[] =>
  tree.paths
    .filter((path) => fixtureFile.test(path) && !path.startsWith("tools/scripts/src/checks/"))
    .map((path) => tree.read(path));

// The rules named by the `oxlint-disable-next-line` comments of a text. The comment is on a line of its own, as
// `// ...` or `/* ... */` (also inside the braces of JSX); the rules are separated by commas, before the ` -- `
// that starts the reason.
const disableNextLine =
  /^[ \t]*(?:\{[ \t]*)?(?:\/\/|\/\*)[ \t]*oxlint-disable-next-line[ \t]+(\S.*)/gm;

const annotatedRules = (text: string): string[] =>
  Array.from(text.matchAll(disableNextLine), (match) =>
    String(match[1])
      .replace(/\s*\*\/\s*\}?\s*$/, "")
      .split(/\s--(?:\s|$)/, 1)
      .flatMap((rules) => rules.split(",").map((rule) => rule.trim())),
  ).flat();

// The rules that vite.config.ts sets to "error": the value of the rule (`"rule": "error"`) or the first element of
// its array (`"rule": ["error", ...]`).
const errorRule = /"([^"\s]+)"\s*:\s*(?:\[\s*)?"error"/g;

// Every rule that vite.config.ts sets to "error" has a line in a fixture that it must report (#230). The fixture
// shows that the rule is on and that it reaches the code it is for; where the fixture is shows which override.
export function lintRulesHaveFixtures(tree: Tree): string[] {
  const annotated = new Set(fixtureTexts(tree).flatMap(annotatedRules));
  const rules = new Set(Array.from(tree.read("vite.config.ts").matchAll(errorRule), (m) => m[1]));
  return [...rules]
    .filter((rule) => !annotated.has(String(rule)))
    .map(
      (rule) =>
        `vite.config.ts sets ${rule} to error, but no fixture has \`oxlint-disable-next-line ${rule}\`. Add a line that the rule must report to a file in a __fixtures__/ directory of the project the rule is for, such as apps/api/src/__fixtures__/typed-rules.ts, so that turning the rule off, or an override that stops reaching the file, fails \`vp check\` (docs/tooling/ci.md ("lint の規則と tsconfig のフラグの fixture")).`,
    );
}

// The checking flags of tsconfig.json (docs/adr/0020), each with the value that turns the check on: the "Type
// Checking" options of the TSConfig Reference, noUncheckedSideEffectImports (in its "Modules" section), and the
// two that this repository adds for syntax. A flag that changes what is emitted or resolved (noEmit, module,
// skipLibCheck, ...) checks nothing in the code and is not in the list.
const tsconfigChecks: Readonly<Record<string, boolean>> = {
  allowUnreachableCode: false,
  allowUnusedLabels: false,
  alwaysStrict: true,
  erasableSyntaxOnly: true,
  exactOptionalPropertyTypes: true,
  noFallthroughCasesInSwitch: true,
  noImplicitAny: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noImplicitThis: true,
  noPropertyAccessFromIndexSignature: true,
  noUncheckedIndexedAccess: true,
  noUncheckedSideEffectImports: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  strict: true,
  strictBindCallApply: true,
  strictBuiltinIteratorReturn: true,
  strictFunctionTypes: true,
  strictNullChecks: true,
  strictPropertyInitialization: true,
  useUnknownInCatchVariables: true,
  verbatimModuleSyntax: true,
};

const rootTsconfig = "tsconfig.json";

const compilerOptions = (tree: Tree, path: string): Record<string, unknown> =>
  record(record(tree.parsed(path)).compilerOptions);

// Every checking flag that the root tsconfig.json turns on has a line in a fixture that it makes an error (#230):
// `@ts-expect-error -- fixture: <flag>`. With the flag off, the directive is unused.
export function tsconfigFlagsHaveFixtures(tree: Tree): string[] {
  const options = compilerOptions(tree, rootTsconfig);
  const lines = fixtureTexts(tree).flatMap((text) => text.split("\n"));
  return Object.entries(tsconfigChecks)
    .filter(([flag, on]) => options[flag] === on)
    .filter(
      ([flag]) =>
        !lines.some((line) =>
          new RegExp(`@ts-expect-error\\s+--\\s+fixture:\\s+${flag}\\b`).test(line),
        ),
    )
    .map(
      ([flag]) =>
        `${rootTsconfig} turns on ${flag}, but no fixture has \`@ts-expect-error -- fixture: ${flag}\`. Add a line that the flag makes an error, in the form \`-- fixture: ${flag}: <why>\`, to apps/api/src/__fixtures__/tsconfig-flags.ts, so that removing the flag fails \`vp check\` (docs/tooling/ci.md ("lint の規則と tsconfig のフラグの fixture")).`,
    );
}

// The flags apply to every project through `extends`, so one fixture shows them for all. A project tsconfig.json
// that leaves out `extends`, or sets a checking flag itself, would make the fixture say nothing about that
// project. ADR 0020: a project sets its runtime only (target, lib, types, jsx, module).
export function projectTsconfigs(tree: Tree): string[] {
  const failures: string[] = [];
  for (const path of tree.named("tsconfig.json").filter((file) => file !== rootTsconfig)) {
    const parsed = record(tree.parsed(path));
    const expected = `${"../".repeat(path.split("/").length - 1)}${rootTsconfig}`;
    if (parsed.extends !== expected)
      failures.push(
        `${path} must have "extends": "${expected}", or the strictness of the root tsconfig.json does not reach it (docs/adr/0020).`,
      );
    for (const flag of Object.keys(compilerOptions(tree, path)).filter((f) => f in tsconfigChecks))
      failures.push(
        `${path} sets ${flag}. A project sets its runtime only; put a checking flag in the root tsconfig.json, where apps/api/src/__fixtures__/tsconfig-flags.ts shows it (docs/adr/0020).`,
      );
  }
  return failures;
}

// The keys of `const <name> ... = { ... };` in the text: the keys of an object literal that holds no other object.
function objectKeys(text: string, name: string): string[] {
  const body = new RegExp(`^const ${name}\\b[^=]*=\\s*\\{([^}]*)\\}`, "m").exec(text)?.[1];
  if (body === undefined) return [];
  return Array.from(body.matchAll(/([A-Za-z0-9_-]+)"?\s*:/g), (match) => String(match[1]));
}

const fixtureAnnotation = "oxlint-disable-next-line no-restricted-imports";

// The domain override sets these two rules itself; import/no-nodejs-modules reaches domain from the override
// of packages/*/src, so only src/ is asked for its fixture.
const domainRuntimeAnnotations = [
  "oxlint-disable-next-line no-restricted-globals",
  "oxlint-disable-next-line no-restricted-properties",
];

const runtimeAnnotations = [
  ...domainRuntimeAnnotations,
  "oxlint-disable-next-line import/no-nodejs-modules",
];

// The fixtures are for the overrides, not for the packages: an override reaches packages/*/src/** or
// packages/*/src/<layer>/** of every package alike (docs/adr/0026), so a fixture in any one package shows it. The
// fixtures in `dir` of every package under packages/ (`dir` is src or src/<layer>), and whether there is a
// package (or a module, for the layers) to ask them of.
// db has fixtures of its own (dbBoundaries); its override is not one of packages/*/src/**, so they say nothing about these.
function fixtures(tree: Tree, dir: string): string[] {
  const pattern = new RegExp(`^packages/(?!db/)[^/]+/${dir}/__fixtures__/`);
  return tree.paths.filter((path) => pattern.test(path));
}
const hasPackage = (tree: Tree, modulePackagesOnly: boolean): boolean =>
  (modulePackagesOnly ? modulePackageNames(tree) : packageNames(tree)).length > 0;

// Whether a fixture in `dir` has `annotation`. A test file counts only when `test` is true, because the override
// of the tests is not the one that the other fixtures show.
const hasFixture = (tree: Tree, dir: string, annotation: string, test = false) =>
  fixtures(tree, dir).some(
    (file) => file.endsWith(".test.ts") === test && tree.read(file).includes(annotation),
  );

// ADR 0026: the boundaries of the packages under packages/. vite.config.ts has an override of
// no-restricted-imports for packages/*/src/**, and one for each layer of its `layers` object. Each has a fixture
// (#43) in some package, in <dir>/__fixtures__/, that the rule must report. The runtime restrictions of
// docs/adr/0007 (no-restricted-globals, no-restricted-properties, import/no-nodejs-modules) reach all of
// packages/*/src, so src/ also needs a fixture for each of them and one for the tests.
export function moduleBoundaries(tree: Tree): string[] {
  if (!hasPackage(tree, false)) return [];
  const layers = hasPackage(tree, true) ? objectKeys(tree.read("vite.config.ts"), "layers") : [];
  const failures: string[] = [];
  for (const dir of ["src", ...layers.map((layer) => `src/${layer}`)])
    if (!hasFixture(tree, dir, fixtureAnnotation))
      failures.push(
        `No packages/*/${dir}/__fixtures__/ has a fixture with \`${fixtureAnnotation}\`, so nothing shows the rule reaches ${dir}/ (docs/adr/0026).`,
      );
  // The override of domain sets no-restricted-globals and no-restricted-properties for its own rules (docs/adr/0027),
  // and Oxlint keeps only the last override that sets a rule, so it must carry the runtime restrictions too. The
  // annotations of the purity fixtures (Date, Math.random) name the same rules, so the fixture has its own file.
  if (layers.includes("domain")) {
    const runtime = fixtures(tree, "src/domain").filter((file) =>
      file.endsWith("/runtime-apis.ts"),
    );
    for (const annotation of domainRuntimeAnnotations)
      if (!runtime.some((file) => tree.read(file).includes(annotation)))
        failures.push(
          `No packages/*/src/domain/__fixtures__/runtime-apis.ts has \`${annotation}\`, so nothing shows the override of domain keeps the runtime restrictions (docs/adr/0007).`,
        );
  }
  // The override of the tests keeps the import restrictions (docs/adr/0007).
  if (!hasFixture(tree, "src", fixtureAnnotation, true))
    failures.push(
      `No packages/*/src/__fixtures__/ has a *.test.ts fixture with \`${fixtureAnnotation}\`, so nothing shows the override of the tests keeps the import restrictions (docs/adr/0007).`,
    );
  for (const annotation of runtimeAnnotations)
    if (!hasFixture(tree, "src", annotation))
      failures.push(
        `No packages/*/src/__fixtures__/ has a fixture with \`${annotation}\`, so nothing shows the rule reaches src/ (docs/adr/0007).`,
      );
  return failures;
}

// ADR 0027: the rules that keep domain pure, each with its name as the disable comment of its fixture. vite.config.ts
// sets them in the override of domain: `throw` (the domain/no-throw rule of tools/lint-plugins/src/domain-plugin.ts),
// the `Date` global, and `Math.random`. Some module has a fixture (#43) for each in src/domain/__fixtures__/ that
// the rule must report, so a rule that is turned off, or whose `files` stop reaching domain/, fails `vp check`.
// They are asked only when there is a module and vite.config.ts has a domain layer. The space after the name keeps
// a rule of a longer name from counting.
const domainRuleNames = ["domain/no-throw", "no-restricted-globals", "no-restricted-properties"];

export function domainPurity(tree: Tree): string[] {
  if (
    !hasPackage(tree, true) ||
    !objectKeys(tree.read("vite.config.ts"), "layers").includes("domain")
  )
    return [];
  // runtime-apis.ts is the fixture of docs/adr/0007 (moduleBoundaries), and names the same two rules.
  const purity = fixtures(tree, "src/domain").filter((file) => !file.endsWith("/runtime-apis.ts"));
  return domainRuleNames
    .filter(
      (rule) =>
        !purity.some((file) => tree.read(file).includes(`oxlint-disable-next-line ${rule} `)),
    )
    .map(
      (rule) =>
        `No packages/*/src/domain/__fixtures__/ has a fixture with \`oxlint-disable-next-line ${rule}\`, so nothing shows the rule reaches domain/ (docs/adr/0027).`,
    );
}

// The fixtures of the Effect rules, and the disable comments each carries. effect-tsgo.ts has the rules of
// effect-tsgo (oxlint.effect.json). effect.ts has the rules of vite.config.ts, which stop an Effect from being run
// in the layer and the features that ADR 0028 does not use. They are two files because `vp lint` does not load the
// effecttsgo plugin, and would report its disable comments as unused.
const effectFixtures: Readonly<Record<string, readonly string[]>> = {
  "effect-tsgo.ts": ["floating-effect", "unstable-api-usage", "experimental-api-usage"].map(
    (rule) => `oxlint-disable-next-line effecttsgo/${rule}`,
  ),
  "effect.ts": ["no-restricted-properties", "no-restricted-imports"].map(
    (rule) => `oxlint-disable-next-line ${rule}`,
  ),
};

// ADR 0028: application and infrastructure are checked for Effect by effect-tsgo (the lint-effect target of each
// module, modulesLintEffect) and by vite.config.ts. Each layer has a fixture (#43) in some module, in
// <layer>/__fixtures__/, for each rule, so that a rule turned off, or one that stops reaching the layer, fails the
// check. outdated-api has none: a disable comment does not reach all of what it reports, so
// tools/scripts/src/checks/effect-lint/ tests it.
export function effectBoundaries(tree: Tree): string[] {
  if (!hasPackage(tree, true)) return [];
  const layers = objectKeys(tree.read("vite.config.ts"), "layers");
  const failures: string[] = [];
  for (const layer of ["application", "infrastructure"].filter((l) => layers.includes(l)))
    for (const [file, annotations] of Object.entries(effectFixtures)) {
      const texts = fixtures(tree, `src/${layer}`)
        .filter((path) => path.endsWith(`/__fixtures__/${file}`))
        .map((path) => tree.read(path));
      for (const annotation of annotations)
        if (!texts.some((text) => text.includes(annotation)))
          failures.push(
            `No packages/*/src/${layer}/__fixtures__/${file} has \`${annotation}\`, so nothing shows the rule reaches ${layer}/ (docs/adr/0028).`,
          );
    }
  return failures;
}

// ADR 0038: the override of packages/db/src in vite.config.ts stops a value import of a package of the workspace, and
// lets through `import type`, a Node.js module and the other restrictions it leaves. packages/db/src/__fixtures__/ has a
// fixture (#43) for each: a value import that the rule must report, carrying the disable comment, and an
// `import type` of a package of the workspace and an import of node:child_process, which carry none and which Oxlint
// must not report.
const dbFixtureDir = /^packages\/db\/src\/__fixtures__\/[^/]+\.tsx?$/;
const dbFixtureParts: readonly (readonly [string, string])[] = [
  [
    `oxlint-disable-next-line no-restricted-imports`,
    "a value import of a package of the workspace, which the rule must report",
  ],
  [
    "import type {",
    "an `import type` of a package of the workspace, which the rule must let through",
  ],
  ['from "node:child_process"', "an import of node:child_process, which the rule must let through"],
];

export function dbBoundaries(tree: Tree): string[] {
  if (!packageNames(tree).includes("db")) return [];
  const texts = tree.paths.filter((path) => dbFixtureDir.test(path)).map((path) => tree.read(path));
  return dbFixtureParts
    .filter(([part]) => !texts.some((text) => text.includes(part)))
    .map(
      ([part, what]) =>
        `No packages/db/src/__fixtures__/ has \`${part}\`: it needs ${what}, so that an override that stops reaching db, or one that is too strict, fails \`vp check\` (docs/adr/0038).`,
    );
}
