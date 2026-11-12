// Checks of the layout of the modules and of the drivers (docs/adr/0054, docs/domain-model/package-layout.md).
// A driver is a shared package that touches an external system and holds no business rule: db, hr-system, i18n,
// logging and telemetry. It has the tag type:driver (roles.ts), and an entry in driverShapes below. Each has the layers domain/ and infrastructure/ (and testing/ for the tools of its tests),
// and the files named by its `exports` are the only ones in src/ that are not in a directory; those files only
// re-export. The libraries a layer may import, and the direction between the layers, are lint rules
// (vite.config.ts); this file checks what a lint rule cannot see: which names a package and its src/ may hold,
// what an entry file contains, and that a driver does not depend on Effect.
import { namesWithRole, roleOf, tagOf } from "./roles.ts";
import { Tree, list, record } from "./tree.ts";

const guide = "docs/domain-model/package-layout.md";

// The drivers are named here, in nodeDrivers or webDrivers of vite.config.ts, and in the values of `driver-in-module` of
// lint-restrictions.json; driversAreInLint fails when a driver is missing from one of them.
// What a driver may hold besides the files every package has, and what its entries may re-export.
//   tools     names at the root of the package that a tool decides (migrations/ of dbmate, openapi.yaml, the stubs of
//             the fake): they stay where the tool looks for them, and are listed here (rule C5).
//   places    names in src/ that a tool decides (locales/ of i18next-cli).
//   rootMay   the layers that the entry `.` may re-export. Other entries are fixed: `./testing` re-exports testing/, and
//             the rest re-export infrastructure/ and domain/. `.` re-exports domain/ only, because it is the entry that any
//             code imports and it must not pull in an external library (docs/adr/0051). i18n is the exception: it is a thin
//             wrapper that web alone uses.
interface DriverShape {
  readonly tools?: readonly string[];
  readonly places?: readonly string[];
  readonly rootMay?: readonly string[];
}

const driverShapes: Readonly<Record<string, DriverShape>> = {
  db: { tools: ["bootstrap.sql", "migrations", "templates", "test"] },
  "hr-system": { tools: ["fake", "openapi.yaml", "test"] },
  i18n: {
    tools: ["i18next.config.ts", "test"],
    places: ["locales"],
    rootMay: ["domain", "infrastructure"],
  },
  logging: {},
  telemetry: {},
};

const driverNames: readonly string[] = Object.keys(driverShapes);

const standardFiles = ["package.json", "tsconfig.json", "vite.config.ts"];
const layers = ["domain", "infrastructure"];
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

const isDriver = (tree: Tree, name: string): boolean =>
  tree.paths.includes(`packages/${name}/package.json`);

// The tag type:driver and the entry in driverShapes go together. A driver with the tag and no entry is under none of the
// rules below (they walk driverShapes), so nothing would check its layout, its entries or that it does not use Effect. An
// entry for a package with the tag of another role would check a package that is not a driver. A package with no role is
// refused by packagesHaveOneRole.
export function driversAreTagged(tree: Tree): string[] {
  const failures: string[] = [];
  for (const name of namesWithRole(tree, "driver"))
    if (!driverNames.includes(name))
      failures.push(
        `packages/${name} has the tag type:driver, but driverShapes of tools/scripts/src/checks/repo-policy/drivers.ts has no entry for ${name}, so nothing checks its layout, its entries or that it does not depend on Effect. Add the entry (docs/adr/0054, ${guide}, docs/domain-model/add-package.md).`,
      );
  for (const name of driverNames) {
    const role = roleOf(tree, name);
    if (isDriver(tree, name) && role !== undefined && role !== "driver")
      failures.push(
        `packages/${name} has an entry in driverShapes of tools/scripts/src/checks/repo-policy/drivers.ts, but its tag is ${tagOf(role)}, not type:driver. A driver has the tag type:driver; take the entry out if it is not one (docs/adr/0054, ${guide}).`,
      );
  }
  return failures;
}

// The first segment under `prefix` of a path, and whether the path has more segments (it is in a directory).
export function childOf(
  path: string,
  prefix: string,
): { name: string; inDirectory: boolean } | undefined {
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length);
  const slash = rest.indexOf("/");
  return slash === -1
    ? { name: rest, inDirectory: false }
    : { name: rest.slice(0, slash), inDirectory: true };
}

// The files that the `exports` of a driver name, as the file in src/ and the key of the entry: the entries are files
// of src/ that re-export (rule D3), so another file in src/ is not one.
function entryFiles(tree: Tree, name: string): Map<string, string> {
  const exported = record(record(tree.parsed(`packages/${name}/package.json`)).exports);
  const files = new Map<string, string>();
  for (const [key, target] of Object.entries(exported)) {
    const match = typeof target === "string" ? /^\.\/src\/([^/]+)$/.exec(target) : null;
    if (match?.[1] !== undefined) files.set(match[1], key);
  }
  return files;
}

