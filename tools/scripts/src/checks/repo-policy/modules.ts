// Checks of the modules of the sample feature (docs/adr/0026): the package.json of each package under packages/,
// which module each depends on, the settings that would let a package resolve one it does not depend on, and the
// Effect lint of each module.
import { Tree, list, record } from "./tree.ts";

// The modules, in the one direction they depend: closing (締め) → approval (承認) → claim (申請). A module may
// depend on the modules after it, and on shared-kernel; shared-kernel depends on no module. This is the one place the direction
// is written: a module resolves only the packages its package.json declares (pnpm puts nothing else in its
// node_modules, so TypeScript cannot resolve it), and modulesDependOneWay checks the declarations against it.
const moduleOrder: readonly string[] = ["closing", "approval", "claim"];
const moduleOrderFile = "tools/scripts/src/checks/repo-policy/modules.ts";

// The scope of the packages of the workspace (their package.json names). vite.config.ts writes it too; it is read
// as text, so the two are not shared-kernel.
const scope = "@agent-software-factory";
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

const manifest = (name: string): string => `packages/${name}/package.json`;

// The names of the packages under packages/, from their package.json.
export const packageNames = (tree: Tree): string[] =>
  tree.paths.flatMap((path) => /^packages\/([^/]+)\/package\.json$/.exec(path)?.[1] ?? []);

// The packages under packages/ that are not modules of the sample feature (GLOSSARY.md, docs/adr/0026, 0034).
// shared-kernel is the code the modules share. module-fixtures has the layers of a module and holds the detection-power
// fixtures of the overrides that reach every module; it stays when the sample feature is removed. ui holds the
// shadcn/ui parts that the apps share; it has no layers, and no module depends on it. None depends on a package
// of the workspace.
// i18n holds the texts of the screens (the resources of ja and en, the setup of i18next) that web shares with the
// packages; it has no layers, and no module depends on it (docs/adr/0044).
const sharedKernel = "shared-kernel";
const moduleFixtures = "module-fixtures";
const ui = "ui";
const i18n = "i18n";
// telemetry starts the OpenTelemetry SDK in a Node-only entry, and holds the helper that drops the query string from
// a URL before it becomes an attribute (docs/adr/0048). It has no layers, and no module depends on it: the entry files of apps/api do.
const telemetry = "telemetry";
const dependOnNone: readonly string[] = [sharedKernel, moduleFixtures, ui, i18n, telemetry];
// db holds the tools of the database (migrations, the type generation, the tools of the tests). It is not a module and
// has no layers. It depends on the modules by `import type`, in devDependencies, and only apps/api and apps/worker
// (the pool and the tools of the tests) depend on it
// (docs/adr/0038). It is in neither moduleOrder nor dependOnNone: dbDependencies checks it.
const db = "db";
const dbApps = ["apps/api", "apps/worker"];

// The events package of a module is packages/<module>/events (docs/adr/0026): nested in the module, as a project of
// its own. The modules whose directory has one.
const eventsModuleNames = (tree: Tree): string[] =>
  tree.paths.flatMap((path) => /^packages\/([^/]+)\/events\/package\.json$/.exec(path)?.[1] ?? []);

const eventsSuffix = "-events";

// The names of the packages in the shape of a module, which have the layers and run the Effect lint: the modules,
// and module-fixtures. Every package under packages/ but the ones in `notModules`.
const notModules: readonly string[] = [sharedKernel, ui, i18n, telemetry, db];
export const modulePackageNames = (tree: Tree): string[] =>
  packageNames(tree).filter((name) => !notModules.includes(name));

// The package.json of every package under packages/ (docs/adr/0026): its name is the scope and its directory, it
// exports its src/index.ts and nothing else, so another package can import only that file, its Nx project has
// the name of its directory, and its `check` script runs `vp check`. Without the script, Nx runs neither the
// lint nor the type check of the package, and the rules and the fixtures say nothing about it.
const publicApi = { ".": "./src/index.ts" };
// ui has no index.ts: shadcn installs each part into a file of its own and imports it by the path of the part, so
// ui exports the folders of the parts, and the CSS that the apps import (docs/adr/0034).
const uiPublicApi = {
  "./globals.css": "./src/styles/globals.css",
  "./components/*": "./src/components/*.tsx",
  "./lib/*": "./src/lib/*.ts",
};

