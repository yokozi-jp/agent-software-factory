// The checks of the layout of the drivers and of the modules (./drivers.ts, docs/adr/0054), each called alone on a
// small repository held in memory: a case breaks one file of a repository that passes, and expects the message that
// names the problem.
import { describe, expect, it } from "vite-plus/test";
import { failuresOf, json, repo } from "./fixtures/repo.ts";
import { Tree } from "./tree.ts";
import {
  driverEntriesOnlyReexport,
  driversAreInLint,
  driversAreTagged,
  driversDoNotUseEffect,
  driversFileIsWellFormed,
  driversHaveTheirLayout,
  driversOf,
  readDrivers,
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

describe("ADR 0054: driver は、層、入口、道具の置き場所だけを持つこと", () => {
  const violations = failuresOf(driversHaveTheirLayout);

  it("入口、domain/、infrastructure/、testing/、__fixtures__/ を持つ driver を通すこと", () => {
    expect(violations(repo(logging()))).toEqual([]);
  });

  it("driver のないリポジトリを放っておくこと", () => {
    expect(violations(repo())).toEqual([]);
  });

  it.each(["application", "http"])(
    "driver の src/%s/ を拒否すること: それはモジュールの層である",
    (layer) => {
      expect(violations(repo(logging({ [`src/${layer}/x.ts`]: "export {};\n" })))).toEqual([
        `packages/logging/src/${layer}/ is a layer of a module. The driver logging has domain/ and infrastructure/ only: it has no use case or route of its own, so put its code in infrastructure/ (docs/adr/0054, ${guide}).`,
      ]);
    },
  );

  it("driver の置き場所ではない src/ のディレクトリを、すべてのファイルについて 1 回だけ拒否すること", () => {
    expect(
      violations(repo(logging({ "src/helpers/a.ts": "export {};\n", "src/helpers/b.ts": "x" }))),
    ).toEqual([
      `packages/logging/src/helpers/ is not a place of the driver logging. src/ holds domain, infrastructure, testing, __fixtures__: move the code into one of them (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("exports が名指さない src/ のファイルを拒否すること", () => {
    expect(violations(repo(logging({ "src/util.ts": "export {};\n" })))).toEqual([
      `packages/logging/src/util.ts is not an entry of the driver logging. The files in src/ outside a directory are the ones that its exports name (index.ts, node.ts, testing.ts), and they only re-export: move the code into domain/, infrastructure/ or testing/ (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("どの道具も決めないルートの名前を拒否すること", () => {
    expect(
      violations(repo(logging({ "scripts/run.ts": "export {};\n", "NOTES.md": "x" }))),
    ).toEqual([
      `packages/logging/NOTES.md is not in the root of the driver logging. The root holds package.json, tsconfig.json, vite.config.ts, src; a file that a tool looks for is added to the tools of logging in drivers.json (docs/adr/0054, ${guide}).`,
      `packages/logging/scripts/ is not in the root of the driver logging. The root holds package.json, tsconfig.json, vite.config.ts, src; a file that a tool looks for is added to the tools of logging in drivers.json (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("道具が決める場所を通すこと: db の migrations と i18n の locales", () => {
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

  it("package.json のない driver 名の下のファイルを放っておくこと", () => {
    expect(
      violations(repo({ "packages/logging/NOTES.md": "x", "packages/db/src/a.ts": "x" })),
    ).toEqual([]);
  });

  it("src という名前のファイルで止まらないこと", () => {
    expect(violations(repo({ ...logging(), "packages/logging/src": "x" }))).toEqual([]);
  });

  it("ファイル数にかかわらず、ルートの名前を 1 回だけ報告すること", () => {
    expect(
      violations(repo(logging({ "scripts/a.ts": "x", "scripts/b.ts": "x", "scripts/c.ts": "x" }))),
    ).toHaveLength(1);
  });

  it("その置き場所のない driver の i18n の locales を拒否すること", () => {
    expect(violations(repo(logging({ "src/locales/ja/translation.json": "{}" })))).toEqual([
      `packages/logging/src/locales/ is not a place of the driver logging. src/ holds domain, infrastructure, testing, __fixtures__: move the code into one of them (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("src/ 直下のファイルを直接名指す export だけを入口に数えること", () => {
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

  it("入口を exports から採るので、別の名前の入口ファイルを持つ driver を通すこと", () => {
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

describe("ADR 0054: driver の入口ファイルは、入口が使える場所からの再 export だけをすること", () => {
  const violations = failuresOf(driverEntriesOnlyReexport);
  const may = {
    index: "domain/",
    node: "domain/ and infrastructure/",
    testing: "testing/",
  };

  it("コメントと複数の文を持つ、層を再 export する driver の入口を通すこと", () => {
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
  ])("%s のある入口ファイルを拒否すること", (_, text, message) => {
    const failures = violations(repo(logging({ "src/index.ts": text })));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(`packages/logging/src/index.ts ${message}`);
  });

  it("infrastructure/ を再 export する入口 `.` を拒否すること: 外部の library を引き込んではならない", () => {
    expect(
      violations(
        repo(logging({ "src/index.ts": 'export * from "./infrastructure/node-logger.ts";\n' })),
      ),
    ).toEqual([
      `packages/logging/src/index.ts re-exports "./infrastructure/node-logger.ts", but the entry . of logging re-exports ${may.index} only: the entry that any code imports does not pull in an external library (docs/adr/0051) (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("i18n が `.` から infrastructure/ を再 export することと、拡張を運ぶ型の import を許可すること", () => {
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

  it("domain/ を再 export する ./testing と、testing/ を再 export する ./node を拒否すること", () => {
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

  it("空白と引用符の書き方にかかわらず、再 export を読むこと", () => {
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

  it("文の後の行コメントを、コードではなくコメントとして採ること", () => {
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
  ])("%s を拒否すること", (_, text) => {
    expect(violations(repo(logging({ "src/index.ts": `${text};\n` })))).toHaveLength(1);
  });

  it("入口ごとに、入口ファイルに書くものとコードの置き場所を述べること", () => {
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

  it("ツリーにない入口ファイルを読み飛ばすこと (exports の検査が報告する)", () => {
    expect(violations(repo({ ...logging(), "packages/logging/src/node.ts": undefined }))).toEqual(
      [],
    );
  });
});

describe("ADR 0054: driver は Effect に依存しないこと", () => {
  const violations = failuresOf(driversDoNotUseEffect);

  it("effect のない driver を通すこと", () => {
    expect(violations(repo(logging({}, { dependencies: { pino: "catalog:" } })))).toEqual([]);
  });

  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "%s の effect と @effect/* を拒否すること",
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

  it("driver ではない package を放っておくこと", () => {
    expect(
      violations(
        repo({
          "packages/claim/package.json": json({ dependencies: { effect: "catalog:" } }),
        }),
      ),
    ).toEqual([]);
  });
});

describe("ADR 0054: driver が lint の禁止の表にあること", () => {
  const violations = failuresOf(driversAreInLint);
  const table = (values: string[], effectFiles: string[]) =>
    json({
      "driver-in-module": { values, rows: [] },
      "driver-effect": { values: ["effect"], rows: [{ files: effectFiles }] },
    });
  const effectFixture = (name: string) =>
    `packages/${name}/src/infrastructure/__fixtures__/driver-effect.ts`;
  const complete = {
    "lint-restrictions.json": table(
      ["@agent-software-factory/logging"],
      [effectFixture("logging")],
    ),
  };

  it("表にあり、fixture を持つ driver を通すこと", () => {
    expect(violations(repo({ ...logging(), ...complete }))).toEqual([]);
  });

  it("表と fixture の行が名指さない driver を拒否すること", () => {
    expect(violations(repo({ ...logging(), "lint-restrictions.json": table([], []) }))).toEqual([
      `lint-restrictions.json does not have @agent-software-factory/logging in the values of driver-in-module. The application and http of a module may import the driver logging until it is there: add it, with its rows in the fixtures of packages/module-fixtures (docs/adr/0054, ${guide}).`,
      `lint-restrictions.json does not have packages/logging/src/infrastructure/__fixtures__/driver-effect.ts in the rows of driver-effect. Add the fixture that shows the lint rule stops \`effect\` in logging, and its rows (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("package のない driver を、表になくても問わないこと", () => {
    expect(violations(repo({ "lint-restrictions.json": table([], []) }))).toEqual([]);
  });

  it("drivers.json の driver ではない driver-in-module の値を拒否すること", () => {
    expect(
      violations(
        repo({
          "lint-restrictions.json": table(["@agent-software-factory/claim"], []),
        }),
      ),
    ).toEqual([
      `lint-restrictions.json has @agent-software-factory/claim in the values of driver-in-module, but it is not a driver in drivers.json (docs/adr/0054, ${guide}).`,
    ]);
  });

  it("driver 名のテキストではない driver-in-module の値を採らないこと", () => {
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
});

describe("ADR 0054: drivers.json の形", () => {
  const violations = failuresOf(driversFileIsWellFormed);
  const withDrivers = (value: unknown) => repo({ "drivers.json": json(value) });
  const problem = (name: string, text: string) =>
    `drivers.json: the entry ${name} ${text} (docs/adr/0054, ${guide}, docs/domain-model/add-package.md).`;

  it("repository の drivers.json を通すこと", () => {
    expect(violations(repo())).toEqual([]);
  });

  it("drivers.json のない repository を放っておくこと", () => {
    expect(violations(repo({ "drivers.json": undefined }))).toEqual([]);
  });

  it("runtime だけの driver と、node だけの欄を持つ node の driver を通すこと", () => {
    expect(
      violations(
        withDrivers({
          a: { runtime: "web" },
          b: { runtime: "node", extraNodeFiles: ["packages/b/src/x.ts"], workspaceTypesOnly: true },
        }),
      ),
    ).toEqual([]);
  });

  it("オブジェクトではない drivers.json を拒否すること", () => {
    expect(violations(withDrivers([]))).toEqual([
      `drivers.json must be an object with an entry for each driver, by name (docs/adr/0054, ${guide}, docs/domain-model/add-package.md).`,
    ]);
  });

  it("オブジェクトではない entry を拒否すること", () => {
    expect(violations(withDrivers({ a: "node" }))).toEqual([problem("a", "is not an object")]);
  });

  it.each([{}, { runtime: "edge" }, { runtime: 1 }])(
    "node でも web でもない runtime %j を拒否すること",
    (entry) => {
      expect(violations(withDrivers({ a: entry }))).toEqual([
        problem("a", 'needs "runtime": "node" or "web", where the driver runs'),
      ]);
    },
  );

  it("知らない欄を拒否すること: 綴りの間違いで規則が外れない", () => {
    expect(violations(withDrivers({ a: { runtime: "node", tool: ["x"] } }))).toEqual([
      problem(
        "a",
        "has the field tool, which is none of runtime, tools, places, rootMay, exports, exportsReason, extraNodeFiles, workspaceTypesOnly",
      ),
    ]);
  });

  it.each(["tools", "places", "rootMay", "extraNodeFiles"])(
    "文字の一覧ではない %s を拒否すること",
    (field) => {
      for (const wrong of ["x", [1], { a: "b" }])
        expect(violations(withDrivers({ a: { runtime: "node", [field]: wrong } }))).toEqual([
          problem("a", `has ${field}, which is not a list of text`),
        ]);
    },
  );

  it("web の driver の node だけの欄を拒否すること", () => {
    expect(
      violations(
        withDrivers({ a: { runtime: "web", extraNodeFiles: [], workspaceTypesOnly: true } }),
      ),
    ).toEqual([
      problem("a", 'has extraNodeFiles, which only a driver with "runtime": "node" has'),
      problem("a", 'has workspaceTypesOnly, which only a driver with "runtime": "node" has'),
    ]);
  });

  it("真偽値ではない workspaceTypesOnly を拒否すること", () => {
    expect(violations(withDrivers({ a: { runtime: "node", workspaceTypesOnly: "yes" } }))).toEqual([
      problem("a", "has workspaceTypesOnly, which is not true or false"),
    ]);
  });

  it.each([{ ".": 1 }, "./src/index.ts", ["./src/index.ts"]])(
    "文字のオブジェクトではない exports %j を拒否すること",
    (exports) => {
      expect(
        violations(withDrivers({ a: { runtime: "web", exports, exportsReason: "r" } })),
      ).toEqual([problem("a", "has exports, which is not an object of text")]);
    },
  );

  it("exports と exportsReason が片方だけの entry と、文字ではない理由を拒否すること", () => {
    const together =
      "needs exports and exportsReason together: the reason is what a wrong exports is told";
    expect(
      violations(withDrivers({ a: { runtime: "web", exports: { ".": "./src/index.ts" } } })),
    ).toEqual([problem("a", together)]);
    expect(violations(withDrivers({ a: { runtime: "web", exportsReason: "r" } }))).toEqual([
      problem("a", together),
    ]);
    for (const reason of [1, " "])
      expect(
        violations(
          withDrivers({
            a: { runtime: "web", exports: { ".": "./src/index.ts" }, exportsReason: reason },
          }),
        ),
      ).toEqual([problem("a", "has exportsReason, which is not text")]);
  });

  it("entry ごとに、すべての問題を挙げること", () => {
    expect(violations(withDrivers({ a: { tool: 1 }, b: { runtime: "node", tools: "x" } }))).toEqual(
      [
        problem(
          "a",
          "has the field tool, which is none of runtime, tools, places, rootMay, exports, exportsReason, extraNodeFiles, workspaceTypesOnly",
        ),
        problem("a", 'needs "runtime": "node" or "web", where the driver runs'),
        problem("b", "has tools, which is not a list of text"),
      ],
    );
  });
});

describe("ADR 0054: drivers.json を読むこと", () => {
  it("runtime が node の driver だけを、package のあるものから挙げること", () => {
    const files = { ...logging(), "packages/i18n/package.json": "{}" };
    expect(driversOf(new Tree(repo(files)), "node")).toEqual(["logging"]);
    expect(driversOf(new Tree(repo(files)), "all")).toEqual(["i18n", "logging"]);
  });

  it("形に問題のある entry を、driver に数えないこと", () => {
    const files = {
      ...logging(),
      "drivers.json": json({ logging: { runtime: "edge" } }),
    };
    expect(driversOf(new Tree(repo(files)), "all")).toEqual([]);
    expect([...readDrivers(new Tree(repo(files))).keys()]).toEqual([]);
  });

  it("rootMay を省いたとき domain だけにし、書いたときはそのとおりにすること", () => {
    const drivers = readDrivers(
      new Tree(
        repo({
          "drivers.json": json({
            a: { runtime: "web" },
            b: { runtime: "web", rootMay: [] },
            c: { runtime: "web", rootMay: ["infrastructure"] },
          }),
        }),
      ),
    );
    expect(drivers.get("a")?.rootMay).toEqual(["domain"]);
    expect(drivers.get("b")?.rootMay).toEqual([]);
    expect(drivers.get("c")?.rootMay).toEqual(["infrastructure"]);
  });
});

describe("ADR 0054: tag type:driver と drivers.json の名前が合うこと", () => {
  const violations = failuresOf(driversAreTagged);
  const entry = "drivers.json";
  const tagged = (role: string) => ({ nx: { name: "logging", tags: [`type:${role}`] } });

  it("tag と名前の両方がある driver と、driver のない repository を通すこと", () => {
    expect(violations(repo(logging({}, tagged("driver"))))).toEqual([]);
    expect(violations(repo())).toEqual([]);
  });

  it("tag type:driver があって drivers.json に名前のない package を拒否すること", () => {
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
    "drivers.json に名前があるのに tag が type:%s の package を拒否すること",
    (role) => {
      expect(violations(repo(logging({}, tagged(role))))).toEqual([
        `packages/logging has an entry in ${entry}, but its tag is type:${role}, not type:driver. A driver has the tag type:driver; take the entry out if it is not one (docs/adr/0054, ${guide}).`,
      ]);
    },
  );

  it("役割がない package と 2 つある package は packagesHaveOneRole に任せること", () => {
    expect(violations(repo(logging()))).toEqual([]);
    expect(
      violations(repo(logging({}, { nx: { name: "logging", tags: ["type:driver", "type:ui"] } }))),
    ).toEqual([]);
  });

  it("repository にない drivers.json の package は問わないこと", () => {
    expect(violations(repo({ "packages/logging/NOTES.md": "x" }))).toEqual([]);
  });
});
