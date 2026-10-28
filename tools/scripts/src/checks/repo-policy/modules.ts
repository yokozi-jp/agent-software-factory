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

// The packages under packages/ that are not modules of the sample feature (GLOSSARY.md, docs/adr/0026). shared is
// the code the modules share. module-fixtures has the layers of a module and holds the detection-power fixtures of
// the overrides that reach every module; it stays when the sample feature is removed. Neither depends on a package
// of the workspace.
const shared = "shared";
const moduleFixtures = "module-fixtures";
const dependOnNone: readonly string[] = [shared, moduleFixtures];

// The names of the packages in the shape of a module, which have the layers and run the Effect lint: the modules,
// and module-fixtures. Every package under packages/ but shared.
export const modulePackageNames = (tree: Tree): string[] =>
  packageNames(tree).filter((name) => name !== shared);

// The package.json of every package under packages/ (docs/adr/0026): its name is the scope and its directory, it
// exports its src/index.ts and nothing else, so another package can import only that file, its Nx project has
// the name of its directory, and its `check` script runs `vp check`. Without the script, Nx runs neither the
// lint nor the type check of the package, and the rules and the fixtures say nothing about it.
const publicApi = { ".": "./src/index.ts" };

export function packageManifests(tree: Tree): string[] {
  return packageNames(tree).flatMap((name) => {
    const path = manifest(name);
    const json = record(tree.parsed(path));
    const failures: string[] = [];
    if (json.name !== `${scope}/${name}`)
      failures.push(
        `${path} must have the name "${scope}/${name}", the scope and the directory (docs/adr/0026).`,
      );
    if (JSON.stringify(json.exports) !== JSON.stringify(publicApi))
      failures.push(
        `${path} must have the exports ${JSON.stringify(publicApi)}, so that another package can import only its src/index.ts (docs/adr/0026).`,
      );
    if (!tree.paths.includes(`packages/${name}/src/index.ts`))
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

// Every package under packages/ but shared and module-fixtures is a module of moduleOrder, and depends on no
// package of the workspace but shared and the modules after it. shared and module-fixtures depend on none.
export function modulesDependOneWay(tree: Tree): string[] {
  const failures: string[] = [];
  for (const name of packageNames(tree)) {
    const dependsOnNone = dependOnNone.includes(name);
    const position = moduleOrder.indexOf(name);
    if (!dependsOnNone && position === -1) {
      failures.push(
        `packages/${name} is not in moduleOrder in ${moduleOrderFile}, so nothing checks which modules it depends on. Add it in the direction the modules depend (docs/adr/0026).`,
      );
      continue;
    }
    const json = record(tree.parsed(manifest(name)));
    for (const field of dependencyFields)
      for (const dependency of Object.keys(record(json[field]))) {
        if (!dependency.startsWith(`${scope}/`)) continue;
        const target = dependency.slice(scope.length + 1);
        if (!dependsOnNone && (target === shared || moduleOrder.indexOf(target) > position))
          continue;
        failures.push(
          `${manifest(name)} has ${dependency} in ${field}. A module depends only on shared and the modules after it in closing → approval → claim, and shared and module-fixtures on none: move the code that needs ${target}, or move what both need into shared (docs/adr/0026).`,
        );
      }
  }
  return failures;
}

// A pnpm glob (publicHoistPattern) as a regular expression: * matches any characters.
const globPattern = (glob: string): RegExp =>
  new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\/]/g, "\\$&").replaceAll("*", ".*")}$`);

const resolves = (path: string, what: string) =>
  `${path} ${what}, which lets a package resolve a package that its package.json does not declare. The direction between the modules rests on that not resolving (docs/adr/0026).`;

// An alias key of a Vite config: `alias:`, or the shorthand `{ alias }` and `{ alias, ... }`. Line comments are
// dropped first, so the word in a comment ("the Node.js alias of globalThis") does not count; the // of a URL
// ("https://") follows a colon and is kept.
const aliasKey = /\balias\s*[:,}]/;
const withoutLineComments = (text: string): string => text.replace(/(^|[^:])\/\/.*/gm, "$1");

// The settings that let a package resolve a package it does not declare: the paths and baseUrl of a tsconfig.json
// (TypeScript), an alias of a vite.config.ts (Vite and Vitest), and a hoisted node_modules (pnpm). With any of
// them, a module could import a module that it may not depend on, and nothing would stop it.
export function noResolutionBypass(tree: Tree): string[] {
  const failures: string[] = [];
  for (const path of tree.named("tsconfig.json")) {
    const options = record(record(tree.parsed(path)).compilerOptions);
    for (const option of ["paths", "baseUrl"])
      if (option in options) failures.push(resolves(path, `sets compilerOptions.${option}`));
  }
  for (const path of tree.named("vite.config.ts"))
    if (aliasKey.test(withoutLineComments(tree.read(path))))
      failures.push(resolves(path, "sets an alias"));
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