// Rules C5, D1 and D2: the root of a driver holds the files every package has and the places of its tools, and src/ holds
// the entry files, domain/, infrastructure/, testing/, __fixtures__/ and the places of its tools. A driver has no
// application/ or http/: it has no use case of its own, and an empty layer is not made.
export function driversHaveTheirLayout(tree: Tree): string[] {
  const failures: string[] = [];
  for (const [name, { tools = [], places = [] }] of Object.entries(driverShapes)) {
    if (!isDriver(tree, name)) continue;
    const root = `packages/${name}/`;
    const entries = entryFiles(tree, name);
    const seen = new Set<string>();
    for (const path of tree.paths) {
      const top = childOf(path, root);
      if (top === undefined) continue;
      if (top.name === "src") {
        const inSrc = childOf(path, `${root}src/`);
        if (inSrc === undefined || seen.has(`src/${inSrc.name}`)) continue;
        const allowed = inSrc.inDirectory
          ? [...layers, "testing", "__fixtures__", ...places]
          : [...entries.keys()];
        if (allowed.includes(inSrc.name)) continue;
        seen.add(`src/${inSrc.name}`);
        if (inSrc.inDirectory && (inSrc.name === "application" || inSrc.name === "http"))
          failures.push(
            `${root}src/${inSrc.name}/ is a layer of a module. The driver ${name} has domain/ and infrastructure/ only: it has no use case or route of its own, so put its code in infrastructure/ (docs/adr/0054, ${guide}).`,
          );
        else if (inSrc.inDirectory)
          failures.push(
            `${root}src/${inSrc.name}/ is not a place of the driver ${name}. src/ holds ${[...layers, "testing", "__fixtures__", ...places].join(", ")}: move the code into one of them (docs/adr/0054, ${guide}).`,
          );
        else
          failures.push(
            `${root}src/${inSrc.name} is not an entry of the driver ${name}. The files in src/ outside a directory are the ones that its exports name (${[...entries.keys()].join(", ")}), and they only re-export: move the code into domain/, infrastructure/ or testing/ (docs/adr/0054, ${guide}).`,
          );
        continue;
      }
      if (seen.has(top.name) || [...standardFiles, ...tools].includes(top.name)) continue;
      seen.add(top.name);
      failures.push(
        `${root}${top.name}${top.inDirectory ? "/" : ""} is not in the root of the driver ${name}. The root holds ${[...standardFiles, "src", ...tools].join(", ")}; a file that a tool looks for is added to the tools of ${name} in driverShapes of tools/scripts/src/checks/repo-policy/drivers.ts (docs/adr/0054, ${guide}).`,
      );
    }
  }
  return failures;
}

