// The checks of the dependencies between the modules (./modules.ts), each called on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import {
  apiDependencies,
  eventsFiles,
  lintEffect,
  packageFiles,
  packageJson,
  passingRepo,
  sharedKernelExports,
} from "./fixtures/passing-repo.ts";
import { apiManifest, failuresOf, json, repo } from "./fixtures/repo.ts";
import {
  dbDependencies,
  eventsPackages,
  modulePackageNames,
  modulesAreRegistered,
  modulesDependOneWay,
  modulesLintEffect,
  noResolutionBypass,
  packageManifests,
  packageNames,
  pathsHint,
} from "./modules.ts";
import { Tree } from "./tree.ts";

const base = passingRepo;

describe("ADR 0026: the package.json of every package under packages/", () => {
  const violations = failuresOf(packageManifests);
  const path = "packages/claim/package.json";
  const messages = {
    name: `${path} must have the name "@agent-software-factory/claim", the scope and the directory (docs/adr/0026).`,
    exports: `${path} must have the exports {".":"./src/index.ts"}, so that another package can import only its src/index.ts (docs/adr/0026).`,
    index:
      "packages/module-fixtures/src/index.ts, the public API that the exports name, does not exist (docs/adr/0026).",
    nx: `${path} must have the Nx project name "claim" (nx.name), the name of its directory (docs/adr/0026).`,
    check: `${path} must have the check script "vp check", so that Nx lints and type-checks the package (docs/adr/0026).`,
  };

  it.each([
    ["a name of another scope", { name: "@x/claim" }, messages.name],
    ["a name of another directory", { name: "@agent-software-factory/claims" }, messages.name],
    ["no exports", { exports: undefined }, messages.exports],
    [
      "exports of a subpath too",
      { exports: { ".": "./src/index.ts", "./x": "./src/x.ts" } },
      messages.exports,
    ],
    ["exports of another file", { exports: { ".": "./index.ts" } }, messages.exports],
    ["exports as a string", { exports: "./src/index.ts" }, messages.exports],
    ["no Nx project name", { nx: { tags: ["type:module"] } }, messages.nx],
    [
      "an Nx project name of another directory",
      { nx: { name: "claims", tags: ["type:module"] } },
      messages.nx,
    ],
  ])("refuses a package.json with %s", (_, fields, message) => {
    expect(violations(repo({ [path]: packageJson("claim", fields) }))).toEqual([message]);
  });

  it.each([
    ["no check script", { "lint-effect": lintEffect }],
    ["another check script", { check: "vp lint", "lint-effect": lintEffect }],
  ])("refuses a package with %s", (_, scripts) => {
    expect(violations(repo({ [path]: packageJson("claim", { scripts }) }))).toEqual([
      messages.check,
    ]);
  });

  it("refuses a package without its src/index.ts, and names every problem of an empty package.json", () => {
    expect(violations(repo({ "packages/module-fixtures/src/index.ts": undefined }))).toEqual([
      messages.index,
    ]);
    expect(
      violations(repo({ "packages/shared-kernel/package.json": "{}" })).filter((failure) =>
        failure.startsWith("packages/shared-kernel/"),
      ),
    ).toEqual([
      'packages/shared-kernel/package.json must have the name "@agent-software-factory/shared-kernel", the scope and the directory (docs/adr/0026).',
      `packages/shared-kernel/package.json must have the exports ${JSON.stringify(sharedKernelExports)}, the contract and one entry for each feature, and nothing else (docs/adr/0051).`,
      'packages/shared-kernel/package.json must have the Nx project name "shared-kernel" (nx.name), the name of its directory (docs/adr/0026).',
      'packages/shared-kernel/package.json must have the check script "vp check", so that Nx lints and type-checks the package (docs/adr/0026).',
    ]);
  });
});

