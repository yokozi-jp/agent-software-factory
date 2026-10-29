// Checks of the modules of the sample feature (docs/adr/0026): the package.json of each package under packages/,
// which module each depends on, the settings that would let a package resolve one it does not depend on, and the
// Effect lint of each module.
import { Tree, list, record } from "./tree.ts";

// The modules, in the one direction they depend: closing (締め) → approval (承認) → claim (申請). A module may
// depend on the modules after it, and on shared; shared depends on no module. This is the one place the direction
// is written: a module resolves only the packages its package.json declares (pnpm puts nothing else in its
// node_modules, so TypeScript cannot resolve it), and modulesDependOneWay checks the declarations against it.
const moduleOrder: readonly string[] = ["closing", "approval", "claim"];
const moduleOrderFile = "tools/scripts/src/checks/repo-policy/modules.ts";

// The scope of the packages of the workspace (their package.json names). vite.config.ts writes it too; it is read
// as text, so the two are not shared.
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
// shared is the code the modules share. module-fixtures has the layers of a module and holds the detection-power
// fixtures of the overrides that reach every module; it stays when the sample feature is removed. ui holds the
// shadcn/ui parts that the apps share; it has no layers, and no module depends on it. None depends on a package
// of the workspace.
// i18n holds the texts of the screens (the resources of ja and en, the setup of i18next) that web shares with the
// packages; it has no layers, and no module depends on it (docs/adr/0044).
const shared = "shared";
const moduleFixtures = "module-fixtures";
const ui = "ui";
const i18n = "i18n";
const dependOnNone: readonly string[] = [shared, moduleFixtures, ui, i18n];
// db holds the tools of the database (migrations, the type generation, the tools of the tests). It is not a module and
// has no layers. It depends on the modules by `import type`, in devDependencies, and only apps/api depends on it
// (docs/adr/0038). It is in neither moduleOrder nor dependOnNone: dbDependencies checks it.
const db = "db";
const dbApp = "apps/api";

// The names of the packages in the shape of a module, which have the layers and run the Effect lint: the modules,
// and module-fixtures. Every package under packages/ but shared, ui, i18n and db.
export const modulePackageNames = (tree: Tree): string[] =>
  packageNames(tree).filter(
    (name) => name !== shared && name !== ui && name !== i18n && name !== db,
  );

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

// db has the production entry, the seed and the tools of the tests as three entries, so that faker, testcontainers
// and Vitest stay out of the entry that production code imports (docs/adr/0038).
const dbPublicApi = {
  ".": "./src/index.ts",
  "./seed": "./src/seed/index.ts",
  "./testing": "./src/testing/index.ts",
};

export function packageManifests(tree: Tree): string[] {
  return packageNames(tree).flatMap((name) => {
    const path = manifest(name);
    const json = record(tree.parsed(path));
    const failures: string[] = [];
    const isUi = name === ui;
    const isDb = name === db;
    const exported = isUi ? uiPublicApi : isDb ? dbPublicApi : publicApi;
    if (json.name !== `${scope}/${name}`)
      failures.push(
        `${path} must have the name "${scope}/${name}", the scope and the directory (docs/adr/0026).`,
      );
    if (JSON.stringify(json.exports) !== JSON.stringify(exported))
      failures.push(
        isUi
          ? `${path} must have the exports ${JSON.stringify(exported)}, the folders of the parts and the CSS and nothing else (docs/adr/0034).`
          : isDb
            ? `${path} must have the exports ${JSON.stringify(exported)}, the entry of production, the seed and the tools of the tests, and nothing else (docs/adr/0038).`
            : `${path} must have the exports ${JSON.stringify(exported)}, so that another package can import only its src/index.ts (docs/adr/0026).`,
      );
    if (!isUi && !tree.paths.includes(`packages/${name}/src/index.ts`))
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

// Every package under packages/ but shared, module-fixtures, ui and i18n is a module of moduleOrder, and depends on no
// package of the workspace but shared and the modules after it. shared, module-fixtures, ui and i18n depend on none.
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
        if (!dependsOnNone && (target === shared || moduleOrder.indexOf(target) > position))
          continue;
        failures.push(
          `${manifest(name)} has ${dependency} in ${field}. A module depends only on shared and the modules after it in closing → approval → claim, and shared, module-fixtures, ui and i18n on none: move the code that needs ${target}, or move what both need into shared (docs/adr/0026).`,
        );
      }
  }
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
// apps/api depends on db: the modules and shared have no use for the tools of the database, and apps/web and the
// tools must not reach them (docs/adr/0038).
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
    if (path === manifest(db) || path === `${dbApp}/package.json`) continue;
    const json = record(tree.parsed(path));
    for (const field of dependencyFields)
      if (`${scope}/${db}` in record(json[field]))
        failures.push(
          `${path} has ${scope}/${db} in ${field}. Only ${dbApp} depends on db: the modules, shared, ui and the other apps and tools have no use for the tools of the database (docs/adr/0038).`,
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
