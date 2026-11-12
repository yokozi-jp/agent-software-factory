// Checks of the layout of the modules and of the drivers (docs/adr/0054, docs/domain-model/package-layout.md).
// A driver is a shared package that touches an external system and holds no business rule: db, hr-system, i18n,
// logging and telemetry. It has the tag type:driver (roles.ts), and an entry in drivers.json (the root of the repository).
// Each has the layers domain/ and infrastructure/ (and testing/ for the tools of its tests), and the files named by its
// `exports` are the only ones in src/ that are not in a directory; those files only re-export. The libraries a layer
// may import, and the direction between the layers, are lint rules (vite.config.ts); this file checks what a lint
// rule cannot see: which names a package and its src/ may hold, what an entry file contains, and that a driver does
// not depend on Effect.
import { namesWithRole, roleOf, tagOf } from "./roles.ts";
import { Tree, isRecord, list, record } from "./tree.ts";

const guide = "docs/domain-model/package-layout.md";

// The drivers are named in drivers.json only. vite.config.ts imports it for the lint overrides of the drivers, modules.ts
// reads the exports from it, and the checks below read the rest; the values of `driver-in-module` of lint-restrictions.json
// are the one other place that names them (the table asks a fixture for each value), and driversAreInLint compares the two.
// The fields of an entry:
//   runtime            "node" for a driver that runs on Node.js (db, logging, telemetry): its infrastructure/ and testing/
//                      leave the runtime restrictions of docs/adr/0007 and import their own libraries. "web" for one that
//                      runs where the apps do (hr-system, i18n): its infrastructure/ keeps the restrictions of the modules.
//   tools              names at the root of the package that a tool decides (migrations/ of dbmate, openapi.yaml, the stubs of
//                      the fake): they stay where the tool looks for them, and are listed here (rule C5).
//   places             names in src/ that a tool decides (locales/ of i18next-cli).
//   rootMay            the layers that the entry `.` may re-export. Other entries are fixed: `./testing` re-exports testing/, and
//                      the rest re-export infrastructure/ and domain/. `.` re-exports domain/ only, because it is the entry that any
//                      code imports and it must not pull in an external library (docs/adr/0051). i18n is the exception: it is a thin
//                      wrapper that web alone uses (docs/adr/0054, docs/adr/0044).
//   exports            the `exports` of its package.json, when it is not `{".": "./src/index.ts"}`; `exportsReason` is what the
//                      failure says about it (modules.ts).
//   extraNodeFiles     "node" only: files besides infrastructure/ and testing/ that get the same relaxation (a fixture that
//                      shows the lint rule still stops what the driver may not do).
//   workspaceTypesOnly "node" only: the driver imports the packages of the workspace as types only (db, docs/adr/0038).
type Runtime = "node" | "web";

export interface Driver {
  readonly runtime: Runtime;
  readonly tools: readonly string[];
  readonly places: readonly string[];
  readonly rootMay: readonly string[];
  readonly exports?: Readonly<Record<string, string>>;
  readonly exportsReason?: string;
  readonly extraNodeFiles: readonly string[];
  readonly workspaceTypesOnly: boolean;
}

const driversPath = "drivers.json";
const runtimes: readonly Runtime[] = ["node", "web"];
const nodeOnly = ["extraNodeFiles", "workspaceTypesOnly"];
const fields = ["runtime", "tools", "places", "rootMay", "exports", "exportsReason", ...nodeOnly];

const strings = (value: unknown): string[] | undefined => {
  const items = list(value);
  const texts = items.filter((item): item is string => typeof item === "string");
  return Array.isArray(value) && texts.length === items.length ? texts : undefined;
};

const stringMap = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  const texts = entries.filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return texts.length === entries.length ? Object.fromEntries(texts) : undefined;
};

// An entry of drivers.json read as a Driver, and what is wrong with it. An entry with a problem is not read, so the checks
// say that the driver has no entry, and driversFileIsWellFormed says why.
function parseDriver(value: unknown): { driver?: Driver; problems: string[] } {
  if (!isRecord(value)) return { problems: ["is not an object"] };
  const problems: string[] = [];
  for (const key of Object.keys(value).filter((key) => !fields.includes(key)))
    problems.push(`has the field ${key}, which is none of ${fields.join(", ")}`);
  const runtime = runtimes.find((candidate) => candidate === value.runtime);
  if (runtime === undefined)
    problems.push('needs "runtime": "node" or "web", where the driver runs');
  const listOf = (key: string): string[] => {
    if (value[key] === undefined) return [];
    const items = strings(value[key]);
    if (items === undefined) problems.push(`has ${key}, which is not a list of text`);
    return items ?? [];
  };
  const exports = value.exports === undefined ? undefined : stringMap(value.exports);
  if (value.exports !== undefined && exports === undefined)
    problems.push("has exports, which is not an object of text");
  const reason = value.exportsReason;
  if ((value.exports === undefined) !== (reason === undefined))
    problems.push(
      "needs exports and exportsReason together: the reason is what a wrong exports is told",
    );
  else if (reason !== undefined && (typeof reason !== "string" || reason.trim() === ""))
    problems.push("has exportsReason, which is not text");
  if (runtime !== "node")
    for (const key of nodeOnly.filter((key) => value[key] !== undefined))
      problems.push(`has ${key}, which only a driver with "runtime": "node" has`);
  if (value.workspaceTypesOnly !== undefined && typeof value.workspaceTypesOnly !== "boolean")
    problems.push("has workspaceTypesOnly, which is not true or false");
  const tools = listOf("tools");
  const places = listOf("places");
  const rootMay = value.rootMay === undefined ? ["domain"] : listOf("rootMay");
  const extraNodeFiles = listOf("extraNodeFiles");
  if (problems.length > 0 || runtime === undefined) return { problems };
  return {
    problems,
    driver: {
      runtime,
      tools,
      places,
      rootMay,
      ...(exports === undefined || typeof reason !== "string"
        ? {}
        : { exports, exportsReason: reason }),
      extraNodeFiles,
      workspaceTypesOnly: value.workspaceTypesOnly === true,
    },
  };
}