describe("ADR 0026: the modules depend one way, by their package.json", () => {
  const violations = failuresOf(packageManifests, modulesDependOneWay, modulesLintEffect);
  const table = "tools/scripts/src/checks/repo-policy/modules.ts";
  const manifest = (name: string, fields: Record<string, Record<string, string>> = {}) =>
    packageFiles(name, fields);
  const wrong = (from: string, field: string, to: string) =>
    `packages/${from}/package.json has @agent-software-factory/${to} in ${field}. A module depends only on shared-kernel and the modules after it in closing → approval → claim, and shared-kernel, module-fixtures, ui, i18n, telemetry and logging on none: move the code that needs ${to}, or move what both need into shared-kernel (docs/adr/0026).`;
  const workspace = { "@agent-software-factory/claim": "workspace:*" };

  it("leaves db to dbDependencies: it is no module, and a package that depends on it is not refused here", () => {
    const only = failuresOf(modulesDependOneWay);
    const dbDependsOnClaim = {
      "packages/db/package.json": packageJson("db", { devDependencies: workspace }),
    };
    expect(only(repo(dbDependsOnClaim))).toEqual([]);
    const dependsOnDb = { devDependencies: { "@agent-software-factory/db": "workspace:*" } };
    expect(only(repo(manifest("claim", dependsOnDb)))).toEqual([]);
  });

  it("passes each module with the modules it may depend on, and shared", () => {
    expect(
      violations(
        repo({
          ...manifest("approval", { dependencies: workspace }),
          ...manifest("closing", {
            dependencies: {
              "@agent-software-factory/approval": "workspace:*",
              "@agent-software-factory/shared-kernel": "workspace:*",
            },
            devDependencies: workspace,
          }),
        }),
      ),
    ).toEqual([]);
  });

  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "refuses a module that depends on a module after it, in %s",
    (field) => {
      expect(
        violations(
          repo(
            manifest("claim", { [field]: { "@agent-software-factory/approval": "workspace:*" } }),
          ),
        ),
      ).toEqual([wrong("claim", field, "approval")]);
    },
  );

  it("refuses shared-kernel that depends on a module or on itself, and a module on another package of the workspace", () => {
    expect(
      violations(
        repo({
          ...manifest("shared-kernel", {
            dependencies: workspace,
            devDependencies: { "@agent-software-factory/shared-kernel": "workspace:*" },
          }),
          ...manifest("approval", {
            dependencies: { "@agent-software-factory/api": "workspace:*" },
          }),
        }),
      ),
    ).toEqual([
      wrong("approval", "dependencies", "api"),
      wrong("shared-kernel", "dependencies", "claim"),
      wrong("shared-kernel", "devDependencies", "shared-kernel"),
    ]);
  });

  it("refuses a module that depends on itself, or on a module before it", () => {
    expect(
      violations(
        repo(
          manifest("approval", {
            dependencies: {
              "@agent-software-factory/approval": "workspace:*",
              "@agent-software-factory/closing": "workspace:*",
            },
          }),
        ),
      ),
    ).toEqual([
      wrong("approval", "dependencies", "approval"),
      wrong("approval", "dependencies", "closing"),
    ]);
  });

  it("asks module-fixtures for no place in moduleOrder, and refuses any package of the workspace it depends on", () => {
    expect(violations(repo(manifest("module-fixtures")))).toEqual([]);
    expect(
      violations(
        repo(
          manifest("module-fixtures", {
            dependencies: {
              "@agent-software-factory/shared-kernel": "workspace:*",
              effect: "catalog:",
            },
            devDependencies: workspace,
          }),
        ),
      ),
    ).toEqual([
      wrong("module-fixtures", "dependencies", "shared-kernel"),
      wrong("module-fixtures", "devDependencies", "claim"),
    ]);
  });

  it("asks module-fixtures for the check script, like a module", () => {
    expect(
      violations(
        repo({
          "packages/module-fixtures/package.json": packageJson("module-fixtures", {
            scripts: { "lint-effect": lintEffect },
          }),
        }),
      ),
    ).toEqual([
      'packages/module-fixtures/package.json must have the check script "vp check", so that Nx lints and type-checks the package (docs/adr/0026).',
    ]);
  });

  it("asks module-fixtures for the lint-effect script, like a module", () => {
    expect(
      violations(
        repo({
          ...manifest("module-fixtures"),
          "packages/module-fixtures/package.json": packageJson("module-fixtures", {
            scripts: { check: "vp check" },
          }),
        }),
      ),
    ).toEqual([
      `packages/module-fixtures/package.json must have the lint-effect script "${lintEffect}", so that effect-tsgo checks the module (docs/adr/0028).`,
    ]);
  });

  it("asks ui for no place in moduleOrder, no index.ts, no lint-effect script, and its own exports", () => {
    const uiExports = {
      "./globals.css": "./src/styles/globals.css",
      "./components/*": "./src/components/*.tsx",
      "./hooks/*": "./src/hooks/*.ts",
      "./lib/*": "./src/lib/*.ts",
    };
    const ui = (fields: Record<string, unknown>) => ({
      "packages/ui/package.json": packageJson("ui", { exports: uiExports, ...fields }),
    });
    expect(violations(repo(ui({})))).toEqual([]);
    expect(violations(repo(ui({ exports: { ".": "./src/index.ts" } })))).toEqual([
      `packages/ui/package.json must have the exports ${JSON.stringify(uiExports)}, the folders of the parts and the CSS and nothing else (docs/adr/0034).`,
    ]);
    expect(
      violations(
        repo(ui({ dependencies: { "@agent-software-factory/shared-kernel": "workspace:*" } })),
      ),
    ).toEqual([wrong("ui", "dependencies", "shared-kernel")]);
  });

  it("refuses a module that depends on ui", () => {
    expect(
      violations(
        repo(manifest("claim", { dependencies: { "@agent-software-factory/ui": "workspace:*" } })),
      ),
    ).toEqual([wrong("claim", "dependencies", "ui")]);
  });

  it("asks i18n for no place in moduleOrder, no lint-effect script, and refuses a workspace package it depends on", () => {
    const i18n = (fields: Record<string, unknown>) => ({
      "packages/i18n/package.json": packageJson("i18n", fields),
      "packages/i18n/src/index.ts": "",
    });
    expect(violations(repo(i18n({})))).toEqual([]);
    expect(
      violations(
        repo(i18n({ dependencies: { "@agent-software-factory/shared-kernel": "workspace:*" } })),
      ),
    ).toEqual([wrong("i18n", "dependencies", "shared-kernel")]);
  });

  it("refuses a module that depends on i18n", () => {
    expect(
      violations(
        repo(
          manifest("claim", { dependencies: { "@agent-software-factory/i18n": "workspace:*" } }),
        ),
      ),
    ).toEqual([wrong("claim", "dependencies", "i18n")]);
  });

  it("passes a dependency outside the workspace, and one of a longer scope", () => {
    expect(
      violations(
        repo(
          manifest("claim", {
            dependencies: { effect: "catalog:", "@agent-software-factory-x/approval": "1.0.0" },
          }),
        ),
      ),
    ).toEqual([]);
  });

  it("refuses a package under packages/ that is not a module of the table", () => {
    expect(violations(repo(manifest("billing", { dependencies: workspace })))).toEqual([
      `packages/billing is not in moduleOrder in ${table}, so nothing checks which modules it depends on. Add it in the direction the modules depend (docs/adr/0026, docs/domain-model/add-module.md).`,
    ]);
  });
});

