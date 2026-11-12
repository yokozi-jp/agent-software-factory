// The checks of the layout of the drivers and of the modules (./drivers.ts, docs/adr/0054), each called alone on a
// small repository held in memory: a case breaks one file of a repository that passes, and expects the message that
// names the problem.
import { describe, expect, it } from "vite-plus/test";
import { failuresOf, json, repo } from "./fixtures/repo.ts";
import {
  driverEntriesOnlyReexport,
  driversAreInLint,
  driversAreTagged,
  driversDoNotUseEffect,
  driversHaveTheirLayout,
} from "./drivers.ts";

const guide = "docs/domain-model/package-layout.md";

// The files of a driver that passes: the package.json with its exports, an entry file for each, and a file in the layers.
const driver = (
  name: string,
  exports: Record<string, unknown>,
  files: Record<string, string> = {},
  fields: Record<string, unknown> = {},
): Record<string, string> => ({
  [`packages/${name}/package.json`]: json({
    name: `@agent-software-factory/${name}`,
    exports,
    ...fields,
  }),
  [`packages/${name}/tsconfig.json`]: "{}",
  [`packages/${name}/vite.config.ts`]: "export default {};\n",
  ...Object.fromEntries(
    Object.entries(files).map(([path, text]) => [`packages/${name}/${path}`, text]),
  ),
});

const logging = (files: Record<string, string> = {}, fields: Record<string, unknown> = {}) =>
  driver(
    "logging",
    { ".": "./src/index.ts", "./node": "./src/node.ts", "./testing": "./src/testing.ts" },
    {
      "src/index.ts": 'export * from "./domain/logger.ts";\n',
      "src/node.ts": 'export * from "./infrastructure/node-logger.ts";\n',
      "src/testing.ts": 'export * from "./testing/memory-destination.ts";\n',
      "src/domain/logger.ts": "export {};\n",
      "src/infrastructure/node-logger.ts": "export {};\n",
      "src/testing/memory-destination.ts": "export {};\n",
      "src/__fixtures__/start-failure.ts": "export {};\n",
      ...files,
    },
    fields,
  );