// The drivers of drivers.json, by name, that are well formed. A tree with no drivers.json has none.
export function readDrivers(tree: Tree): ReadonlyMap<string, Driver> {
  const drivers = new Map<string, Driver>();
  for (const [name, entry] of Object.entries(record(tree.parsed(driversPath)))) {
    const { driver } = parseDriver(entry);
    if (driver !== undefined) drivers.set(name, driver);
  }
  return drivers;
}

// A name in drivers.json whose entry cannot be read. The check of its exports (modules.ts) leaves it alone: it would compare
// the package against `.` only, and add a failure to the one that driversFileIsWellFormed gives with the reason.
export const isBrokenDriver = (tree: Tree, name: string): boolean =>
  name in record(tree.parsed(driversPath)) && !readDrivers(tree).has(name);

// Every entry of drivers.json is an object with a runtime and the fields above, and no other. A misspelled field or a runtime
// that is neither node nor web would otherwise leave the driver out of a rule without a word, so it fails here.
export function driversFileIsWellFormed(tree: Tree): string[] {
  const parsed = tree.parsed(driversPath);
  if (tree.maybe(driversPath) === undefined || parsed === undefined) return [];
  if (!isRecord(parsed))
    return [
      `${driversPath} must be an object with an entry for each driver, by name (docs/adr/0054, ${guide}, docs/domain-model/add-package.md).`,
    ];
  return Object.entries(parsed).flatMap(([name, entry]) =>
    parseDriver(entry).problems.map(
      (problem) =>
        `${driversPath}: the entry ${name} ${problem} (docs/adr/0054, ${guide}, docs/domain-model/add-package.md).`,
    ),
  );
}

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

// The tag type:driver and the entry in drivers.json go together. A driver with the tag and no entry is under none of the
// rules below (they walk drivers.json), so nothing would check its layout, its entries or that it does not use Effect. An
// entry for a package with the tag of another role would check a package that is not a driver. A package with no role is
// refused by packagesHaveOneRole.
export function driversAreTagged(tree: Tree): string[] {
  const failures: string[] = [];
  const drivers = readDrivers(tree);
  for (const name of namesWithRole(tree, "driver"))
    if (!drivers.has(name))
      failures.push(
        `packages/${name} has the tag type:driver, but ${driversPath} has no entry for ${name}, so nothing checks its layout, its entries or that it does not depend on Effect. Add the entry (docs/adr/0054, ${guide}, docs/domain-model/add-package.md).`,
      );
  for (const name of drivers.keys()) {
    const role = roleOf(tree, name);
    if (isDriver(tree, name) && role !== undefined && role !== "driver")
      failures.push(
        `packages/${name} has an entry in ${driversPath}, but its tag is ${tagOf(role)}, not type:driver. A driver has the tag type:driver; take the entry out if it is not one (docs/adr/0054, ${guide}).`,
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
  for (const [name, { tools, places }] of readDrivers(tree)) {
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
        `${root}${top.name}${top.inDirectory ? "/" : ""} is not in the root of the driver ${name}. The root holds ${[...standardFiles, "src", ...tools].join(", ")}; a file that a tool looks for is added to the tools of ${name} in ${driversPath} (docs/adr/0054, ${guide}).`,
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
  for (const [name, { rootMay }] of readDrivers(tree)) {
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
  return [...readDrivers(tree).keys()].flatMap((name) => {
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

// The drivers are named in drivers.json, and a driver left out of the table of lint restrictions is not under its rules: the
// `driver-in-module` values (the application and http of a module may not import it) and the fixture of `driver-effect` (the
// lint rule that keeps Effect out reaches its infrastructure/). The table needs the names itself, because it asks a fixture for
// each value (docs/adr/0050), so the two are compared and not derived from one another. A name in the table that is no driver
// is refused too.
const scope = "@agent-software-factory";
const tablePath = "lint-restrictions.json";

// Which drivers a restriction is asked of: `node` for those that run on Node.js, `all` for every driver.
export type DriverKind = Runtime | "all";

// The drivers of the repository, those of drivers.json that have a package. With "node", only those whose runtime is node: they
// run on Node.js, and their infrastructure/ imports their own libraries.
export function driversOf(tree: Tree, kind: DriverKind): string[] {
  return [...readDrivers(tree)]
    .filter(([name, { runtime }]) => isDriver(tree, name) && (kind === "all" || runtime === "node"))
    .map(([name]) => name);
}

export function driversAreInLint(tree: Tree): string[] {
  const failures: string[] = [];
  const table = record(tree.parsed(tablePath));
  const inModule = list(record(table["driver-in-module"]).values);
  const effectFiles = list(record(table["driver-effect"]).rows).flatMap((row) =>
    list(record(row).files),
  );
  const drivers = readDrivers(tree);
  for (const name of drivers.keys()) {
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
  }
  for (const value of inModule)
    if (
      typeof value === "string" &&
      ![...drivers.keys()].some((name) => value === `${scope}/${name}`)
    )
      failures.push(
        `${tablePath} has ${value} in the values of driver-in-module, but it is not a driver in ${driversPath} (docs/adr/0054, ${guide}).`,
      );
  return failures;
}