// The packages that are not modules and export something other than src/index.ts: the exports they must have, and
// what the message says about them. Adding a package of this kind is one entry here (docs/domain-model/add-package.md).
//   ui         no index.ts: the folders of the parts and the CSS (docs/adr/0034).
//   db         the production entry, the seed and the tools of the tests as three entries, so that faker,
//              testcontainers and Vitest stay out of the entry that production code imports (docs/adr/0038).
//   telemetry  the entry for any code and the Node-only entry that starts the SDK, which the entry files of the
//              apps import (docs/adr/0048).
const ownExports: Readonly<
  Record<string, { readonly exports: Record<string, string>; readonly says: string }>
> = {
  [ui]: {
    exports: uiPublicApi,
    says: "the folders of the parts and the CSS and nothing else (docs/adr/0034)",
  },
  [db]: {
    exports: {
      ".": "./src/index.ts",
      "./seed": "./src/seed/index.ts",
      "./testing": "./src/testing/index.ts",
    },
    says: "the entry of production, the seed and the tools of the tests, and nothing else (docs/adr/0038)",
  },
  [telemetry]: {
    exports: { ".": "./src/index.ts", "./node": "./src/node.ts" },
    says: "the entry for any code and the Node-only entry that starts the SDK, and nothing else (docs/adr/0048)",
  },
};

export function packageManifests(tree: Tree): string[] {
  return packageNames(tree).flatMap((name) => {
    const path = manifest(name);
    const json = record(tree.parsed(path));
    const failures: string[] = [];
    const own = ownExports[name];
    const exported = own?.exports ?? publicApi;
    if (json.name !== `${scope}/${name}`)
      failures.push(
        `${path} must have the name "${scope}/${name}", the scope and the directory (docs/adr/0026).`,
      );
    if (JSON.stringify(json.exports) !== JSON.stringify(exported))
      failures.push(
        `${path} must have the exports ${JSON.stringify(exported)}, ${own?.says ?? "so that another package can import only its src/index.ts (docs/adr/0026)"}.`,
      );
    if (name !== ui && !tree.paths.includes(`packages/${name}/src/index.ts`))
      failures.push(
        `packages/${name}/src/index.ts, the public API that the exports name, does not exist (docs/adr/0026).`,
      );
    if (record(json.nx).name !== name)
      failures.push(
        `${path} must have the Nx project name "${name}" (nx.name), the name of its directory (docs/adr/0026).`,
      );
    if (record(json.scripts).check !== "vp check")
      failures.push(
        `${path} must have the check script "vp check", so that Nx lints and type-checks the package (docs/adr/0026).`,
      );
    return failures;
  });
}

const isEventsPackage = (tree: Tree, name: string): boolean =>
  name.endsWith(eventsSuffix) &&
  eventsModuleNames(tree).includes(name.slice(0, -eventsSuffix.length));

// Every package under packages/ but shared-kernel, module-fixtures, ui, i18n and telemetry is a module of moduleOrder, and depends on no
// package of the workspace but shared-kernel and the modules after it. shared-kernel, module-fixtures, ui, i18n and telemetry depend on none.
export function modulesDependOneWay(tree: Tree): string[] {
  const failures: string[] = [];
  for (const name of packageNames(tree)) {
    if (name === db) continue;
    const dependsOnNone = dependOnNone.includes(name);
    const position = moduleOrder.indexOf(name);
    if (!dependsOnNone && position === -1) {
      failures.push(
        `packages/${name} is not in moduleOrder in ${moduleOrderFile}, so nothing checks which modules it depends on. Add it in the direction the modules depend (docs/adr/0026, docs/domain-model/add-module.md).`,
      );
      continue;
    }
    const json = record(tree.parsed(manifest(name)));
    for (const field of dependencyFields)
      for (const dependency of Object.keys(record(json[field]))) {
        if (!dependency.startsWith(`${scope}/`)) continue;
        const target = dependency.slice(scope.length + 1);
        // A dependency on db is dbDependencies' to refuse, for every package at once.
        if (target === db) continue;
        if (!dependsOnNone && (target === sharedKernel || moduleOrder.indexOf(target) > position))
          continue;
        // A module depends on the events package of any module: the events are how the modules talk without
        // depending on each other's body.
        if (!dependsOnNone && isEventsPackage(tree, target)) continue;
        failures.push(
          `${manifest(name)} has ${dependency} in ${field}. A module depends only on shared-kernel and the modules after it in closing → approval → claim, and shared-kernel, module-fixtures, ui, i18n and telemetry on none: move the code that needs ${target}, or move what both need into shared-kernel (docs/adr/0026).`,
        );
      }
  }
  return failures;
}