// The parts of the fixture of packages/db (docs/adr/0038), and a file that has all three.
describe("ADR 0026: the events package of each module", () => {
  const violations = failuresOf(eventsPackages, modulesDependOneWay);
  const events = (module: string) => `packages/${module}/events/package.json`;
  const wrongDependency = (module: string, field: string, dependency: string) =>
    `${events(module)} has @agent-software-factory/${dependency} in ${field}. An events package depends on zod and shared-kernel only: the schemas of the events must not pull in the code of a module (docs/adr/0026).`;
  const workspace = { "@agent-software-factory/claim": "workspace:*" };

  it("passes the events packages of the passing repository", () => {
    expect(violations(repo())).toEqual([]);
  });

  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "refuses an events package that depends on a package of the workspace but shared-kernel, in %s",
    (field) => {
      expect(violations(repo(eventsFiles("approval", { [field]: workspace })))).toEqual([
        wrongDependency("approval", field, "claim"),
      ]);
    },
  );

  it("refuses an events package that depends on the module it belongs to", () => {
    expect(
      violations(
        repo(
          eventsFiles("claim", {
            dependencies: { "@agent-software-factory/claim": "workspace:*" },
          }),
        ),
      ),
    ).toEqual([wrongDependency("claim", "dependencies", "claim")]);
  });

  it("refuses an events package that has the tag type:module", () => {
    expect(
      violations(
        repo(eventsFiles("claim", { nx: { name: "claim-events", tags: ["type:module"] } })),
      ),
    ).toEqual([
      `${events("claim")} has the tag type:module. An events package is not a module: a module is a name of moduleOrder, and the tag would ask for a place there (docs/adr/0026).`,
    ]);
  });

  it("takes package.json and events/package.json from packages/<name>/ only, and by that exact name", () => {
    const stray = {
      "vendor/packages/stray/events/package.json": "{}",
      "packages/stray/events/package.json.bak": "{}",
      "vendor/packages/stray/package.json": "{}",
      "packages/stray/package.json.bak": "{}",
    };
    expect(eventsPackages(new Tree(repo(stray)))).toEqual(eventsPackages(new Tree(repo())));
    expect(packageNames(new Tree(repo(stray)))).toEqual(packageNames(new Tree(repo())));
  });

  it("leaves shared-kernel, ui, i18n, telemetry, logging and db out of the module packages", () => {
    const names = ["shared-kernel", "ui", "i18n", "telemetry", "logging", "db"];
    const tree = new Tree(
      repo(Object.fromEntries(names.map((name) => [`packages/${name}/package.json`, "{}"]))),
    );
    expect(packageNames(tree)).toEqual(expect.arrayContaining(names));
    expect(modulePackageNames(tree).filter((name) => names.includes(name))).toEqual([]);
    expect(modulePackageNames(tree)).toContain("module-fixtures");
  });

  it("says in the hint what to write for the @/* import", () => {
    expect(pathsHint).toContain("compilerOptions.paths");
    expect(pathsHint).toContain("./src/");
    expect(pathsHint).toContain("docs/adr/0033");
  });

  it("refuses an events package under a directory that is not a module of moduleOrder", () => {
    expect(violations(repo(eventsFiles("shared-kernel")))).toEqual([
      `packages/shared-kernel/events is an events package, but shared-kernel is not a module of moduleOrder in tools/scripts/src/checks/repo-policy/modules.ts. Only a module has one (docs/adr/0026, docs/domain-model/add-module.md).`,
    ]);
  });

  it("refuses the name of an events package in moduleOrder", () => {
    expect(
      eventsPackages(new Tree(repo()), ["closing", "approval", "claim", "claim-events"]),
    ).toEqual([
      "claim-events is in moduleOrder in tools/scripts/src/checks/repo-policy/modules.ts, but it is the name of an events package, which is not a module. Take it out; an events package is not in moduleOrder (docs/adr/0026).",
    ]);
  });

  it("refuses a module with no events package", () => {
    expect(
      violations(
        repo({ ...eventsFiles("claim"), "packages/claim/events/package.json": undefined }),
      ),
    ).toEqual([
      `packages/claim has no events package at packages/claim/events/package.json. Every module has one, for the events it sends to the other modules (docs/adr/0026, docs/domain-model/add-module.md).`,
    ]);
  });

  it("refuses the name, the exports, the Nx project name, the check script and the index.ts that differ", () => {
    expect(
      violations(
        repo({
          ...eventsFiles("claim", {
            name: "@agent-software-factory/claim",
            exports: { ".": "./src/index.ts", "./x": "./src/x.ts" },
            scripts: {},
            nx: { name: "claim" },
          }),
          "packages/claim/events/src/index.ts": undefined,
        }),
      ),
    ).toEqual([
      `${events("claim")} must have the name "@agent-software-factory/claim-events", the scope and the module and events (docs/adr/0026).`,
      `${events("claim")} must have the exports {".":"./src/index.ts"}, so that another package can import only its src/index.ts (docs/adr/0026).`,
      `packages/claim/events/src/index.ts, the public API that the exports name, does not exist (docs/adr/0026).`,
      `${events("claim")} must have the test script "vp test run", so that Nx runs the check of the past versions of the events (docs/async/event-contract.md).`,
      `${events("claim")} must have the Nx project name "claim-events" (nx.name), the module and events (docs/adr/0026).`,
      `${events("claim")} must have the check script "vp check", so that Nx lints and type-checks the package (docs/adr/0026).`,
    ]);
  });

  it("refuses an events package with no test script, no versions test or no fixture", () => {
    expect(
      violations(
        repo({
          ...eventsFiles("claim", { scripts: { check: "vp check" } }),
          "packages/claim/events/test/versions.test.ts": undefined,
          "packages/claim/events/test/fixtures/claim.done.v1.json": undefined,
        }),
      ),
    ).toEqual([
      `${events("claim")} must have the test script "vp test run", so that Nx runs the check of the past versions of the events (docs/async/event-contract.md).`,
      "packages/claim/events/test/versions.test.ts does not exist. It checks the schemas against the fixtures of the past versions (docs/async/event-contract.md).",
      "packages/claim/events/test/fixtures/ has no <kind>.v<version>.json. Each event has a fixture of its current version (docs/async/event-contract.md).",
    ]);
  });

  it("lets each module depend on the events package of any module, itself included", () => {
    const events = (module: string) => ({
      [`@agent-software-factory/${module}-events`]: "workspace:*",
    });
    expect(
      violations(
        repo({
          ...packageFiles("claim", {
            dependencies: {
              "@agent-software-factory/shared-kernel": "workspace:*",
              ...events("closing"),
            },
          }),
          ...packageFiles("approval", {
            dependencies: { "@agent-software-factory/claim": "workspace:*", ...events("approval") },
            devDependencies: events("claim"),
          }),
        }),
      ),
    ).toEqual([]);
  });

  it("refuses a module that depends on the events package of a module that does not exist, and shared-kernel on any", () => {
    expect(
      violations(
        repo({
          ...packageFiles("claim", {
            dependencies: { "@agent-software-factory/billing-events": "workspace:*" },
          }),
          ...packageFiles("shared-kernel", {
            dependencies: { "@agent-software-factory/claim-events": "workspace:*" },
          }),
        }),
      ),
    ).toEqual([
      `packages/claim/package.json has @agent-software-factory/billing-events in dependencies. A module depends only on shared-kernel and the modules after it in closing → approval → claim, and shared-kernel, module-fixtures, ui, i18n, telemetry and logging on none: move the code that needs billing-events, or move what both need into shared-kernel (docs/adr/0026).`,
      `packages/shared-kernel/package.json has @agent-software-factory/claim-events in dependencies. A module depends only on shared-kernel and the modules after it in closing → approval → claim, and shared-kernel, module-fixtures, ui, i18n, telemetry and logging on none: move the code that needs claim-events, or move what both need into shared-kernel (docs/adr/0026).`,
    ]);
  });

  it("still refuses a module that depends on the body of a module before it", () => {
    expect(
      violations(
        repo(
          packageFiles("claim", {
            dependencies: { "@agent-software-factory/approval": "workspace:*" },
          }),
        ),
      ),
    ).toEqual([
      `packages/claim/package.json has @agent-software-factory/approval in dependencies. A module depends only on shared-kernel and the modules after it in closing → approval → claim, and shared-kernel, module-fixtures, ui, i18n, telemetry and logging on none: move the code that needs approval, or move what both need into shared-kernel (docs/adr/0026).`,
    ]);
  });
});

