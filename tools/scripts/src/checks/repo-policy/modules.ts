// Checks of the modules of the sample feature (docs/adr/0026): which module each package under packages/ depends
// on, the settings that would let a package resolve one it does not depend on, and the Effect lint of each module.
import { Tree, list, record } from "./tree.ts";

// The modules, in the one direction they depend: closing (締め) → approval (承認) → claim (申請). A module may
// depend on the modules after it, and on shared; shared depends on no module. This is the one place the direction
// is written: a module resolves only the packages its package.json declares (pnpm puts nothing else in its
// node_modules, so TypeScript cannot resolve it), and modulesDependOneWay checks the declarations against it.
const moduleOrder: readonly string[] = ["closing", "approval", "claim"];

const scope = "@agent-software-factory/";
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;
const table = "tools/scripts/src/checks/repo-policy/modules.ts";

// The names of the packages under packages/, from their package.json.
export const packageNames = (tree: Tree): string[] =>
  tree.paths.flatMap((path) => /^packages\/([^/]+)\/package\.json$/.exec(path)?.[1] ?? []);

// Every package under packages/ but shared is a module of moduleOrder, and depends on no package of the workspace
// but shared and the modules after it. shared depends on none of them.
export function modulesDependOneWay(tree: Tree): string[] {
  const failures: string[] = [];
  for (const name of packageNames(tree)) {
    const path = `packages/${name}/package.json`;
    const position = moduleOrder.indexOf(name);
    if (name !== "shared" && position === -1) {
      failures.push(
        `packages/${name} is not in moduleOrder in ${table}, so nothing checks which modules it depends on. Add it in the direction the modules depend (docs/adr/0026).`,
      );
      continue;
    }
    const json = record(tree.parsed(path));
    for (const field of dependencyFields)
      for (const dependency of Object.keys(record(json[field]))) {
        if (!dependency.startsWith(scope)) continue;
        const target = dependency.slice(scope.length);
        if (name !== "shared" && (target === "shared" || moduleOrder.indexOf(target) > position))
          continue;
        failures.push(
          `${path} has ${dependency} in ${field}. A module depends only on shared and the modules after it in closing → approval → claim, and shared on none: move the code that needs ${target}, or move what both need into shared (docs/adr/0026).`,
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
    if (/\balias\s*:/.test(tree.read(path))) failures.push(resolves(path, "sets an alias"));
  const workspace = record(tree.parsed("pnpm-workspace.yaml"));
  if (workspace.shamefullyHoist === true)
    failures.push(resolves("pnpm-workspace.yaml", "sets shamefullyHoist"));
  if (workspace.nodeLinker === "hoisted")
    failures.push(resolves("pnpm-workspace.yaml", "sets nodeLinker: hoisted"));
  for (const pattern of list(workspace.publicHoistPattern))
    if (typeof pattern === "string" && globPattern(pattern).test(`${scope}claim`))
      failures.push(
        resolves(
          "pnpm-workspace.yaml",
          `has ${pattern} in publicHoistPattern, which hoists the modules`,
        ),
      );
  return failures;
}

// The Effect lint of a module (docs/adr/0028). Its fixtures are in one module only, so they show the rules work,
// not that each module runs them: each module runs the same command on its application and infrastructure.
const lintEffect =
  "effect-tsgo oxlint --type-aware -c ../../oxlint.effect.json src/application src/infrastructure";

export function modulesLintEffect(tree: Tree): string[] {
  return packageNames(tree)
    .filter((name) => name !== "shared")
    .flatMap((name) => {
      const path = `packages/${name}/package.json`;
      const script = record(record(tree.parsed(path)).scripts)["lint-effect"];
      return script === lintEffect
        ? []
        : [
            `${path} must have the lint-effect script "${lintEffect}", so that effect-tsgo checks the module (docs/adr/0028).`,
          ];
    });
}