// The events package of each module (packages/<module>/events): it holds the schemas of the events the module
// sends, and depends on zod and shared-kernel only, so that a module which receives the events does not depend on the
// body of the one that sends them. It is not a module: it has no place in moduleOrder and no type:module tag.
// `order` is moduleOrder; a test passes another to show what a name of the events packages in it does.
export function eventsPackages(tree: Tree, order: readonly string[] = moduleOrder): string[] {
  const failures: string[] = [];
  const events = eventsModuleNames(tree);
  for (const name of order)
    if (name.endsWith(eventsSuffix))
      failures.push(
        `${name} is in moduleOrder in ${moduleOrderFile}, but it is the name of an events package, which is not a module. Take it out; an events package is not in moduleOrder (docs/adr/0026).`,
      );
  for (const module of events) {
    const path = `packages/${module}/events/package.json`;
    const json = record(tree.parsed(path));
    if (!order.includes(module)) {
      failures.push(
        `packages/${module}/events is an events package, but ${module} is not a module of moduleOrder in ${moduleOrderFile}. Only a module has one (docs/adr/0026, docs/domain-model/add-module.md).`,
      );
      continue;
    }
    if (json.name !== `${scope}/${module}${eventsSuffix}`)
      failures.push(
        `${path} must have the name "${scope}/${module}${eventsSuffix}", the scope and the module and events (docs/adr/0026).`,
      );
    if (JSON.stringify(json.exports) !== JSON.stringify(publicApi))
      failures.push(
        `${path} must have the exports ${JSON.stringify(publicApi)}, so that another package can import only its src/index.ts (docs/adr/0026).`,
      );
    if (!tree.paths.includes(`packages/${module}/events/src/index.ts`))
      failures.push(
        `packages/${module}/events/src/index.ts, the public API that the exports name, does not exist (docs/adr/0026).`,
      );
    if (record(json.scripts).test !== "vp test run")
      failures.push(
        `${path} must have the test script "vp test run", so that Nx runs the check of the past versions of the events (docs/async/event-contract.md).`,
      );
    if (!tree.paths.includes(`packages/${module}/events/test/versions.test.ts`))
      failures.push(
        `packages/${module}/events/test/versions.test.ts does not exist. It checks the schemas against the fixtures of the past versions (docs/async/event-contract.md).`,
      );
    if (
      !tree.paths.some((candidate) =>
        new RegExp(`^packages/${module}/events/test/fixtures/[^/]+\\.v[1-9]\\d*\\.json$`).test(
          candidate,
        ),
      )
    )
      failures.push(
        `packages/${module}/events/test/fixtures/ has no <kind>.v<version>.json. Each event has a fixture of its current version (docs/async/event-contract.md).`,
      );
    const nx = record(json.nx);
    if (nx.name !== `${module}${eventsSuffix}`)
      failures.push(
        `${path} must have the Nx project name "${module}${eventsSuffix}" (nx.name), the module and events (docs/adr/0026).`,
      );
    if (record(json.scripts).check !== "vp check")
      failures.push(
        `${path} must have the check script "vp check", so that Nx lints and type-checks the package (docs/adr/0026).`,
      );
    if (list(nx.tags).includes(moduleTag))
      failures.push(
        `${path} has the tag ${moduleTag}. An events package is not a module: a module is a name of moduleOrder, and the tag would ask for a place there (docs/adr/0026).`,
      );
    for (const field of dependencyFields)
      for (const dependency of Object.keys(record(json[field]))) {
        if (!dependency.startsWith(`${scope}/`) || dependency === `${scope}/${sharedKernel}`)
          continue;
        failures.push(
          `${path} has ${dependency} in ${field}. An events package depends on zod and shared-kernel only: the schemas of the events must not pull in the code of a module (docs/adr/0026).`,
        );
      }
  }
  for (const module of packageNames(tree))
    if (order.includes(module) && !events.includes(module))
      failures.push(
        `packages/${module} has no events package at packages/${module}/events/package.json. Every module has one, for the events it sends to the other modules (docs/adr/0026, docs/domain-model/add-module.md).`,
      );
  return failures;
}