describe("ADR 0026: a module with the tag type:module is registered everywhere", () => {
  const violations = failuresOf(modulesDependOneWay, modulesAreRegistered);
  const order = "tools/scripts/src/checks/repo-policy/modules.ts";
  const guide = "Follow docs/domain-model/add-module.md.";

  it("passes the modules of the passing repository, each in moduleOrder, the dependencies of apps/api and both files", () => {
    expect(violations(repo())).toEqual([]);
  });

  it("refuses a package with the tag that is not in moduleOrder", () => {
    expect(
      violations(repo(packageFiles("extra", { nx: { name: "extra", tags: ["type:module"] } }))),
    ).toEqual([
      `packages/extra is not in moduleOrder in ${order}, so nothing checks which modules it depends on. Add it in the direction the modules depend (docs/adr/0026, docs/domain-model/add-module.md).`,
      `packages/extra has the tag type:module but is not in moduleOrder in ${order}. ${guide}`,
      'apps/api/package.json must have @agent-software-factory/extra: "workspace:*" in dependencies, since packages/extra has the tag type:module. ' +
        guide,
      `apps/api/src/db/databases.ts must import @agent-software-factory/extra, since packages/extra has the tag type:module. ${guide}`,
      `apps/api/src/app.ts must import @agent-software-factory/extra, since packages/extra has the tag type:module. ${guide}`,
    ]);
  });

  it.each([
    ["no tag", { nx: { name: "claim" } }],
    ["another tag", { nx: { name: "claim", tags: ["type:util"] } }],
    ["tags that are not a list", { nx: { name: "claim", tags: "type:module" } }],
  ])("refuses a name of moduleOrder whose package has %s", (_, fields) => {
    expect(violations(repo(packageFiles("claim", fields)))).toEqual([
      `claim is in moduleOrder in ${order}, but no package under packages/ named claim has the tag type:module in nx.tags of its package.json. ${guide}`,
    ]);
  });

  it("refuses a name of moduleOrder that has no package", () => {
    expect(violations(repo({ "packages/closing/package.json": undefined }))).toEqual([
      `closing is in moduleOrder in ${order}, but no package under packages/ named closing has the tag type:module in nx.tags of its package.json. ${guide}`,
    ]);
  });

  it("refuses a module that apps/api lacks in dependencies, lists with a version, or lists only in devDependencies", () => {
    const { "@agent-software-factory/claim": _, ...others } = apiDependencies;
    const message = `apps/api/package.json must have @agent-software-factory/claim: "workspace:*" in dependencies, since packages/claim has the tag type:module. ${guide}`;
    const withApi = (fields: Record<string, unknown>) =>
      violations(repo({ "apps/api/package.json": json(fields) }));
    expect(withApi({ dependencies: others })).toEqual([message]);
    expect(
      withApi({ dependencies: { ...others, "@agent-software-factory/claim": "1.0.0" } }),
    ).toEqual([message]);
    expect(
      withApi({
        dependencies: others,
        devDependencies: { "@agent-software-factory/claim": "workspace:*" },
      }),
    ).toEqual([message]);
  });

  it.each(["apps/api/src/db/databases.ts", "apps/api/src/app.ts"])(
    "refuses %s that does not import a module",
    (path) => {
      expect(violations(repo({ [path]: 'import "@agent-software-factory/approval";\n' }))).toEqual([
        expect.stringContaining(`${path} must import @agent-software-factory/claim,`),
        expect.stringContaining(`${path} must import @agent-software-factory/closing,`),
      ]);
      expect(violations(repo({ [path]: undefined }))).toHaveLength(3);
    },
  );

  it("takes a type import, a side-effect import and an import of several lines", () => {
    const imports = [
      'import type { X } from "@agent-software-factory/claim";',
      'import "@agent-software-factory/approval";',
      'import {\n  Y,\n} from "@agent-software-factory/closing";',
    ].join("\n");
    expect(
      violations(repo({ "apps/api/src/app.ts": imports, "apps/api/src/db/databases.ts": imports })),
    ).toEqual([]);
  });
});

