// The checks of the layout of the drivers and of the modules (./drivers.ts, docs/adr/0054), each called alone on a
// small repository held in memory: a case breaks one file of a repository that passes, and expects the message that
// names the problem.
import { describe, expect, it } from "vite-plus/test";
import { failuresOf, json, repo } from "./fixtures/repo.ts";
import {
  driverEntriesOnlyReexport,
  driversDoNotUseEffect,
  driversHaveTheirLayout,
  modulesHaveOnlyLayers,
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
    expect(violations(repo({ ...db, ...i18n }))).toEqual([]);
  });

  it("refuses the locales of i18n in a driver that has no such place", () => {
    expect(violations(repo(logging({ "src/locales/ja/translation.json": "{}" })))).toEqual([
      `packages/logging/src/locales/ is not a place of the driver logging. src/ holds domain, infrastructure, testing, __fixtures__: move the code into one of them (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("counts as an entry only an export that names a file directly in src/", () => {
    const odd = driver(
      "telemetry",
      { ".": "./src/index.ts", "./a": "./lib/a.js", "./b": "./src/deep/b.ts", "./c": 1 },
      { "src/index.ts": 'export * from "./domain/url.ts";\n', "src/lib.ts": "export {};\n" },
    );
    expect(violations(repo(odd))).toEqual([
      `packages/telemetry/src/lib.ts is not an entry of the driver telemetry. The files in src/ outside a directory are the ones that its exports name (index.ts), and they only re-export: move the code into domain/, infrastructure/ or testing/ (docs/adr/0054, ${guide}).`,
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

describe("ADR 0054: the src/ of a module holds index.ts, the layers and __fixtures__/", () => {
  const violations = (files: Record<string, string>): string[] =>
    failuresOf((tree) => modulesHaveOnlyLayers(tree, ["claim"]))(repo(files));

  const claim = {
    "packages/claim/src/index.ts": "export {};\n",
    "packages/claim/src/domain/a.ts": "export {};\n",
    "packages/claim/src/application/a.ts": "export {};\n",
    "packages/claim/src/infrastructure/a.ts": "export {};\n",
    "packages/claim/src/http/a.ts": "export {};\n",
    "packages/claim/src/__fixtures__/a.ts": "export {};\n",
  };

  it("passes a module with its layers", () => {
    expect(violations(claim)).toEqual([]);
  });

  it("refuses a file outside a layer, and a directory that is not a layer, once for each", () => {
    expect(
      violations({
        ...claim,
        "packages/claim/src/get-claim.ts": "export {};\n",
        "packages/claim/src/utils/a.ts": "export {};\n",
        "packages/claim/src/utils/b.ts": "export {};\n",
      }),
    ).toEqual([
      "packages/claim/src/get-claim.ts is not a layer of a module. src/ holds index.ts, domain/, application/, infrastructure/, http/ and __fixtures__/: a file outside a layer is not under the rules of the layers, so move it into one (docs/adr/0054, " +
        guide +
        ").",
      "packages/claim/src/utils/ is not a layer of a module. src/ holds index.ts, domain/, application/, infrastructure/, http/ and __fixtures__/: a file outside a layer is not under the rules of the layers, so move it into one (docs/adr/0054, " +
        guide +
        ").",
    ]);
  });

  it("leaves other packages alone", () => {
    expect(violations({ ...claim, "packages/other/src/x.ts": "export {};\n" })).toEqual([]);
  });
});