// The mark of a module in package.json: nx.tags has "type:module". The type generation of packages/db reads it too
// (moduleSchemas in packages/db/src/types.ts, which cannot import this file: keep the two values the same), so the
// tag is the second list of the modules besides moduleOrder.
const moduleTag = "type:module";
const addModuleGuide = "docs/domain-model/add-module.md";
const apiManifest = "apps/api/package.json";
const apiFiles = ["apps/api/src/db/databases.ts", "apps/api/src/app.ts"];

// Every package that has the tag is in moduleOrder, and every name of moduleOrder is a package that has the tag.
// A tagged module is also a dependency of apps/api, and databases.ts and app.ts import it: a module copied from
// another and left out of one of these has no database, or no route, and nothing else says so (docs/adr/0026).
export function modulesAreRegistered(tree: Tree): string[] {
  const failures: string[] = [];
  const guide = `Follow ${addModuleGuide}.`;
  const names = packageNames(tree);
  const tagged = names.filter((name) =>
    list(record(record(tree.parsed(manifest(name))).nx).tags).includes(moduleTag),
  );
  for (const name of tagged)
    if (!moduleOrder.includes(name))
      failures.push(
        `packages/${name} has the tag ${moduleTag} but is not in moduleOrder in ${moduleOrderFile}. ${guide}`,
      );
  for (const name of moduleOrder)
    if (!tagged.includes(name))
      failures.push(
        `${name} is in moduleOrder in ${moduleOrderFile}, but no package under packages/ named ${name} has the tag ${moduleTag} in nx.tags of its package.json. ${guide}`,
      );
  const api = record(tree.parsed(apiManifest)).dependencies;
  for (const name of tagged) {
    if (record(api)[`${scope}/${name}`] !== "workspace:*")
      failures.push(
        `${apiManifest} must have ${scope}/${name}: "workspace:*" in dependencies, since packages/${name} has the tag ${moduleTag}. ${guide}`,
      );
    const importPattern = new RegExp(`(?:from|import)\\s*["']${scope}/${name}["']`);
    for (const path of apiFiles)
      if (!importPattern.test(tree.read(path)))
        failures.push(
          `${path} must import ${scope}/${name}, since packages/${name} has the tag ${moduleTag}. ${guide}`,
        );
  }
  return failures;
}

// db depends on the modules, in devDependencies and for their types, and on no other package of the workspace. Only
// apps/api and apps/worker depend on db: the modules and shared-kernel have no use for the tools of the database, and
// apps/web and the tools must not reach them (docs/adr/0038).
export function dbDependencies(tree: Tree): string[] {
  if (!packageNames(tree).includes(db)) return [];
  const failures: string[] = [];
  const own = record(tree.parsed(manifest(db)));
  for (const field of dependencyFields)
    for (const dependency of Object.keys(record(own[field]))) {
      if (!dependency.startsWith(`${scope}/`)) continue;
      if (field === "devDependencies" && moduleOrder.includes(dependency.slice(scope.length + 1)))
        continue;
      failures.push(
        `${manifest(db)} has ${dependency} in ${field}. db depends on the modules by \`import type\` only, so it lists them in devDependencies and no other package of the workspace: move the code that needs ${dependency.slice(scope.length + 1)} out of db (docs/adr/0038).`,
      );
    }
  for (const path of tree.named("package.json")) {
    if (path === manifest(db) || dbApps.some((app) => path === `${app}/package.json`)) continue;
    const json = record(tree.parsed(path));
    for (const field of dependencyFields)
      if (`${scope}/${db}` in record(json[field]))
        failures.push(
          `${path} has ${scope}/${db} in ${field}. Only ${dbApps.join(" and ")} depend on db: the modules, shared-kernel, ui and the other apps and tools have no use for the tools of the database (docs/adr/0038).`,
        );
  }
  return failures;
}