describe("ADR 0038: db depends on the modules by type only, and only apps/api and apps/worker depend on db", () => {
  const violations = failuresOf(dbDependencies, packageManifests);
  const dbExports = {
    "./node": "./src/node.ts",
    "./seed": "./src/seed/index.ts",
    "./testing": "./src/testing/index.ts",
  };
  const db = (fields: Record<string, unknown> = {}) => ({
    "packages/db/package.json": packageJson("db", {
      exports: dbExports,
      scripts: { check: "vp check" },
      ...fields,
    }),
    "packages/db/src/node.ts": "export {};\n",
  });
  const claim = { "@agent-software-factory/claim": "workspace:*" };
  const dbDependency = { "@agent-software-factory/db": "workspace:*" };
  const dbHas = (dependency: string, field: string) =>
    `packages/db/package.json has @agent-software-factory/${dependency} in ${field}. db depends on the modules by \`import type\` only, so it lists them in devDependencies and no other package of the workspace: move the code that needs ${dependency} out of db (docs/adr/0038).`;
  const refused = (path: string, field: string) =>
    `${path} has @agent-software-factory/db in ${field}. Only apps/api and apps/worker depend on db: the modules, shared-kernel, ui and the other apps and tools have no use for the tools of the database (docs/adr/0038).`;

  it("passes db with the modules in devDependencies, without a place in moduleOrder or a lint-effect script", () => {
    expect(
      violations(repo({ ...db({ devDependencies: claim, dependencies: { pg: "catalog:" } }) })),
    ).toEqual([]);
  });

  it("passes apps/api that depends on db", () => {
    expect(
      violations(
        repo({
          ...db(),
          "apps/api/package.json": apiManifest({
            dependencies: { ...apiDependencies, ...dbDependency },
          }),
        }),
      ),
    ).toEqual([]);
  });

  it("passes apps/worker that depends on db", () => {
    expect(
      violations(
        repo({
          ...db(),
          "apps/worker/package.json": packageJson("worker", {
            dependencies: dbDependency,
          }),
        }),
      ),
    ).toEqual([]);
  });

  it.each(["dependencies", "peerDependencies", "optionalDependencies"])(
    "refuses db that depends on a module in %s",
    (field) => {
      expect(violations(repo({ ...db({ [field]: claim }) }))).toEqual([dbHas("claim", field)]);
    },
  );

  it.each(["shared-kernel", "ui", "api", "web"])(
    "refuses db that depends on %s, even in devDependencies",
    (name) => {
      expect(
        violations(
          repo({
            ...db({ devDependencies: { [`@agent-software-factory/${name}`]: "workspace:*" } }),
          }),
        ),
      ).toEqual([dbHas(name, "devDependencies")]);
    },
  );

  it("refuses db that depends on itself or on a package that is not a module", () => {
    expect(
      violations(
        repo({
          ...db({
            devDependencies: {
              "@agent-software-factory/db": "workspace:*",
              "@agent-software-factory/billing": "workspace:*",
            },
          }),
        }),
      ),
    ).toEqual([dbHas("db", "devDependencies"), dbHas("billing", "devDependencies")]);
  });

  it("passes db's dependencies outside the workspace, and of a longer scope", () => {
    expect(
      violations(
        repo({
          ...db({
            devDependencies: { "@agent-software-factory-x/claim": "1.0.0", typescript: "catalog:" },
          }),
        }),
      ),
    ).toEqual([]);
  });

  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "refuses a module, shared-kernel, ui or an app other than apps/api that depends on db, in %s",
    (field) => {
      expect(
        violations(
          repo({
            ...db(),
            "packages/claim/package.json": packageJson("claim", { [field]: dbDependency }),
            "packages/shared-kernel/package.json": packageJson("shared-kernel", {
              [field]: dbDependency,
            }),
            "apps/web/package.json": json({ [field]: dbDependency }),
          }),
        ),
      ).toEqual([
        refused("apps/web/package.json", field),
        refused("packages/claim/package.json", field),
        refused("packages/shared-kernel/package.json", field),
      ]);
    },
  );

  it("refuses the root package.json that depends on db", () => {
    expect(
      violations(
        repo({
          ...db(),
          "package.json": json({
            engines: { node: "^24" },
            devDependencies: { nx: "catalog:", ...dbDependency },
          }),
        }),
      ),
    ).toEqual([refused("package.json", "devDependencies")]);
  });

  it("does not ask who depends on db when there is no db", () => {
    expect(
      violations(repo({ "apps/web/package.json": json({ dependencies: dbDependency }) })),
    ).toEqual([]);
  });

  it.each([
    ["exports of the production entry only", { "./node": "./src/node.ts" }],
    ["no seed", { "./node": "./src/node.ts", "./testing": "./src/testing/index.ts" }],
    ["a subpath too", { ...dbExports, "./x": "./src/x.ts" }],
  ])("refuses db with %s", (_, exports) => {
    expect(violations(repo({ ...db({ exports }) }))).toEqual([
      `packages/db/package.json must have the exports ${JSON.stringify(dbExports)}, the Node-only entry of production, the seed and the tools of the tests, and nothing else (docs/adr/0038, 0051).`,
    ]);
  });

  it("asks db for the check script and the file of every export, like every package", () => {
    expect(
      violations(repo({ ...db({ scripts: {} }), "packages/db/src/node.ts": undefined })),
    ).toEqual([
      "packages/db/src/node.ts, the public API that the exports name, does not exist (docs/adr/0026).",
      'packages/db/package.json must have the check script "vp check", so that Nx lints and type-checks the package (docs/adr/0026).',
    ]);
  });
});

