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
// bypass.ts is the fixture of the paths that stop the imports bypassing the Outbox (bypassGuards), and with-tables.ts the
// fixture of withTables (withTablesGuards); neither is a fixture of the import boundaries or the other rules asked of a
// directory.
function fixtures(tree: Tree, dir: string): string[] {
  const pattern = new RegExp(`^packages/(?!db/)[^/]+/${dir}/__fixtures__/`);
  return tree.paths.filter(
    (path) =>
      pattern.test(path) && !path.endsWith("/bypass.ts") && !path.endsWith("/with-tables.ts"),
  );
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

// ADR 0048: the OpenTelemetry SDK, the exporters and the instrumentations are imported by packages/telemetry and the
// entry files of the apps only. vite.config.ts stops them in every other file with the `otelSdkPattern` of
// `runtimeImports`, and the override of packages/telemetry/src leaves them out. Three places have a fixture (#43):
//   apps/api/src and packages/*/src  one import of each kind of `otelSdkKinds`, below `oxlint-disable-next-line
//                                    no-restricted-imports`. A kind dropped from the pattern, or an override that stops
//                                    reaching the directory, leaves the comment unused and fails `vp check`.
//   apps/web/src                     the import of the Node-only entry of packages/telemetry, below the comment
//   packages/telemetry/src           the SDK import with no comment, which Oxlint must not report, and the import of
//                                    an SQS client with the comment, which the override must still report.
// The names imported on the line below `oxlint-disable-next-line no-restricted-imports`.
const stoppedImports = (text: string): string[] =>
  Array.from(
    text.matchAll(/oxlint-disable-next-line no-restricted-imports[^\n]*\n[^\n"]*"([^"\n]+)"/g),
    (match) => String(match[1]),
  );
const stopsImport = (text: string, name: string): boolean => stoppedImports(text).includes(name);

export function telemetryBoundaries(tree: Tree): string[] {
  if (!packageNames(tree).includes("telemetry")) return [];
  const kinds = stringArray(tree.read("vite.config.ts"), "otelSdkKinds");
  if (kinds === undefined)
    return [
      "vite.config.ts has no otelSdkKinds array. It lists the kinds of OpenTelemetry import that the ban stops, and repo-policy asks for a fixture of each (docs/adr/0048).",
    ];
  const failures: string[] = [];
  if (!/\botelSdkKinds\.join\(/.test(tree.read("vite.config.ts").replace(/\/\/[^\n]*/g, "")))
    failures.push(
      'vite.config.ts does not build the regex of otelSdkPattern from otelSdkKinds (`otelSdkKinds.join("|")`): a second list of the kinds would let the ban and the fixtures disagree (docs/adr/0048).',
    );
  for (const file of [
    "apps/api/src/__fixtures__/otel-sdk.ts",
    "packages/module-fixtures/src/__fixtures__/otel-sdk.ts",
  ]) {
    const text = tree.paths.includes(file) ? tree.read(file) : "";
    const stopped = stoppedImports(text);
    for (const kind of kinds)
      if (!stopped.some((name) => new RegExp(`^@opentelemetry/(?:${kind})`).test(name)))
        failures.push(
          `${file} has no import of a package whose name matches the regular expression ^@opentelemetry/(?:${kind}) below \`oxlint-disable-next-line no-restricted-imports\`: vite.config.ts lists \`${kind}\` in otelSdkKinds (\`$\` ends the name), so that a kind dropped from the ban, or an override that stops reaching the directory, fails \`vp check\` (docs/adr/0048).`,
        );
  }
  const telemetryFixture = "packages/telemetry/src/__fixtures__/otel-sdk.ts";
  const telemetryText = tree.paths.includes(telemetryFixture) ? tree.read(telemetryFixture) : "";
  if (
    !telemetryText.includes('"@opentelemetry/sdk-node"') ||
    stopsImport(telemetryText, "@opentelemetry/sdk-node")
  )
    failures.push(
      `${telemetryFixture} must import @opentelemetry/sdk-node with no disable comment, so that an override of packages/telemetry/src that stops letting it through fails \`vp check\` (docs/adr/0048).`,
    );
  if (!stopsImport(telemetryText, "@aws-sdk/client-sqs"))
    failures.push(
      `${telemetryFixture} must import @aws-sdk/client-sqs below \`oxlint-disable-next-line no-restricted-imports\`, so that an override of packages/telemetry/src that drops the other restrictions fails \`vp check\` (docs/adr/0048).`,
    );
  const webFixture = "apps/web/src/__fixtures__/telemetry-node.ts";
  const webText = tree.paths.includes(webFixture) ? tree.read(webFixture) : "";
  if (!stopsImport(webText, "@agent-software-factory/telemetry/node"))
    failures.push(
      `${webFixture} must import @agent-software-factory/telemetry/node below \`oxlint-disable-next-line no-restricted-imports\`, so that dropping the ban in apps/web/src fails \`vp check\` (docs/adr/0048).`,
    );
  return failures;
}

// ADR 0049: `console` is stopped by `no-restricted-globals` and `no-restricted-properties` (the `console` entry of `runtimeGlobals`
// in vite.config.ts), because `no-console` lets an alias and `globalThis.console` through, and `pino` is stopped by
// `no-restricted-imports` outside packages/logging/src/node.ts, the entry files of the apps and the tests. Two places have a
// fixture (#43): apps/api/src and packages/*/src (module-fixtures). `runtime-apis.ts` has a line for each way of reaching
// `console` that the rule must stop, and `logger-imports.ts` has the `pino` import below the disable comment. A rule that is
// turned off, or an override that stops reaching the directory, leaves the comment unused and fails `vp check`.
const consoleFixtureLines: readonly (readonly [string, string])[] = [
  ["= console;", "a bare console and an alias of it"],
  ["globalThis.console", "console read from globalThis"],
  ['globalThis["console"]', "console read from globalThis by a string"],
  ["{ console:", "console destructured from globalThis"],
];

export function loggingBoundaries(tree: Tree): string[] {
  if (!packageNames(tree).includes("logging")) return [];
  const failures: string[] = [];
  const read = (file: string) => (tree.paths.includes(file) ? tree.read(file) : "");
  for (const dir of ["apps/api/src/__fixtures__", "packages/module-fixtures/src/__fixtures__"]) {
    const imports = `${dir}/logger-imports.ts`;
    if (!stopsImport(read(imports), "pino"))
      failures.push(
        `${imports} must import pino below \`oxlint-disable-next-line no-restricted-imports\`, so that dropping the ban outside packages/logging/src/node.ts fails \`vp check\` (docs/adr/0049).`,
      );
    const runtime = `${dir}/runtime-apis.ts`;
    const text = read(runtime);
    for (const [line, what] of consoleFixtureLines)
      if (!text.includes(line))
        failures.push(
          `${runtime} has no line with \`${line}\` (${what}), so nothing shows that the ban on console reaches it. Put it below \`oxlint-disable-next-line no-restricted-globals\` or \`no-restricted-properties\` (docs/adr/0049).`,
        );
  }
  return failures;
}

// ADR 0029: the imports that bypass the Outbox (`outboxPackages`: the SDK clients of SQS, SES and the like) and the
// transaction (`connectionPackages`: `pg`, which opens a connection of its own). vite.config.ts stops them with
// no-restricted-imports `paths`, and Oxlint keeps only the last override that sets the rule for a file, so each
// override carries its own copy. Each override has a fixture (#43) for every name it stops: an import of it on the
// line below `oxlint-disable-next-line no-restricted-imports`. A name dropped from a list, or an override that
// stops reaching the file, leaves the comment unused and fails `vp check`. A type import does not count: the rule
// lets it through for `pg`, and the comment would be unused.
//
// What each override stops:
//   packages/*/src and each layer but domain  the SDK clients and `pg` (domain stops every library already)
//   apps/api/src, but not the entry files and the tests  the SDK clients and `pg`
//   the entry files and the tests of apps/api/src, and packages/db/src  the SDK clients only: they open the
//     connections (docs/adr/0038), but a send from there skips the Outbox as well.
interface BypassPlace {
  readonly name: string;
  // Where a fixture is added when one is missing; any file in a __fixtures__/ directory of the place counts.
  readonly hint: string;
  readonly fixtureFile: RegExp;
  // Whether the override stops `connectionPackages` too, or only `outboxPackages`.
  readonly stopsConnection: boolean;
  // Whether the fixture is a *.test.ts file, which the override of the entry files and the tests reaches.
  readonly testFile: boolean;
  // Whether the override stops the raw SQL of Kysely (`sqlImportNames`): the modules do; shared-kernel and apps/api write SQL.
  readonly stopsSql: boolean;
}

const apiFixtures = /^apps\/api\/src\/(?:.*\/)?__fixtures__\/[^/]+\.tsx?$/;

// A place in the packages under packages/, other than db: `dir` is src, or src/<layer>. Its name, the hint and the
// pattern of its fixtures follow from `dir`.
const packagePlace = (dir: string): BypassPlace => ({
  name: `packages/*/${dir}`,
  hint: `packages/module-fixtures/${dir}/__fixtures__/bypass.ts`,
  fixtureFile: new RegExp(`^packages/(?!db/)[^/]+/${dir}/__fixtures__/(?:.*/)?[^/]+\\.tsx?$`),
  stopsConnection: true,
  testFile: false,
  stopsSql: true,
});

function bypassPlaces(tree: Tree): BypassPlace[] {
  const places: BypassPlace[] = [];
  if (hasPackage(tree, false)) places.push(packagePlace("src"));
  if (hasPackage(tree, true))
    for (const layer of objectKeys(tree.read("vite.config.ts"), "layers").filter(
      (name) => name !== "domain",
    ))
      places.push(packagePlace(`src/${layer}`));
  if (tree.paths.some((path) => path.startsWith("apps/api/src/")))
    places.push(
      {
        name: "apps/api/src",
        hint: "apps/api/src/__fixtures__/bypass.ts",
        fixtureFile: apiFixtures,
        stopsConnection: true,
        testFile: false,
        stopsSql: false,
      },
      {
        name: "the entry files and the tests of apps/api/src",
        hint: "apps/api/src/__fixtures__/bypass.test.ts",
        fixtureFile: apiFixtures,
        stopsConnection: false,
        testFile: true,
        stopsSql: false,
      },
    );
  if (packageNames(tree).includes("db"))
    places.push({
      name: "packages/db/src",
      hint: "packages/db/src/__fixtures__/bypass.ts",
      fixtureFile: /^packages\/db\/src\/__fixtures__\/[^/]+\.tsx?$/,
      stopsConnection: false,
      testFile: false,
      stopsSql: false,
    });
  return places;
}

// The strings of `const <name> ... = [ ... ];` in the text (a `//` comment is skipped), or undefined when there is no
// such array.
function stringArray(text: string, name: string): string[] | undefined {
  const uncommented = text.replace(/\/\/[^\n]*/g, "");
  const body = new RegExp(`^const ${name}\\b[^=]*=\\s*\\[([^\\]]*)\\]`, "m").exec(uncommented)?.[1];
  if (body === undefined) return undefined;
  return Array.from(body.matchAll(/"([^"]+)"/g), (match) => String(match[1]));
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// The raw SQL of Kysely that a module may not import: `import { sql } from "kysely"` or `export { sql } from "kysely"`,
// on the line below the disable comment. The names are the ones of `sqlImportNames`.
const sqlUnderDisableComment = (name: string): RegExp =>
  new RegExp(
    `^[ \\t]*//[ \\t]*oxlint-disable-next-line[ \\t]+no-restricted-imports\\b[^\\n]*\\n[ \\t]*(?:import|export)\\s(?!type\\b)[^\\n]*\\b${escapeRegExp(name)}\\b[^\\n]*"kysely"`,
    "m",
  );

const importUnderDisableComment = (name: string): RegExp =>
  new RegExp(
    `^[ \\t]*//[ \\t]*oxlint-disable-next-line[ \\t]+no-restricted-imports\\b[^\\n]*\\n[ \\t]*import\\s(?!type\\b)[^\\n]*"${escapeRegExp(name)}"`,
    "m",
  );

// The messages of the imports that bypass the Outbox and the transaction, and of the raw SQL and withTables that reach
// the tables of another module, say what to write instead and name the ADR, so that an agent that is stopped knows the
// way out. Oxlint reports a message with the code it stops; whether the text says the right thing is read here, from the
// constants of vite.config.ts. Each entry: the constant, what the message must mention, and what it is the message of.
const bypassMessages: readonly (readonly [string, string, string])[] = [
  [
    "outboxBypassMessage",
    "enqueueOutbox",
    "an import that would bypass the Outbox and the transaction",
  ],
  [
    "connectionMessage",
    "inTenantTransaction",
    "an import that would bypass the Outbox and the transaction",
  ],
  ["sqlMessage", "public API function", "an import of raw SQL in a module"],
  ["withTablesMessage", "public API function", "a call of withTables outside infrastructure"],
];

function bypassMessageFailures(config: string): string[] {
  return bypassMessages.flatMap(([name, fix, subject]) => {
    const rule = `The message of ${subject} says what to write instead and names the ADR (docs/adr/0029).`;
    const message = new RegExp(`^const ${name} =((?:\\s*"[^"]*"\\s*\\+?)+);`, "m").exec(
      config,
    )?.[1];
    if (message === undefined) return [`vite.config.ts has no ${name}. ${rule}`];
    return [
      ...(message.includes(fix)
        ? []
        : [`vite.config.ts: ${name} does not mention ${fix}. ${rule}`]),
      ...(message.includes("docs/adr/0029")
        ? []
        : [`vite.config.ts: ${name} does not mention docs/adr/0029. ${rule}`]),
    ];
  });
}

export function bypassGuards(tree: Tree): string[] {
  const config = tree.read("vite.config.ts");
  if (config === "") return [];
  const outbox = stringArray(config, "outboxPackages");
  const connection = stringArray(config, "connectionPackages");
  const sql = stringArray(config, "sqlImportNames");
  const absent = [
    ["outboxPackages", outbox],
    ["connectionPackages", connection],
    ["sqlImportNames", sql],
  ]
    .filter(([, names]) => names === undefined)
    .map(
      ([list]) =>
        `vite.config.ts has no ${String(list)} array. It lists the imports that bypass the Outbox, the transaction and the types of a module (the SDK clients of SQS and SES, pg, and the raw SQL of Kysely), which no-restricted-imports stops (docs/adr/0029).`,
    );
  if (outbox === undefined || connection === undefined || sql === undefined) return absent;
  const missing = bypassPlaces(tree).flatMap(
    ({ name: place, hint, fixtureFile, stopsConnection, testFile, stopsSql }) => {
      const texts = tree.paths
        .filter((path) => fixtureFile.test(path) && path.endsWith(".test.ts") === testFile)
        .map((path) => tree.read(path));
      const needs = [
        ...[...outbox, ...(stopsConnection ? connection : [])].map(
          (name) => [name, importUnderDisableComment(name)] as const,
        ),
        ...(stopsSql ? sql : []).map((name) => [name, sqlUnderDisableComment(name)] as const),
      ];
      return needs
        .filter(([, fixture]) => !texts.some((text) => fixture.test(text)))
        .map(
          ([name]) =>
            `vite.config.ts stops the import of ${name} in ${place}, but no fixture there has \`oxlint-disable-next-line no-restricted-imports\` on the line above an import of it. Add one to ${hint}, so that an override that stops reaching ${place}, or a rule that drops ${name}, fails \`vp check\` (docs/adr/0029).`,
        );
    },
  );
  return [...missing, ...bypassMessageFailures(config)];
}

// ADR 0029: `withTables` gives a transaction the types of another database, so it is called in infrastructure/ only.
// vite.config.ts stops it with no-restricted-properties in the override for all of packages/*/src, and in the overrides
// of domain and application, which each carry their own copy (Oxlint keeps only the last override that sets a rule).
// Each such place has a fixture (#43) in some package, <dir>/__fixtures__/with-tables.ts: a call on the line below
// `oxlint-disable-next-line no-restricted-properties`. infrastructure has one with no disable comment, so that an
// override that reaches it too fails `vp check`.
const withTablesUnderDisableComment =
  /^[ \t]*\/\/[ \t]*oxlint-disable-next-line[ \t]+no-restricted-properties\b[^\n]*\n[^\n]*\.withTables\b/m;

export function withTablesGuards(tree: Tree): string[] {
  if (!hasPackage(tree, false) || !tree.read("vite.config.ts").includes("withTablesEntry"))
    return [];
  const layers = hasPackage(tree, true) ? objectKeys(tree.read("vite.config.ts"), "layers") : [];
  const withTables = (dir: string) =>
    tree.paths
      .filter((path) =>
        new RegExp(`^packages/(?!db/)[^/]+/${dir}/__fixtures__/with-tables\\.ts$`).test(path),
      )
      .map((path) => tree.read(path));
  const failures = ["src", ...layers.filter((l) => l !== "infrastructure").map((l) => `src/${l}`)]
    .filter((dir) => !withTables(dir).some((text) => withTablesUnderDisableComment.test(text)))
    .map(
      (dir) =>
        `vite.config.ts stops withTables outside infrastructure/, but no packages/*/${dir}/__fixtures__/with-tables.ts has \`oxlint-disable-next-line no-restricted-properties\` on the line above a call of it. Add one, so that an override that stops reaching ${dir}/ fails \`vp check\` (docs/adr/0029).`,
    );
  if (
    layers.includes("infrastructure") &&
    !withTables("src/infrastructure").some(
      (text) => text.includes(".withTables") && !text.includes("oxlint-disable"),
    )
  )
    failures.push(
      "No packages/*/src/infrastructure/__fixtures__/with-tables.ts has a call of withTables with no disable comment, so nothing shows that infrastructure/ may call it (docs/adr/0029).",
    );
  return failures;
}

// ADR 0029: SQL that changes the role or the tenant of the connection is written in the helper of the transaction only.
// vite.config.ts turns tenant-sql/no-session-setting on for packages/shared-kernel/src and apps/api/src, each of which has a
// fixture (#43) that the rule must report, so that an override that stops reaching one of them fails `vp check`.
const sessionSettingAnnotation = "oxlint-disable-next-line tenant-sql/no-session-setting";
const sessionSettingPlaces = [
  {
    package: "packages/shared-kernel/src",
    exists: (tree: Tree) => packageNames(tree).includes("shared-kernel"),
  },
  {
    package: "apps/api/src",
    exists: (tree: Tree) => tree.paths.some((path) => path.startsWith("apps/api/src/")),
  },
];

export function sessionSettingGuards(tree: Tree): string[] {
  if (!tree.read("vite.config.ts").includes("tenant-sql/no-session-setting")) return [];
  return sessionSettingPlaces
    .filter(({ exists }) => exists(tree))
    .filter(
      ({ package: place }) =>
        !tree.paths
          .filter((path) => path.startsWith(`${place}/`) && fixtureFile.test(path))
          .some((path) => tree.read(path).includes(sessionSettingAnnotation)),
    )
    .map(
      ({ package: place }) =>
        `vite.config.ts turns on tenant-sql/no-session-setting for ${place}, but no fixture there has \`${sessionSettingAnnotation}\`. Add a SET ROLE or set_config in a sql template to ${place}/__fixtures__/session-setting.ts, so that an override that stops reaching ${place} fails \`vp check\` (docs/adr/0029).`,
    );
}