describe("ADR 0054: a driver holds its layers, its entries and the places of its tools, and nothing else", () => {
  const violations = failuresOf(driversHaveTheirLayout);

  it("passes a driver with entries, domain/, infrastructure/, testing/ and __fixtures__/", () => {
    expect(violations(repo(logging()))).toEqual([]);
  });

  it("leaves a repository without drivers alone", () => {
    expect(violations(repo())).toEqual([]);
  });

  it.each(["application", "http"])(
    "refuses src/%s/ in a driver: it is a layer of a module",
    (layer) => {
      expect(violations(repo(logging({ [`src/${layer}/x.ts`]: "export {};\n" })))).toEqual([
        `packages/logging/src/${layer}/ is a layer of a module. The driver logging has domain/ and infrastructure/ only: it has no use case or route of its own, so put its code in infrastructure/ (docs/adr/0054, ${guide}).`,
      ]);
    },
  );

  it("refuses a directory of src/ that is not a place of the driver, once for all its files", () => {
    expect(
      violations(repo(logging({ "src/helpers/a.ts": "export {};\n", "src/helpers/b.ts": "x" }))),
    ).toEqual([
      `packages/logging/src/helpers/ is not a place of the driver logging. src/ holds domain, infrastructure, testing, __fixtures__: move the code into one of them (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("refuses a file in src/ that its exports do not name", () => {
    expect(violations(repo(logging({ "src/util.ts": "export {};\n" })))).toEqual([
      `packages/logging/src/util.ts is not an entry of the driver logging. The files in src/ outside a directory are the ones that its exports name (index.ts, node.ts, testing.ts), and they only re-export: move the code into domain/, infrastructure/ or testing/ (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("refuses a name at the root that no tool decides", () => {
    expect(
      violations(repo(logging({ "scripts/run.ts": "export {};\n", "NOTES.md": "x" }))),
    ).toEqual([
      `packages/logging/NOTES.md is not in the root of the driver logging. The root holds package.json, tsconfig.json, vite.config.ts, src; a file that a tool looks for is added to the tools of logging in driverShapes of tools/scripts/src/checks/repo-policy/drivers.ts (docs/adr/0054, ${guide}).`,
      `packages/logging/scripts/ is not in the root of the driver logging. The root holds package.json, tsconfig.json, vite.config.ts, src; a file that a tool looks for is added to the tools of logging in driverShapes of tools/scripts/src/checks/repo-policy/drivers.ts (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("passes the places that a tool decides: the migrations of db, and the locales of i18n", () => {
    const db = driver(
      "db",
      { "./node": "./src/node.ts" },
      {
        "src/node.ts": 'export * from "./infrastructure/pool.ts";\n',
        "src/infrastructure/pool.ts": "export {};\n",
        "migrations/1.sql": "select 1;\n",
        "bootstrap.sql": "select 1;\n",
        "templates/t.sql": "select 1;\n",
        "test/global-setup.ts": "export {};\n",
      },
    );
    const i18n = driver(
      "i18n",
      { ".": "./src/index.ts" },
      {
        "src/index.ts": 'export * from "./infrastructure/i18n.ts";\n',
        "src/infrastructure/i18n.ts": "export {};\n",
        "src/locales/ja/translation.json": "{}",
        "i18next.config.ts": "export default {};\n",
        "test/keys.test.ts": "export {};\n",
      },
    );
    const hr = driver(
      "hr-system",
      { ".": "./src/index.ts" },
      {
        "src/index.ts": 'export type { Employee } from "./domain/employee.ts";\n',
        "openapi.yaml": "openapi: 3.1.0\n",
        "fake/mappings/a.json": "{}",
        "test/fake.test.ts": "export {};\n",
      },
    );
    expect(violations(repo({ ...db, ...i18n, ...hr }))).toEqual([]);
  });

  it("leaves the files under the name of a driver alone when it has no package.json", () => {
    expect(
      violations(repo({ "packages/logging/NOTES.md": "x", "packages/db/src/a.ts": "x" })),
    ).toEqual([]);
  });

  it("does not stop at a file that is named src", () => {
    expect(violations(repo({ ...logging(), "packages/logging/src": "x" }))).toEqual([]);
  });

  it("reports a name at the root once, whatever the number of its files", () => {
    expect(
      violations(repo(logging({ "scripts/a.ts": "x", "scripts/b.ts": "x", "scripts/c.ts": "x" }))),
    ).toHaveLength(1);
  });

  it("refuses the locales of i18n in a driver that has no such place", () => {
    expect(violations(repo(logging({ "src/locales/ja/translation.json": "{}" })))).toEqual([
      `packages/logging/src/locales/ is not a place of the driver logging. src/ holds domain, infrastructure, testing, __fixtures__: move the code into one of them (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("counts as an entry only an export that names a file directly in src/", () => {
    const odd = driver(
      "telemetry",
      {
        ".": "./src/index.ts",
        "./a": "./lib/a.js",
        "./b": "./src/deep/b.ts",
        "./c": 1,
        // An array is a list of fallbacks, not a path. Text of the array would read as "./src/array.ts".
        "./d": ["./src/array.ts"],
        // The path has to start with ./src/.
        "./e": "../src/outside.ts",
      },
      {
        "src/index.ts": 'export * from "./domain/url.ts";\n',
        "src/lib.ts": "export {};\n",
        "src/array.ts": "export {};\n",
        "src/outside.ts": "export {};\n",
      },
    );
    const named =
      "The files in src/ outside a directory are the ones that its exports name (index.ts)";
    const rest = "and they only re-export: move the code into domain/, infrastructure/ or testing/";
    expect(violations(repo(odd))).toEqual([
      `packages/telemetry/src/array.ts is not an entry of the driver telemetry. ${named}, ${rest} (docs/adr/0054, ${guide}).`,
      `packages/telemetry/src/lib.ts is not an entry of the driver telemetry. ${named}, ${rest} (docs/adr/0054, ${guide}).`,
      `packages/telemetry/src/outside.ts is not an entry of the driver telemetry. ${named}, ${rest} (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("takes the entries from the exports, so a driver with an entry file of another name passes", () => {
    const hr = driver(
      "hr-system",
      { ".": "./src/index.ts", "./client": "./src/client.ts" },
      {
        "src/index.ts": 'export type { Employee } from "./domain/employee.ts";\n',
        "src/client.ts": 'export { createHrSystemClient } from "./infrastructure/client.ts";\n',
        "src/domain/employee.ts": "export {};\n",
        "src/infrastructure/client.ts": "export {};\n",
        "openapi.yaml": "openapi: 3.1.0\n",
        "fake/mappings/a.json": "{}",
      },
    );
    expect(violations(repo(hr))).toEqual([]);
  });
});

describe("ADR 0054: an entry file of a driver only re-exports, from the places its entry may use", () => {
  const violations = failuresOf(driverEntriesOnlyReexport);
  const may = {
    index: "domain/",
    node: "domain/ and infrastructure/",
    testing: "testing/",
  };

  it("passes the entries of a driver that re-export their layers, with comments and several statements", () => {
    expect(
      violations(
        repo(
          logging({
            "src/index.ts":
              '// the entry `.`\n/* a block\n comment */\nexport type { A } from "./domain/logger.ts";\nexport { b, type C } from "./domain/logger.ts";\n',
            "src/node.ts":
              'export * from "./infrastructure/node-logger.ts";\nexport * from "./domain/logger.ts";\n',
          }),
        ),
      ),
    ).toEqual([]);
  });

  const notReexport = (statement: string) =>
    `has \`${statement}\`. An entry file only re-exports (\`export … from "./<layer>/…"\`)`;
  it.each([
    ["a constant", "export const x = 1;\n", notReexport("export const x = 1")],
    ["a function", "export function f() {}\n", notReexport("export function f() {}")],
    [
      "an import",
      'import { a } from "./domain/logger.ts";\n',
      notReexport('import { a } from "./domain/logger.ts"'),
    ],
    ["a re-export of a package", 'export * from "pino";\n', 're-exports "pino"'],
  ])("refuses an entry file with %s", (_, text, message) => {
    const failures = violations(repo(logging({ "src/index.ts": text })));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(`packages/logging/src/index.ts ${message}`);
  });

  it("refuses the entry `.` that re-exports infrastructure/: it must not pull in an external library", () => {
    expect(
      violations(
        repo(logging({ "src/index.ts": 'export * from "./infrastructure/node-logger.ts";\n' })),
      ),
    ).toEqual([
      `packages/logging/src/index.ts re-exports "./infrastructure/node-logger.ts", but the entry . of logging re-exports ${may.index} only: the entry that any code imports does not pull in an external library (docs/adr/0051) (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("allows i18n to re-export infrastructure/ from `.`, and a type import that carries an augmentation", () => {
    const i18n = driver(
      "i18n",
      { ".": "./src/index.ts" },
      {
        "src/index.ts":
          'import type {} from "./infrastructure/i18next-types.ts";\n\nexport { createI18n } from "./infrastructure/i18n.ts";\nexport { languages } from "./domain/language.ts";\n',
      },
    );
    expect(violations(repo(i18n))).toEqual([]);
  });

  it("refuses ./testing that re-exports domain/, and ./node that re-exports testing/", () => {
    expect(
      violations(
        repo(
          logging({
            "src/testing.ts": 'export * from "./domain/logger.ts";\n',
            "src/node.ts": 'export * from "./testing/memory-destination.ts";\n',
          }),
        ),
      ),
    ).toEqual([
      `packages/logging/src/node.ts re-exports "./testing/memory-destination.ts", but the entry ./node of logging re-exports ${may.node} only (docs/adr/0054, ${guide}).`,
      `packages/logging/src/testing.ts re-exports "./domain/logger.ts", but the entry ./testing of logging re-exports ${may.testing} only (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("reads a re-export however it is spaced and quoted", () => {
    expect(
      violations(
        repo(
          logging({
            "src/index.ts": [
              "export  *  from  './domain/logger.ts'",
              'export   type   {  A  }   from   "./domain/logger.ts"',
              'export\n{\n  b,\n}\nfrom\n"./domain/logger.ts"',
              'import   type   {  }   from   "./domain/logger.ts"',
              'import type{}  from"./domain/logger.ts"',
              "",
            ].join(";\n"),
          }),
        ),
      ),
    ).toEqual([]);
  });

  it("takes a line comment after a statement for a comment, not for code", () => {
    expect(
      violations(
        repo(
          logging({
            "src/index.ts":
              'export * from "./domain/logger.ts"; // the logger\n  // an indented comment\nexport { b } from "./domain/logger.ts"; // last\n',
          }),
        ),
      ),
    ).toEqual([]);
  });

  it.each([
    ["code before the export", 'x export * from "./domain/logger.ts"'],
    ["code after the path", 'export * from "./domain/logger.ts" as x'],
    ["a name list that is not a re-export of everything", 'export a from "./domain/logger.ts"'],
    ["an import with names", 'import type {a} from "./domain/logger.ts"'],
    ["an import that is not a type import", 'import {} from "./domain/logger.ts"'],
    ["a path that leaves the entry's folder", 'export * from "../domain/logger.ts"'],
    ["a path that is not in a layer folder", 'export * from "./logger.ts"'],
  ])("refuses %s", (_, text) => {
    expect(violations(repo(logging({ "src/index.ts": `${text};\n` })))).toHaveLength(1);
  });

  it("says what is in the entry file and where the code goes, for each entry", () => {
    const body = (statement: string, layers: string) =>
      `has \`${statement}\`. An entry file only re-exports (\`export … from "./<layer>/…"\`): put the code in ${layers} (docs/adr/0054, ${guide}).`;
    expect(
      violations(
        repo(
          logging({
            "src/index.ts": "export  const\n  x  =  1;\n",
            "src/node.ts": "export const y = 2;\n",
            "src/testing.ts": "export const z = 3;\n",
          }),
        ),
      ),
    ).toEqual([
      `packages/logging/src/index.ts ${body("export const x = 1", "domain/")}`,
      `packages/logging/src/node.ts ${body("export const y = 2", "domain/ or infrastructure/")}`,
      `packages/logging/src/testing.ts ${body("export const z = 3", "testing/")}`,
    ]);
  });

  it("skips an entry file that the tree does not have (the exports check reports it)", () => {
    expect(violations(repo({ ...logging(), "packages/logging/src/node.ts": undefined }))).toEqual(
      [],
    );
  });
});

describe("ADR 0054: a driver does not depend on Effect", () => {
  const violations = failuresOf(driversDoNotUseEffect);

  it("passes a driver without effect", () => {
    expect(violations(repo(logging({}, { dependencies: { pino: "catalog:" } })))).toEqual([]);
  });

  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "refuses effect and @effect/* in %s",
    (field) => {
      expect(
        violations(
          repo(
            logging(
              {},
              {
                [field]: {
                  effect: "catalog:",
                  "@effect/platform-node": "catalog:",
                  pino: "catalog:",
                },
              },
            ),
          ),
        ),
      ).toEqual([
        `packages/logging/package.json has effect in ${field}. A driver returns a Promise and does not depend on Effect: the infrastructure of the module wraps it with Effect.tryPromise (docs/adr/0054).`,
        `packages/logging/package.json has @effect/platform-node in ${field}. A driver returns a Promise and does not depend on Effect: the infrastructure of the module wraps it with Effect.tryPromise (docs/adr/0054).`,
      ]);
    },
  );

  it("leaves a package that is not a driver alone", () => {
    expect(
      violations(
        repo({
          "packages/claim/package.json": json({ dependencies: { effect: "catalog:" } }),
        }),
      ),
    ).toEqual([]);
  });
});

describe("ADR 0054: the drivers are in the table of lint restrictions and in vite.config.ts", () => {
  const violations = failuresOf(driversAreInLint);
  const table = (values: string[], effectFiles: string[]) =>
    json({
      "driver-in-module": { values, rows: [] },
      "driver-effect": { values: ["effect"], rows: [{ files: effectFiles }] },
    });
  const effectFixture = (name: string) =>
    `packages/${name}/src/infrastructure/__fixtures__/driver-effect.ts`;
  const vite = (node: string, web: string) =>
    `const nodeDrivers = {\n  ${node}: {\n    nodeFiles: [],\n  },\n};\nconst webDrivers = [${web}];\n`;
  const complete = {
    "lint-restrictions.json": table(
      ["@agent-software-factory/logging"],
      [effectFixture("logging")],
    ),
    "vite.config.ts": vite("logging", ""),
  };

  it("passes a driver that is in the table, has its fixture, and is named in vite.config.ts", () => {
    expect(violations(repo({ ...logging(), ...complete }))).toEqual([]);
    expect(
      violations(repo({ ...logging(), ...complete, "vite.config.ts": vite("db", '"logging"') })),
    ).toEqual([]);
  });

  it("refuses a driver that the table, the fixture rows and vite.config.ts do not name", () => {
    expect(
      violations(
        repo({
          ...logging(),
          "lint-restrictions.json": table([], []),
          "vite.config.ts": vite("db", '"i18n"'),
        }),
      ),
    ).toEqual([
      `lint-restrictions.json does not have @agent-software-factory/logging in the values of driver-in-module. The application and http of a module may import the driver logging until it is there: add it, with its rows in the fixtures of packages/module-fixtures (docs/adr/0054, ${guide}).`,
      `lint-restrictions.json does not have packages/logging/src/infrastructure/__fixtures__/driver-effect.ts in the rows of driver-effect. Add the fixture that shows the lint rule stops \`effect\` in logging, and its rows (docs/adr/0054, ${guide}).`,
      `vite.config.ts names the driver logging in neither nodeDrivers nor webDrivers, so the rules of the drivers do not reach its infrastructure/. Add it to the one that fits where it runs (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("refuses a value of driver-in-module that is no driver, even when the tree has no driver", () => {
    expect(
      violations(
        repo({
          "lint-restrictions.json": table(["@agent-software-factory/claim"], []),
        }),
      ),
    ).toEqual([
      `lint-restrictions.json has @agent-software-factory/claim in the values of driver-in-module, but it is not a driver in driverShapes of tools/scripts/src/checks/repo-policy/drivers.ts (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("looks for the driver in nodeDrivers only, up to the end of its declaration", () => {
    const other = "const other = {\n  logging: {\n  },\n};\n";
    const failure = `vite.config.ts names the driver logging in neither nodeDrivers nor webDrivers, so the rules of the drivers do not reach its infrastructure/. Add it to the one that fits where it runs (docs/adr/0054, ${guide}).`;
    // Declared before and after nodeDrivers, and not in webDrivers.
    expect(
      violations(repo({ ...logging(), ...complete, "vite.config.ts": other + vite("db", "") })),
    ).toEqual([failure]);
    expect(
      violations(repo({ ...logging(), ...complete, "vite.config.ts": vite("db", "") + other })),
    ).toEqual([failure]);
  });

  it("reads a declaration that has no end as running to the end of the file", () => {
    const source = (text: string) => ({ ...logging(), ...complete, "vite.config.ts": text });
    expect(violations(repo(source("const nodeDrivers = {\n  logging: {")))).toEqual([]);
  });

  it("does not take a value of driver-in-module that is not text for a driver name", () => {
    expect(
      violations(
        repo({
          "lint-restrictions.json": json({
            "driver-in-module": { values: [1, null], rows: [] },
            "driver-effect": { values: ["effect"], rows: [] },
          }),
        }),
      ),
    ).toEqual([]);
  });

  it("finds nothing to say when vite.config.ts has neither list", () => {
    expect(
      violations(repo({ ...logging(), ...complete, "vite.config.ts": "export default {};\n" })),
    ).toEqual([
      `vite.config.ts names the driver logging in neither nodeDrivers nor webDrivers, so the rules of the drivers do not reach its infrastructure/. Add it to the one that fits where it runs (docs/adr/0054, ${guide}).`,
    ]);
  });
});

describe("ADR 0054: the tag type:driver and the entry in driverShapes go together", () => {
  const violations = failuresOf(driversAreTagged);
  const entry = "driverShapes of tools/scripts/src/checks/repo-policy/drivers.ts";
  const tagged = (role: string) => ({ nx: { name: "logging", tags: [`type:${role}`] } });

  it("passes a driver with the tag and an entry, and a repository without drivers", () => {
    expect(violations(repo(logging({}, tagged("driver"))))).toEqual([]);
    expect(violations(repo())).toEqual([]);
  });

  it("refuses a package with the tag type:driver that has no entry in driverShapes", () => {
    expect(
      violations(
        repo(
          driver(
            "mail",
            { ".": "./src/index.ts" },
            {},
            { nx: { name: "mail", tags: ["type:driver"] } },
          ),
        ),
      ),
    ).toEqual([
      `packages/mail has the tag type:driver, but ${entry} has no entry for mail, so nothing checks its layout, its entries or that it does not depend on Effect. Add the entry (docs/adr/0054, ${guide}, docs/domain-model/add-package.md).`,
    ]);
  });

  it.each(["module", "fixtures", "shared-kernel", "ui"])(
    "refuses an entry in driverShapes for a package with the tag type:%s",
    (role) => {
      expect(violations(repo(logging({}, tagged(role))))).toEqual([
        `packages/logging has an entry in ${entry}, but its tag is type:${role}, not type:driver. A driver has the tag type:driver; take the entry out if it is not one (docs/adr/0054, ${guide}).`,
      ]);
    },
  );

  it("leaves a package with no role, or with two, to packagesHaveOneRole", () => {
    expect(violations(repo(logging()))).toEqual([]);
    expect(
      violations(repo(logging({}, { nx: { name: "logging", tags: ["type:driver", "type:ui"] } }))),
    ).toEqual([]);
  });

  it("does not ask for a package of driverShapes that the repository does not have", () => {
    expect(violations(repo({ "packages/logging/NOTES.md": "x" }))).toEqual([]);
  });
});