describe("ADR 0048: packages/telemetry", () => {
  const violations = failuresOf(packageManifests, modulesDependOneWay);
  const exports = { ".": "./src/index.ts", "./node": "./src/node.ts" };
  const withTelemetry = (fields: Record<string, unknown> = {}) =>
    repo(packageFiles("telemetry", { exports, ...fields }));

  it("passes telemetry with its two exports", () => {
    expect(violations(withTelemetry())).toEqual([]);
  });

  it("is not a module: it is left out of the module packages and may depend on none", () => {
    const tree = new Tree(withTelemetry());
    expect(modulePackageNames(tree)).not.toContain("telemetry");
    expect(
      violations(
        withTelemetry({ dependencies: { "@agent-software-factory/claim": "workspace:*" } }),
      ),
    ).toEqual([
      "packages/telemetry/package.json has @agent-software-factory/claim in dependencies. A module depends only on shared-kernel and the modules after it in closing → approval → claim, and shared-kernel, module-fixtures, ui, i18n, telemetry and logging on none: move the code that needs claim, or move what both need into shared-kernel (docs/adr/0026).",
    ]);
  });

  it.each([
    ["only the entry for any code", { ".": "./src/index.ts" }],
    ["a subpath too", { ...exports, "./x": "./src/x.ts" }],
  ])("refuses telemetry with %s", (_, wrong) => {
    expect(violations(repo(packageFiles("telemetry", { exports: wrong })))).toEqual([
      `packages/telemetry/package.json must have the exports ${JSON.stringify(exports)}, the entry for any code and the Node-only entry that starts the SDK, and nothing else (docs/adr/0048).`,
    ]);
  });
});

