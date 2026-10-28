// Checks that every lint rule, tsconfig flag, module layer and Effect rule has a fixture that shows it is on (#43, #230; docs/adr/0020, 0026, 0027, 0028).
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

// Whether a file of `fixtures` (a __fixtures__/ directory) has `annotation`. A test file counts only when
// `test` is true, because the override of the tests is not the one that the other fixtures show.
const hasFixture = (tree: Tree, fixtures: string, annotation: string, test = false) =>
  tree.paths.some(
    (file) =>
      file.startsWith(fixtures) &&
      file.endsWith(".test.ts") === test &&
      tree.read(file).includes(annotation),
  );

// ADR 0026: the boundaries of each package under packages/. vite.config.ts builds an override of
// no-restricted-imports for each module in its `modules` object, and for each layer of its `layers` object; a
// package left out has no boundaries. Each override has a fixture (#43) in <dir>/__fixtures__/ that the rule
// must report: src/ of every package, and src/<layer>/ of every module. shared has its own override and no layers.
// The runtime restrictions of docs/adr/0007 (no-restricted-globals, no-restricted-properties) reach all of
// packages/*/src, so src/__fixtures__/ also needs a fixture for each of them and one for the tests.
export function moduleBoundaries(tree: Tree): string[] {
  const config = tree.read("vite.config.ts");
  const modules = new Set(objectKeys(config, "modules"));
  const layers = objectKeys(config, "layers");
  const failures: string[] = [];
  for (const path of tree.paths) {
    const name = /^packages\/([^/]+)\/package\.json$/.exec(path)?.[1];
    if (name === undefined) continue;
    const isModule = name !== "shared";
    if (isModule && !modules.has(name))
      failures.push(
        `packages/${name} is not in \`modules\` in vite.config.ts, so no rule stops its imports. Add it with the modules it may import (docs/adr/0026).`,
      );
    for (const dir of ["src", ...(isModule ? layers.map((layer) => `src/${layer}`) : [])]) {
      const fixtures = `packages/${name}/${dir}/__fixtures__/`;
      if (!hasFixture(tree, fixtures, fixtureAnnotation))
        failures.push(
          `${fixtures} has no fixture with \`${fixtureAnnotation}\`, so nothing shows the rule reaches ${dir}/ (docs/adr/0026).`,
        );
    }
    // The override of domain sets no-restricted-globals and no-restricted-properties for its own rules (docs/adr/0027),
    // and Oxlint keeps only the last override that sets a rule, so it must carry the runtime restrictions too. The
    // annotations of the purity fixtures (Date, Math.random) name the same rules, so the fixture has its own file.
    if (isModule && layers.includes("domain")) {
      const runtime = `packages/${name}/src/domain/__fixtures__/runtime-apis.ts`;
      for (const annotation of domainRuntimeAnnotations)
        if (!tree.paths.includes(runtime) || !tree.read(runtime).includes(annotation))
          failures.push(
            `${runtime} has no \`${annotation}\`, so nothing shows the override of domain keeps the runtime restrictions (docs/adr/0007).`,
          );
    }
    // The override of the tests keeps the import restrictions (docs/adr/0007).
    const src = `packages/${name}/src/__fixtures__/`;
    if (!hasFixture(tree, src, fixtureAnnotation, true))
      failures.push(
        `${src} has no *.test.ts fixture with \`${fixtureAnnotation}\`, so nothing shows the override of the tests keeps the import restrictions (docs/adr/0007).`,
      );
    for (const annotation of runtimeAnnotations)
      if (!hasFixture(tree, src, annotation))
        failures.push(
          `${src} has no fixture with \`${annotation}\`, so nothing shows the rule reaches src/ (docs/adr/0007).`,
        );
  }
  return failures;
}

// ADR 0027: the rules that keep domain pure, each with its name as the disable comment of its fixture. vite.config.ts
// sets them in the override of domain for each module: `throw` (the domain/no-throw rule of
// tools/lint-plugins/src/domain-plugin.ts), the `Date` global, and `Math.random`. Each module has a fixture (#43) for each
// in src/domain/__fixtures__/ that the rule must report, so a rule that is turned off, or whose `files` stop
// reaching domain/, fails `vp check`. Like the fixtures of the layers above, they are asked of the modules only,
// and only when vite.config.ts has a domain layer. The space after the name keeps a rule of a longer name from
// counting.
const domainRuleNames = ["domain/no-throw", "no-restricted-globals", "no-restricted-properties"];

export function domainPurity(tree: Tree): string[] {
  if (!objectKeys(tree.read("vite.config.ts"), "layers").includes("domain")) return [];
  const failures: string[] = [];
  for (const path of tree.paths) {
    const name = /^packages\/([^/]+)\/package\.json$/.exec(path)?.[1];
    if (name === undefined || name === "shared") continue;
    const fixtures = `packages/${name}/src/domain/__fixtures__/`;
    for (const rule of domainRuleNames)
      if (
        !tree.paths.some(
          (file) =>
            file.startsWith(fixtures) &&
            // runtime-apis.ts is the fixture of docs/adr/0007 (moduleBoundaries), and names the same two rules.
            !file.endsWith("/runtime-apis.ts") &&
            tree.read(file).includes(`oxlint-disable-next-line ${rule} `),
        )
      )
        failures.push(
          `${fixtures} has no fixture with \`oxlint-disable-next-line ${rule}\`, so nothing shows the rule reaches domain/ (docs/adr/0027).`,
        );
  }
  return failures;
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

// ADR 0028: application and infrastructure of each module are checked for Effect by effect-tsgo (the lint-effect
// target) and by vite.config.ts. Each of them has a fixture (#43) in <layer>/__fixtures__/ for each rule, so that a
// rule turned off, or one that stops reaching the layer, fails the check. outdated-api has none: a disable comment
// does not reach all of what it reports, so tools/scripts/src/checks/effect-lint/ tests it.
export function effectBoundaries(tree: Tree): string[] {
  const layers = objectKeys(tree.read("vite.config.ts"), "layers");
  const failures: string[] = [];
  for (const path of tree.paths) {
    const name = /^packages\/([^/]+)\/package\.json$/.exec(path)?.[1];
    if (name === undefined || name === "shared") continue;
    for (const layer of ["application", "infrastructure"].filter((l) => layers.includes(l)))
      for (const [file, annotations] of Object.entries(effectFixtures)) {
        const fixture = `packages/${name}/src/${layer}/__fixtures__/${file}`;
        const text = tree.read(fixture);
        for (const annotation of annotations)
          if (!text.includes(annotation))
            failures.push(
              `${fixture} has no \`${annotation}\`, so nothing shows the rule reaches ${layer}/ (docs/adr/0028).`,
            );
      }
  }
  return failures;
}