// The code of a file without its comments, as the statements: a line comment (alone on its line or after a statement),
// a block comment and the blank lines are dropped, and the rest is split at `;`. A `//` in a string cuts the statement
// too, which is no harm here: a statement that is cut is not a re-export, and is refused as it would be whole.
function statements(source: string): string[] {
  return source
    .replaceAll(/\/\*[^]*?\*\//g, "")
    .replaceAll(/\/\/.*/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
}

// A re-export (`export * from "./x.ts"`, `export { a, type B } from "./x.ts"`, `export type { C } from "./x.ts"`) or a
// type import that carries an augmentation (`import type {} from "./x.ts"`). The path is the first capture.
const reexport =
  /^(?:export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from|import\s+type\s*\{\s*\}\s+from)\s*["']([^"']+)["']$/;

// Rules D3 and D4: an entry file only re-exports, and from the places its entry may use. The entry `.` re-exports domain/ (and
// infrastructure/ for i18n), `./testing` re-exports testing/, the others re-export infrastructure/ and domain/.
export function driverEntriesOnlyReexport(tree: Tree): string[] {
  const failures: string[] = [];
  for (const [name, { rootMay = ["domain"] }] of Object.entries(driverShapes)) {
    // Stryker disable next-line ConditionalExpression: equivalent, without a package.json the exports are empty, so there is no entry to read
    if (!isDriver(tree, name)) continue;
    for (const [file, key] of entryFiles(tree, name)) {
      const path = `packages/${name}/src/${file}`;
      // Stryker disable next-line ConditionalExpression: equivalent, a file that the tree does not have reads as empty, which has no statement
      if (!tree.paths.includes(path)) continue;
      const may = key === "." ? rootMay : key === "./testing" ? ["testing"] : layers;
      for (const statement of statements(tree.read(path))) {
        const target = reexport.exec(statement)?.[1];
        if (target === undefined) {
          failures.push(
            `${path} has \`${statement.replaceAll(/\s+/g, " ")}\`. An entry file only re-exports (\`export … from "./<layer>/…"\`): put the code in ${may.map((layer) => `${layer}/`).join(" or ")} (docs/adr/0054, ${guide}).`,
          );
          continue;
        }
        const layer = /^\.\/([^/]+)\//.exec(target)?.[1];
        // Stryker disable next-line ConditionalExpression: equivalent, `may.includes(undefined)` is false too
        if (layer === undefined || !may.includes(layer))
          failures.push(
            `${path} re-exports "${target}", but the entry ${key} of ${name} re-exports ${may.map((place) => `${place}/`).join(" and ")} only${key === "." ? ": the entry that any code imports does not pull in an external library (docs/adr/0051)" : ""} (docs/adr/0054, ${guide}).`,
          );
      }
    }
  }
  return failures;
}

// Rule D5: a driver returns a Promise and does not depend on Effect. The infrastructure of the module wraps the driver with
// Effect.tryPromise, so the Effect version is the module's to move (docs/adr/0054).
export function driversDoNotUseEffect(tree: Tree): string[] {
  return driverNames.flatMap((name) => {
    // Stryker disable next-line ConditionalExpression: equivalent, without a package.json there is no dependency to refuse
    if (!isDriver(tree, name)) return [];
    const path = `packages/${name}/package.json`;
    const json = record(tree.parsed(path));
    return dependencyFields.flatMap((field) =>
      Object.keys(record(json[field]))
        .filter((dependency) => dependency === "effect" || dependency.startsWith("@effect/"))
        .map(
          (dependency) =>
            `${path} has ${dependency} in ${field}. A driver returns a Promise and does not depend on Effect: the infrastructure of the module wraps it with Effect.tryPromise (docs/adr/0054).`,
        ),
    );
  });
}

// The drivers are named in three places besides driverShapes, and a driver left out of one of them is not under that
// rule: the `driver-in-module` values of the table of lint restrictions (the module's application and http may not import it),
// the fixture of `driver-effect` (the lint rule that keeps Effect out reaches its infrastructure/), and `nodeDrivers` or
// `webDrivers` of vite.config.ts (the libraries and the runtime its infrastructure may use). A name in the table that is
// no driver is refused too.
const scope = "@agent-software-factory";
const tablePath = "lint-restrictions.json";

// The text of `const <name> = …` in vite.config.ts, up to the end of its statement (`\n];` or `\n};`).
function declaration(source: string, name: string): string {
  const start = source.indexOf(`const ${name}`);
  // Stryker disable next-line ConditionalExpression,UnaryOperator,StringLiteral: equivalent, the callers look for a name in the text, and the last character of the file (what `slice(-1)` gives) or this text holds none
  if (start === -1) return "";
  const rest = source.slice(start);
  const stop = rest.search(/\n[\]}];/);
  return stop === -1 ? rest : rest.slice(0, stop);
}

export function driversAreInLint(tree: Tree): string[] {
  const failures: string[] = [];
  const table = record(tree.parsed(tablePath));
  const inModule = list(record(table["driver-in-module"]).values);
  const effectFiles = list(record(table["driver-effect"]).rows).flatMap((row) =>
    list(record(row).files),
  );
  const vite = tree.read("vite.config.ts");
  const nodeDrivers = declaration(vite, "nodeDrivers");
  const webDrivers = declaration(vite, "webDrivers");
  for (const name of driverNames) {
    if (!isDriver(tree, name)) continue;
    const fixture = `packages/${name}/src/infrastructure/__fixtures__/driver-effect.ts`;
    if (!inModule.includes(`${scope}/${name}`))
      failures.push(
        `${tablePath} does not have ${scope}/${name} in the values of driver-in-module. The application and http of a module may import the driver ${name} until it is there: add it, with its rows in the fixtures of packages/module-fixtures (docs/adr/0054, ${guide}).`,
      );
    if (!effectFiles.includes(fixture))
      failures.push(
        `${tablePath} does not have ${fixture} in the rows of driver-effect. Add the fixture that shows the lint rule stops \`effect\` in ${name}, and its rows (docs/adr/0054, ${guide}).`,
      );
    if (
      !new RegExp(`^\\s+"?${name}"?: \\{`, "m").test(nodeDrivers) &&
      !webDrivers.includes(`"${name}"`)
    )
      failures.push(
        `vite.config.ts names the driver ${name} in neither nodeDrivers nor webDrivers, so the rules of the drivers do not reach its infrastructure/. Add it to the one that fits where it runs (docs/adr/0054, ${guide}).`,
      );
  }
  for (const value of inModule)
    if (typeof value === "string" && !driverNames.some((name) => value === `${scope}/${name}`))
      failures.push(
        `${tablePath} has ${value} in the values of driver-in-module, but it is not a driver in driverShapes of tools/scripts/src/checks/repo-policy/drivers.ts (docs/adr/0054, ${guide}).`,
      );
  return failures;
}