describe("ADR 0049: packages/logging", () => {
  const violations = failuresOf(packageManifests);
  const exports = {
    ".": "./src/index.ts",
    "./node": "./src/node.ts",
    "./testing": "./src/testing.ts",
  };

  it("passes logging with its three exports", () => {
    const withLogging = repo(packageFiles("logging", { exports }));
    expect(violations(withLogging)).toEqual([]);
    expect(modulePackageNames(new Tree(withLogging))).not.toContain("logging");
  });

  it("refuses logging with an export other than the three entries", () => {
    expect(
      violations(repo(packageFiles("logging", { exports: { ".": "./src/index.ts" } }))),
    ).toEqual([
      `packages/logging/package.json must have the exports ${JSON.stringify(exports)}, the entry for any code, the Node-only entry that creates the pino logger, and the tools of the tests, and nothing else (docs/adr/0049).`,
    ]);
  });
});

describe("ADR 0026: nothing resolves a package that a package.json does not declare", () => {
  const violations = failuresOf(noResolutionBypass);
  const resolves = (path: string, what: string) =>
    `${path} ${what}, which lets a package resolve a package that its package.json does not declare. The direction between the modules rests on that not resolving (docs/adr/0026).`;
  // paths and alias also say what to write for `@/*`; baseUrl and the pnpm settings do not.
  const resolvesWithHint = (path: string, what: string) => `${resolves(path, what)} ${pathsHint}`;
  const workspace = base["pnpm-workspace.yaml"] ?? "";

  it.each(["paths", "baseUrl"])(
    "refuses a tsconfig.json that sets %s, at the root or in a project",
    (option) => {
      expect(
        violations(
          repo({
            "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, [option]: {} } }),
            "packages/claim/tsconfig.json": JSON.stringify({
              extends: "../../tsconfig.json",
              compilerOptions: { [option]: "." },
            }),
          }),
        ).filter((failure) => failure.includes("lets a package resolve")),
      ).toEqual([
        (option === "paths" ? resolvesWithHint : resolves)(
          "packages/claim/tsconfig.json",
          `sets compilerOptions.${option}`,
        ),
        (option === "paths" ? resolvesWithHint : resolves)(
          "tsconfig.json",
          `sets compilerOptions.${option}`,
        ),
      ]);
    },
  );

  it("passes a tsconfig.json whose paths only name files under its own src/", () => {
    expect(
      violations(
        repo({
          "apps/web/tsconfig.json": JSON.stringify({
            compilerOptions: { paths: { "@/*": ["./src/*"] } },
          }),
        }),
      ).filter((failure) => failure.includes("lets a package resolve")),
    ).toEqual([]);
  });

  it.each([
    ["a target outside src/", { "@/*": ["../../packages/closing/src/*"] }],
    ["a target that leaves src/ with ..", { "@/*": ["./src/../../x"] }],
    ["a target that is not a list", { "@/*": "./src/*" }],
    ["an empty list of targets", { "@/*": [] }],
    ["one entry outside src/", { "@/*": ["./src/*"], "#x": ["./lib/x.ts"] }],
    ["one target outside src/ in a list", { "@/*": ["./src/*", "../x/*"] }],
    ["a target that is not a string", { "@/*": [5] }],
  ])("refuses a tsconfig.json whose paths have %s", (_name, paths) => {
    expect(
      violations(
        repo({ "apps/web/tsconfig.json": JSON.stringify({ compilerOptions: { paths } }) }),
      ).filter((failure) => failure.includes("lets a package resolve")),
    ).toEqual([resolvesWithHint("apps/web/tsconfig.json", "sets compilerOptions.paths")]);
  });

  it.each([
    ["an alias", "resolve: { alias: { x: 'y' } },"],
    ["an alias with a space before the colon", "alias : [],"],
    ["an alias in the shorthand", "resolve: { alias },"],
    ["an alias in the shorthand with others", "resolve: { alias, dedupe },"],
    ["an alias after a URL", 'base: "https://x", alias: {},'],
    ["an alias after a comment line", "// a comment\nalias: {},"],
  ])("refuses a vite.config.ts with %s", (_, line) => {
    expect(
      violations(repo({ "apps/web/vite.config.ts": `export default {\n  ${line}\n};\n` })),
    ).toEqual([resolvesWithHint("apps/web/vite.config.ts", "sets an alias")]);
  });

  it("keeps what comes before a comment on the line of the alias", () => {
    expect(
      violations(repo({ "apps/web/vite.config.ts": "export default {alias}// a comment\n" })),
    ).toEqual([resolvesWithHint("apps/web/vite.config.ts", "sets an alias")]);
  });

  it("passes the word alias that is not a key, and a key of a longer name", () => {
    expect(
      violations(
        repo({
          "apps/web/vite.config.ts":
            "// global is an alias, of globalThis: { alias }\nexport default { realias: 1, aliases: [] };\n",
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["shamefullyHoist: true", "sets shamefullyHoist"],
    ["nodeLinker: hoisted", "sets nodeLinker: hoisted"],
    [
      'publicHoistPattern:\n  - "*"',
      "has * in publicHoistPattern, which hoists @agent-software-factory/approval",
    ],
    [
      'publicHoistPattern:\n  - "*eslint*"\n  - "@agent-software-factory/*"',
      "has @agent-software-factory/* in publicHoistPattern, which hoists @agent-software-factory/approval",
    ],
    [
      'publicHoistPattern:\n  - "@agent-software-factory/claim"',
      "has @agent-software-factory/claim in publicHoistPattern, which hoists @agent-software-factory/claim",
    ],
    [
      'publicHoistPattern:\n  - "*claim*"',
      "has *claim* in publicHoistPattern, which hoists @agent-software-factory/claim",
    ],
  ])("refuses a pnpm-workspace.yaml with %s", (setting, what) => {
    expect(violations(repo({ "pnpm-workspace.yaml": `${workspace}${setting}\n` }))).toEqual([
      resolves("pnpm-workspace.yaml", what),
    ]);
  });

  it("refuses a pattern that hoists any package under packages/, and only the packages there", () => {
    const pattern = 'publicHoistPattern:\n  - "@agent-software-factory/extra"\n';
    expect(violations(repo({ "pnpm-workspace.yaml": `${workspace}${pattern}` }))).toEqual([]);
    expect(
      violations(
        repo({
          "pnpm-workspace.yaml": `${workspace}${pattern}`,
          ...packageFiles("extra"),
        }),
      ),
    ).toContainEqual(
      resolves(
        "pnpm-workspace.yaml",
        "has @agent-software-factory/extra in publicHoistPattern, which hoists @agent-software-factory/extra",
      ),
    );
  });

  it.each([
    "shamefullyHoist: false",
    "nodeLinker: isolated",
    'publicHoistPattern:\n  - "*eslint*"\n  - "@agent-software-factory-x/*"\n  - "@agent-software-factory/claim-x"\n  - "x@agent-software-factory/claim"\n  - 1',
    "publicHoistPattern: '*'",
  ])("passes a pnpm-workspace.yaml with %s", (setting) => {
    expect(violations(repo({ "pnpm-workspace.yaml": `${workspace}${setting}\n` }))).toEqual([]);
  });
});

describe("ADR 0028: every module runs the Effect lint", () => {
  const violations = failuresOf(modulesLintEffect);
  const missing = (name: string) =>
    `packages/${name}/package.json must have the lint-effect script "${lintEffect}", so that effect-tsgo checks the module (docs/adr/0028).`;

  it.each([
    ["no lint-effect script", {}],
    [
      "a lint-effect script of one layer",
      { "lint-effect": lintEffect.replace(" src/infrastructure", "") },
    ],
    [
      "a lint-effect script of another config",
      { "lint-effect": lintEffect.replace("oxlint.effect", "oxlint") },
    ],
  ])("refuses a module with %s", (_, scripts) => {
    expect(
      violations(
        repo({
          "packages/claim/package.json": packageJson("claim", {
            scripts: { check: "vp check", ...scripts },
          }),
        }),
      ),
    ).toEqual([missing("claim")]);
  });

  it("refuses a module without the lint-effect script, and does not ask shared", () => {
    expect(
      violations(
        repo({
          "packages/claim/package.json": packageJson("claim", { scripts: { check: "vp check" } }),
          "packages/shared-kernel/package.json": packageJson("shared-kernel", {
            scripts: { check: "vp check", "lint-effect": "x" },
          }),
        }),
      ),
    ).toEqual([missing("claim")]);
  });
});