// A pnpm glob (publicHoistPattern) as a regular expression: * matches any characters.
const globPattern = (glob: string): RegExp =>
  new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\/]/g, "\\$&").replaceAll("*", ".*")}$`);

const resolves = (path: string, what: string) =>
  `${path} ${what}, which lets a package resolve a package that its package.json does not declare. The direction between the modules rests on that not resolving (docs/adr/0026).`;

// What to write for the `@/*` import of apps/web, said where `paths` or `alias` is refused (docs/adr/0033).
export const pathsHint =
  "To import with `@/*`, set compilerOptions.paths with targets under ./src/ only, and resolve.tsconfigPaths: true in vite.config.ts (docs/adr/0033).";

// An alias key of a Vite config: `alias:`, or the shorthand `{ alias }` and `{ alias, ... }`. Line comments are
// dropped first, so the word in a comment ("the Node.js alias of globalThis") does not count; the // of a URL
// ("https://") follows a colon and is kept.
const aliasKey = /\balias\s*[:,}]/;
const withoutLineComments = (text: string): string => text.replace(/(^|[^:])\/\/.*/gm, "$1");

// A `paths` that only names files under the package's own src/ ({ "@/*": ["./src/*"] }, docs/adr/0033). It
// resolves nothing outside the package, so it cannot reach a module the package does not declare. An empty
// `paths`, a target outside ./src/, and a target with `..` are not this.
function staysInSrc(paths: unknown): boolean {
  const entries = Object.values(record(paths));
  return (
    entries.length > 0 &&
    entries.every(
      (targets) =>
        Array.isArray(targets) &&
        targets.length > 0 &&
        targets.every(
          (target) =>
            typeof target === "string" && target.startsWith("./src/") && !target.includes(".."),
        ),
    )
  );
}

// The settings that let a package resolve a package it does not declare: the paths and baseUrl of a tsconfig.json
// (TypeScript), an alias of a vite.config.ts (Vite and Vitest), and a hoisted node_modules (pnpm). With any of
// them, a module could import a module that it may not depend on, and nothing would stop it.
export function noResolutionBypass(tree: Tree): string[] {
  const failures: string[] = [];
  for (const path of tree.named("tsconfig.json")) {
    const options = record(record(tree.parsed(path)).compilerOptions);
    if ("baseUrl" in options) failures.push(resolves(path, "sets compilerOptions.baseUrl"));
    if ("paths" in options && !staysInSrc(options.paths))
      failures.push(`${resolves(path, "sets compilerOptions.paths")} ${pathsHint}`);
  }
  for (const path of tree.named("vite.config.ts"))
    if (aliasKey.test(withoutLineComments(tree.read(path))))
      failures.push(`${resolves(path, "sets an alias")} ${pathsHint}`);
  const workspace = record(tree.parsed("pnpm-workspace.yaml"));
  if (workspace.shamefullyHoist === true)
    failures.push(resolves("pnpm-workspace.yaml", "sets shamefullyHoist"));
  if (workspace.nodeLinker === "hoisted")
    failures.push(resolves("pnpm-workspace.yaml", "sets nodeLinker: hoisted"));
  // A pattern that hoists any package of the workspace to the root node_modules lets every package resolve it.
  const packages = packageNames(tree).map((name) => `${scope}/${name}`);
  for (const pattern of list(workspace.publicHoistPattern)) {
    if (typeof pattern !== "string") continue;
    const hoisted = packages.find((name) => globPattern(pattern).test(name));
    if (hoisted !== undefined)
      failures.push(
        resolves(
          "pnpm-workspace.yaml",
          `has ${pattern} in publicHoistPattern, which hoists ${hoisted}`,
        ),
      );
  }
  return failures;
}

// The Effect lint of a module (docs/adr/0028). Its fixtures are in one module only, so they show the rules work,
// not that each module runs them: each module runs the same command on its application and infrastructure.
const lintEffect =
  "effect-tsgo oxlint --type-aware -c ../../oxlint.effect.json src/application src/infrastructure";

export function modulesLintEffect(tree: Tree): string[] {
  return modulePackageNames(tree).flatMap((name) => {
    const script = record(record(tree.parsed(manifest(name))).scripts)["lint-effect"];
    return script === lintEffect
      ? []
      : [
          `${manifest(name)} must have the lint-effect script "${lintEffect}", so that effect-tsgo checks the module (docs/adr/0028).`,
        ];
  });
}
