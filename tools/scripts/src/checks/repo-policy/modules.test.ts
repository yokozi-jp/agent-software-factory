// The checks of the dependencies between the modules
// (./modules.ts), each called alone on a small repository held in memory: a case breaks one file of
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
  modulesHaveLayers,
  modulesLintEffect,
  noResolutionBypass,
  packageManifests,
  pathsHint,
} from "./modules.ts";
import { packageNames } from "./packages.ts";
import type { Role } from "./roles.ts";
import { Tree } from "./tree.ts";

const base = passingRepo;

describe("ADR 0026: packages/ の下のすべての package の package.json", () => {
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
  ])("%s のある package.json を拒否すること", (_, fields, message) => {
    expect(violations(repo({ [path]: packageJson("claim", fields) }))).toEqual([message]);
  });

  it.each([
    ["no check script", { "lint-effect": lintEffect }],
    ["another check script", { check: "vp lint", "lint-effect": lintEffect }],
  ])("%s のある package を拒否すること", (_, scripts) => {
    expect(violations(repo({ [path]: packageJson("claim", { scripts }) }))).toEqual([
      messages.check,
    ]);
  });

  it("src/index.ts のない package を拒否し、空の package.json のすべての問題を挙げること", () => {
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

describe("ADR 0026: モジュールが package.json で一方向に依存すること", () => {
  const violations = failuresOf(packageManifests, modulesDependOneWay, modulesLintEffect);
  const table = "tools/scripts/src/checks/repo-policy/modules.ts";
  const manifest = (
    name: string,
    fields: Record<string, Record<string, string>> = {},
    role?: Role,
  ) => packageFiles(name, fields, role);
  const wrong = (from: string, field: string, to: string) =>
    `packages/${from}/package.json has @agent-software-factory/${to} in ${field}. A module depends only on shared-kernel, the modules after it in closing → approval → claim, and the drivers (type:driver) other than db, and shared-kernel, module-fixtures, ui and the drivers on none: move the code that needs ${to}, or move what both need into shared-kernel (docs/adr/0026, docs/adr/0054).`;
  const workspace = { "@agent-software-factory/claim": "workspace:*" };

  it("db は dbDependencies に任せること: モジュールではなく、依存する package はここでは拒否しない", () => {
    const only = failuresOf(modulesDependOneWay);
    const dbDependsOnClaim = {
      "packages/db/package.json": packageJson("db", { devDependencies: workspace }, "driver"),
    };
    expect(only(repo(dbDependsOnClaim))).toEqual([]);
    const dependsOnDb = { devDependencies: { "@agent-software-factory/db": "workspace:*" } };
    expect(only(repo(manifest("claim", dependsOnDb)))).toEqual([]);
  });

  it("各モジュールを、依存してよいモジュールと shared とともに通すこと", () => {
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
    "%s で、自分より後のモジュールに依存するモジュールを拒否すること",
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

  it("モジュールや自分自身に依存する shared-kernel と、workspace の別の package に依存するモジュールを拒否すること", () => {
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

  it("自分自身や自分より前のモジュールに依存するモジュールを拒否すること", () => {
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

  it("module-fixtures に moduleOrder の位置を求めず、依存する workspace の package を拒否すること", () => {
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

  it("module-fixtures にも、モジュールと同じく check の script を求めること", () => {
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

  it("module-fixtures にも、モジュールと同じく lint-effect の script を求めること", () => {
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

  it("ui に moduleOrder の位置、index.ts、lint-effect の script を求めず、固有の exports を求めること", () => {
    const uiExports = {
      "./globals.css": "./src/styles/globals.css",
      "./components/*": "./src/components/*.tsx",
      "./hooks/*": "./src/hooks/*.ts",
      "./lib/*": "./src/lib/*.ts",
    };
    const ui = (fields: Record<string, unknown>) => ({
      "packages/ui/package.json": packageJson("ui", { exports: uiExports, ...fields }, "ui"),
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

  it("ui に依存するモジュールを拒否すること", () => {
    expect(
      violations(
        repo(manifest("claim", { dependencies: { "@agent-software-factory/ui": "workspace:*" } })),
      ),
    ).toEqual([wrong("claim", "dependencies", "ui")]);
  });

  it("i18n に moduleOrder の位置と lint-effect の script を求めず、依存する workspace の package を拒否すること", () => {
    const i18n = (fields: Record<string, unknown>) => ({
      "packages/i18n/package.json": packageJson("i18n", fields, "driver"),
      "packages/i18n/src/index.ts": "",
    });
    expect(violations(repo(i18n({})))).toEqual([]);
    expect(
      violations(
        repo(i18n({ dependencies: { "@agent-software-factory/shared-kernel": "workspace:*" } })),
      ),
    ).toEqual([wrong("i18n", "dependencies", "shared-kernel")]);
  });

  it.each(["hr-system", "i18n", "logging", "telemetry"])(
    "driver %s に依存するモジュールを通すこと (docs/adr/0054)",
    (driver) => {
      expect(
        failuresOf(modulesDependOneWay)(
          repo({
            ...manifest(driver, {}, "driver"),
            ...manifest("claim", {
              dependencies: { [`@agent-software-factory/${driver}`]: "workspace:*" },
            }),
          }),
        ),
      ).toEqual([]);
    },
  );

  it("モジュールが依存してよい driver を、名前の一覧ではなく tag type:driver から求めること", () => {
    const dependsOn = (name: string) =>
      manifest("claim", { dependencies: { [`@agent-software-factory/${name}`]: "workspace:*" } });
    const asDriver = (name: string) => packageFiles(name, { nx: { name, tags: ["type:driver"] } });
    // A package this file has never heard of is a driver for a module as soon as it carries the tag.
    expect(violations(repo({ ...asDriver("mail"), ...dependsOn("mail") }))).toEqual([]);
    // The same package with the role ui is not.
    expect(
      violations(
        repo({
          ...packageFiles("mail", { nx: { name: "mail", tags: ["type:ui"] } }),
          ...dependsOn("mail"),
        }),
      ),
    ).toEqual([wrong("claim", "dependencies", "mail")]);
  });

  it("module 以外の役割の package は moduleOrder に席を求めず、依存する workspace の package を拒否すること", () => {
    for (const role of ["fixtures", "shared-kernel", "ui", "driver"]) {
      const name = `any-${role}`;
      expect(
        violations(
          repo(
            packageFiles(name, {
              nx: { name, tags: [`type:${role}`] },
              dependencies: workspace,
            }),
          ),
        ),
      ).toEqual([wrong(name, "dependencies", "claim")]);
    }
  });

  it("役割のない package は packagesHaveOneRole に任せ、ここでは依存を問わないこと", () => {
    expect(
      violations(
        repo(packageFiles("billing", { nx: { name: "billing" }, dependencies: workspace })),
      ),
    ).toEqual([]);
  });

  it("別の driver に依存する driver を拒否すること", () => {
    expect(
      failuresOf(modulesDependOneWay)(
        repo(
          manifest(
            "logging",
            { dependencies: { "@agent-software-factory/telemetry": "workspace:*" } },
            "driver",
          ),
        ),
      ),
    ).toEqual([wrong("logging", "dependencies", "telemetry")]);
  });

  it("workspace の外の依存と、長い scope の依存を通すこと", () => {
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

  it("役割が module の package が moduleOrder にないことを拒否すること", () => {
    expect(
      violations(
        repo(
          packageFiles("billing", {
            nx: { name: "billing", tags: ["type:module"] },
            dependencies: workspace,
          }),
        ),
      ),
    ).toEqual([
      `packages/billing is not in moduleOrder in ${table}, so nothing checks which modules it depends on. Add it in the direction the modules depend (docs/adr/0026, docs/domain-model/add-module.md).`,
    ]);
  });
});

// The parts of the fixture of packages/db (docs/adr/0038), and a file that has all three.
describe("ADR 0026: 各モジュールの events package", () => {
  const violations = failuresOf(eventsPackages, modulesDependOneWay);
  const events = (module: string) => `packages/${module}/events/package.json`;
  const wrongDependency = (module: string, field: string, dependency: string) =>
    `${events(module)} has @agent-software-factory/${dependency} in ${field}. An events package depends on zod and shared-kernel only: the schemas of the events must not pull in the code of a module (docs/adr/0026).`;
  const workspace = { "@agent-software-factory/claim": "workspace:*" };

  it("通るリポジトリの events package を通すこと", () => {
    expect(violations(repo())).toEqual([]);
  });

  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "%s で、shared-kernel 以外の workspace の package に依存する events package を拒否すること",
    (field) => {
      expect(violations(repo(eventsFiles("approval", { [field]: workspace })))).toEqual([
        wrongDependency("approval", field, "claim"),
      ]);
    },
  );

  it("自分が属するモジュールに依存する events package を拒否すること", () => {
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

  it.each([
    ["type:module", ["type:module"]],
    ["type:driver", ["type:driver"]],
    ["type:module, type:ui", ["type:module", "type:ui"]],
  ])("tag %s を持つ events package を拒否すること", (shown, tags) => {
    expect(violations(repo(eventsFiles("claim", { nx: { name: "claim-events", tags } })))).toEqual([
      `${events("claim")} has the tag ${shown}. An events package has no role: it is found by its path packages/<module>/events, and a tag of the dimension type: would make it a package of that role (docs/adr/0026).`,
    ]);
  });

  it("events package が別の次元の tag を持つことは許すこと", () => {
    expect(
      violations(repo(eventsFiles("claim", { nx: { name: "claim-events", tags: ["scope:x"] } }))),
    ).toEqual([]);
  });

  it("packages/<name>/ の package.json と events/package.json だけを、その名前そのままで採ること", () => {
    const stray = {
      "vendor/packages/stray/events/package.json": "{}",
      "packages/stray/events/package.json.bak": "{}",
      "vendor/packages/stray/package.json": "{}",
      "packages/stray/package.json.bak": "{}",
    };
    expect(eventsPackages(new Tree(repo(stray)))).toEqual(eventsPackages(new Tree(repo())));
  });

  it("役割が shared-kernel、ui、driver の package をモジュールの package から除き、module-fixtures は含めること", () => {
    const roles: Record<string, Role> = {
      "shared-kernel": "shared-kernel",
      ui: "ui",
      i18n: "driver",
      telemetry: "driver",
      logging: "driver",
      db: "driver",
    };
    const names = Object.keys(roles);
    const tree = new Tree(
      repo(
        Object.fromEntries(
          Object.entries(roles).map(([name, role]) => [
            `packages/${name}/package.json`,
            packageJson(name, {}, role),
          ]),
        ),
      ),
    );
    expect(packageNames(tree)).toEqual(expect.arrayContaining(names));
    expect(modulePackageNames(tree).filter((name) => names.includes(name))).toEqual([]);
    expect(modulePackageNames(tree)).toContain("module-fixtures");
  });

  it("モジュールの package を tag から求め、tag のない package はモジュールに数えないこと", () => {
    const tree = new Tree(
      repo({
        ...packageFiles("untagged", { nx: { name: "untagged" } }),
        ...packageFiles("mod", { nx: { name: "mod", tags: ["type:module"] } }),
      }),
    );
    expect(modulePackageNames(tree)).toEqual(expect.arrayContaining(["mod", "claim"]));
    expect(modulePackageNames(tree)).not.toContain("untagged");
  });

  it("ヒントに、@/* の import に何を書くかを述べること", () => {
    expect(pathsHint).toContain("compilerOptions.paths");
    expect(pathsHint).toContain("./src/");
    expect(pathsHint).toContain("docs/adr/0033");
  });

  it("moduleOrder のモジュールではないディレクトリの下の events package を拒否すること", () => {
    expect(violations(repo(eventsFiles("shared-kernel")))).toEqual([
      `packages/shared-kernel/events is an events package, but shared-kernel is not a module of moduleOrder in tools/scripts/src/checks/repo-policy/modules.ts. Only a module has one (docs/adr/0026, docs/domain-model/add-module.md).`,
    ]);
  });

  it("moduleOrder にある events package の名前を拒否すること", () => {
    expect(
      eventsPackages(new Tree(repo()), ["closing", "approval", "claim", "claim-events"]),
    ).toEqual([
      "claim-events is in moduleOrder in tools/scripts/src/checks/repo-policy/modules.ts, but it is the name of an events package, which is not a module. Take it out; an events package is not in moduleOrder (docs/adr/0026).",
    ]);
  });

  it("events package のないモジュールを拒否すること", () => {
    expect(
      violations(
        repo({ ...eventsFiles("claim"), "packages/claim/events/package.json": undefined }),
      ),
    ).toEqual([
      `packages/claim has no events package at packages/claim/events/package.json. Every module has one, for the events it sends to the other modules (docs/adr/0026, docs/domain-model/add-module.md).`,
    ]);
  });

  it("名前、exports、Nx の project 名、check の script、index.ts が違うものを拒否すること", () => {
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
      `${events("claim")} must have the test script "vp test run --coverage", so that Nx runs the check of the past versions of the events (docs/async/event-contract.md).`,
      `${events("claim")} must have the Nx project name "claim-events" (nx.name), the module and events (docs/adr/0026).`,
      `${events("claim")} must have the check script "vp check", so that Nx lints and type-checks the package (docs/adr/0026).`,
    ]);
  });

  it("test の script、versions のテスト、fixture のない events package を拒否すること", () => {
    expect(
      violations(
        repo({
          ...eventsFiles("claim", { scripts: { check: "vp check" } }),
          "packages/claim/events/test/versions.test.ts": undefined,
          "packages/claim/events/test/fixtures/claim.done.v1.json": undefined,
        }),
      ),
    ).toEqual([
      `${events("claim")} must have the test script "vp test run --coverage", so that Nx runs the check of the past versions of the events (docs/async/event-contract.md).`,
      "packages/claim/events/test/versions.test.ts does not exist. It checks the schemas against the fixtures of the past versions (docs/async/event-contract.md).",
      "packages/claim/events/test/fixtures/ has no <kind>.v<version>.json. Each event has a fixture of its current version (docs/async/event-contract.md).",
    ]);
  });

  it("各モジュールが、自分を含むどのモジュールの events package にも依存してよいこと", () => {
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

  it("存在しないモジュールの events package に依存するモジュールと、どれかに依存する shared-kernel を拒否すること", () => {
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
      `packages/claim/package.json has @agent-software-factory/billing-events in dependencies. A module depends only on shared-kernel, the modules after it in closing → approval → claim, and the drivers (type:driver) other than db, and shared-kernel, module-fixtures, ui and the drivers on none: move the code that needs billing-events, or move what both need into shared-kernel (docs/adr/0026, docs/adr/0054).`,
      `packages/shared-kernel/package.json has @agent-software-factory/claim-events in dependencies. A module depends only on shared-kernel, the modules after it in closing → approval → claim, and the drivers (type:driver) other than db, and shared-kernel, module-fixtures, ui and the drivers on none: move the code that needs claim-events, or move what both need into shared-kernel (docs/adr/0026, docs/adr/0054).`,
    ]);
  });

  it("自分より前のモジュールの本体に依存するモジュールを引き続き拒否すること", () => {
    expect(
      violations(
        repo(
          packageFiles("claim", {
            dependencies: { "@agent-software-factory/approval": "workspace:*" },
          }),
        ),
      ),
    ).toEqual([
      `packages/claim/package.json has @agent-software-factory/approval in dependencies. A module depends only on shared-kernel, the modules after it in closing → approval → claim, and the drivers (type:driver) other than db, and shared-kernel, module-fixtures, ui and the drivers on none: move the code that needs approval, or move what both need into shared-kernel (docs/adr/0026, docs/adr/0054).`,
    ]);
  });
});

describe("ADR 0026: tag type:module のモジュールがすべての場所に登録されていること", () => {
  const violations = failuresOf(modulesDependOneWay, modulesAreRegistered);
  const order = "tools/scripts/src/checks/repo-policy/modules.ts";
  const guide = "Follow docs/domain-model/add-module.md.";

  it("通るリポジトリのモジュールを、moduleOrder、apps/api の依存、app.ts のそれぞれで通すこと", () => {
    expect(violations(repo())).toEqual([]);
  });

  it("moduleOrder にない tag を持つ package を拒否すること", () => {
    expect(
      violations(repo(packageFiles("extra", { nx: { name: "extra", tags: ["type:module"] } }))),
    ).toEqual([
      `packages/extra is not in moduleOrder in ${order}, so nothing checks which modules it depends on. Add it in the direction the modules depend (docs/adr/0026, docs/domain-model/add-module.md).`,
      `packages/extra has the tag type:module but is not in moduleOrder in ${order}. ${guide}`,
      'apps/api/package.json must have @agent-software-factory/extra: "workspace:*" in dependencies, since packages/extra has the tag type:module. ' +
        guide,
      `apps/api/src/app.ts must import @agent-software-factory/extra, since packages/extra has the tag type:module. ${guide}`,
    ]);
  });

  it.each([
    ["no tag", { nx: { name: "claim" } }],
    ["another tag", { nx: { name: "claim", tags: ["type:util"] } }],
    ["tags that are not a list", { nx: { name: "claim", tags: "type:module" } }],
  ])("package が %s の moduleOrder の名前を拒否すること", (_, fields) => {
    expect(violations(repo(packageFiles("claim", fields)))).toEqual([
      `claim is in moduleOrder in ${order}, but no package under packages/ named claim has the tag type:module in nx.tags of its package.json. ${guide}`,
    ]);
  });

  it("package のない moduleOrder の名前を拒否すること", () => {
    expect(violations(repo({ "packages/closing/package.json": undefined }))).toEqual([
      `closing is in moduleOrder in ${order}, but no package under packages/ named closing has the tag type:module in nx.tags of its package.json. ${guide}`,
    ]);
  });

  it("apps/api の dependencies にない、版つきで挙げる、または devDependencies だけに挙げるモジュールを拒否すること", () => {
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

  it("モジュールを import しない apps/api/src/app.ts を拒否すること", () => {
    const path = "apps/api/src/app.ts";
    expect(violations(repo({ [path]: 'import "@agent-software-factory/approval";\n' }))).toEqual([
      expect.stringContaining(`${path} must import @agent-software-factory/claim,`),
      expect.stringContaining(`${path} must import @agent-software-factory/closing,`),
    ]);
    expect(violations(repo({ [path]: undefined }))).toHaveLength(3);
  });

  it("type の import、副作用の import、複数行の import を採ること", () => {
    const imports = [
      'import type { X } from "@agent-software-factory/claim";',
      'import "@agent-software-factory/approval";',
      'import {\n  Y,\n} from "@agent-software-factory/closing";',
    ].join("\n");
    expect(violations(repo({ "apps/api/src/app.ts": imports }))).toEqual([]);
  });
});

describe("ADR 0038: db は type だけでモジュールに依存し、db に依存するのは apps/api と apps/worker だけであること", () => {
  const violations = failuresOf(dbDependencies, packageManifests);
  const dbExports = {
    "./node": "./src/node.ts",
    "./seed": "./src/seed.ts",
    "./testing": "./src/testing.ts",
  };
  const db = (fields: Record<string, unknown> = {}) => ({
    "packages/db/package.json": packageJson(
      "db",
      { exports: dbExports, scripts: { check: "vp check" }, ...fields },
      "driver",
    ),
    "packages/db/src/node.ts": "export {};\n",
  });
  const claim = { "@agent-software-factory/claim": "workspace:*" };
  const dbDependency = { "@agent-software-factory/db": "workspace:*" };
  const dbHas = (dependency: string, field: string) =>
    `packages/db/package.json has @agent-software-factory/${dependency} in ${field}. db depends on the modules by \`import type\` only, so it lists them in devDependencies and no other package of the workspace: move the code that needs ${dependency} out of db (docs/adr/0038).`;
  const refused = (path: string, field: string) =>
    `${path} has @agent-software-factory/db in ${field}. Only apps/api and apps/worker depend on db: the modules, shared-kernel, ui and the other apps and tools have no use for the tools of the database (docs/adr/0038).`;

  it("モジュールを devDependencies に持ち、moduleOrder の位置も lint-effect の script もない db を通すこと", () => {
    expect(
      violations(repo({ ...db({ devDependencies: claim, dependencies: { pg: "catalog:" } }) })),
    ).toEqual([]);
  });

  it("db に依存する apps/api を通すこと", () => {
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

  it("db に依存する apps/worker を通すこと", () => {
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
    "%s でモジュールに依存する db を拒否すること",
    (field) => {
      expect(violations(repo({ ...db({ [field]: claim }) }))).toEqual([dbHas("claim", field)]);
    },
  );

  it.each(["shared-kernel", "ui", "api", "web"])(
    "devDependencies であっても、%s に依存する db を拒否すること",
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

  it("自分自身やモジュールではない package に依存する db を拒否すること", () => {
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

  it("db の workspace の外の依存と、長い scope の依存を通すこと", () => {
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
    "%s で、db に依存するモジュール、shared-kernel、ui、apps/api 以外の app を拒否すること",
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

  it("db に依存するルートの package.json を拒否すること", () => {
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

  it("db がないとき、db に依存するものを問わないこと", () => {
    expect(
      violations(repo({ "apps/web/package.json": json({ dependencies: dbDependency }) })),
    ).toEqual([]);
  });

  it.each([
    ["exports of the production entry only", { "./node": "./src/node.ts" }],
    ["no seed", { "./node": "./src/node.ts", "./testing": "./src/testing.ts" }],
    ["a subpath too", { ...dbExports, "./x": "./src/x.ts" }],
  ])("%s のある db を拒否すること", (_, exports) => {
    expect(violations(repo({ ...db({ exports }) }))).toEqual([
      `packages/db/package.json must have the exports ${JSON.stringify(dbExports)}, the Node-only entry of production, the seed and the tools of the tests, and nothing else (docs/adr/0038, 0051, 0054).`,
    ]);
  });

  it("すべての package と同じく、db に check の script とすべての export のファイルを求めること", () => {
    expect(
      violations(repo({ ...db({ scripts: {} }), "packages/db/src/node.ts": undefined })),
    ).toEqual([
      "packages/db/src/node.ts, the public API that the exports name, does not exist (docs/adr/0026).",
      'packages/db/package.json must have the check script "vp check", so that Nx lints and type-checks the package (docs/adr/0026).',
    ]);
  });
});

describe("ADR 0048: packages/telemetry の構成", () => {
  const violations = failuresOf(packageManifests, modulesDependOneWay);
  const exports = { ".": "./src/index.ts", "./node": "./src/node.ts" };
  const withTelemetry = (fields: Record<string, unknown> = {}) =>
    repo(packageFiles("telemetry", { exports, ...fields }, "driver"));

  it("2 つの exports を持つ telemetry を通すこと", () => {
    expect(violations(withTelemetry())).toEqual([]);
  });

  it("モジュールではないこと: モジュールの package から除かれ、何にも依存してはならない", () => {
    const tree = new Tree(withTelemetry());
    expect(modulePackageNames(tree)).not.toContain("telemetry");
    expect(
      violations(
        withTelemetry({ dependencies: { "@agent-software-factory/claim": "workspace:*" } }),
      ),
    ).toEqual([
      "packages/telemetry/package.json has @agent-software-factory/claim in dependencies. A module depends only on shared-kernel, the modules after it in closing → approval → claim, and the drivers (type:driver) other than db, and shared-kernel, module-fixtures, ui and the drivers on none: move the code that needs claim, or move what both need into shared-kernel (docs/adr/0026, docs/adr/0054).",
    ]);
  });

  it.each([
    ["only the entry for any code", { ".": "./src/index.ts" }],
    ["a subpath too", { ...exports, "./x": "./src/x.ts" }],
  ])("%s のある telemetry を拒否すること", (_, wrong) => {
    expect(violations(repo(packageFiles("telemetry", { exports: wrong }, "driver")))).toEqual([
      `packages/telemetry/package.json must have the exports ${JSON.stringify(exports)}, the entry for any code and the Node-only entry that starts the SDK, and nothing else (docs/adr/0048).`,
    ]);
  });
});

describe("ADR 0049: packages/logging の構成", () => {
  const violations = failuresOf(packageManifests);
  const exports = {
    ".": "./src/index.ts",
    "./node": "./src/node.ts",
    "./testing": "./src/testing.ts",
  };

  it("3 つの exports を持つ logging を通すこと", () => {
    const withLogging = repo(packageFiles("logging", { exports }, "driver"));
    expect(violations(withLogging)).toEqual([]);
    expect(modulePackageNames(new Tree(withLogging))).not.toContain("logging");
  });

  it("3 つの入口以外の export を持つ logging を拒否すること", () => {
    expect(
      violations(repo(packageFiles("logging", { exports: { ".": "./src/index.ts" } }, "driver"))),
    ).toEqual([
      `packages/logging/package.json must have the exports ${JSON.stringify(exports)}, the entry for any code, the Node-only entry that creates the pino logger, and the tools of the tests, and nothing else (docs/adr/0049).`,
    ]);
  });
});

describe("ADR 0052: packages/hr-system の構成", () => {
  const violations = failuresOf(packageManifests, modulesDependOneWay);
  const exports = { ".": "./src/index.ts", "./client": "./src/client.ts" };

  it("2 つの exports を持つ hr-system を通し、それはモジュールではないこと", () => {
    const withHrSystem = repo(packageFiles("hr-system", { exports }, "driver"));
    expect(violations(withHrSystem)).toEqual([]);
    expect(modulePackageNames(new Tree(withHrSystem))).not.toContain("hr-system");
  });

  it.each([
    ["the contract only", { ".": "./src/index.ts" }],
    ["the client only", { "./client": "./src/client.ts" }],
    ["a path that is empty", { ".": "", "./client": "./src/client.ts" }],
    ["no exports", {}],
  ])("%s のある hr-system を拒否すること", (_, wrong) => {
    expect(violations(repo(packageFiles("hr-system", { exports: wrong }, "driver")))).toEqual(
      expect.arrayContaining([
        `packages/hr-system/package.json must have the exports ${JSON.stringify(exports)}, the contract (the types) and the entry of the ky client, and nothing else (docs/adr/0052, 0054).`,
      ]),
    );
  });

  it("どのモジュールにも依存してはならないこと", () => {
    expect(
      violations(
        repo(
          packageFiles(
            "hr-system",
            { exports, dependencies: { "@agent-software-factory/claim": "workspace:*" } },
            "driver",
          ),
        ),
      ),
    ).toEqual([
      expect.stringContaining(
        "packages/hr-system/package.json has @agent-software-factory/claim in dependencies.",
      ),
    ]);
  });
});

describe("ADR 0026: package.json が宣言しない package を、何も解決しないこと", () => {
  const violations = failuresOf(noResolutionBypass);
  const resolves = (path: string, what: string) =>
    `${path} ${what}, which lets a package resolve a package that its package.json does not declare. The direction between the modules rests on that not resolving (docs/adr/0026).`;
  // paths and alias also say what to write for `@/*`; baseUrl and the pnpm settings do not.
  const resolvesWithHint = (path: string, what: string) => `${resolves(path, what)} ${pathsHint}`;
  const workspace = base["pnpm-workspace.yaml"] ?? "";

  it.each(["paths", "baseUrl"])(
    "ルートまたは project で %s を設定する tsconfig.json を拒否すること",
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

  it("paths が自分の src/ の下のファイルだけを指す tsconfig.json を通すこと", () => {
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
  ])("paths に %s のある tsconfig.json を拒否すること", (_name, paths) => {
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
  ])("%s のある vite.config.ts を拒否すること", (_, line) => {
    expect(
      violations(repo({ "apps/web/vite.config.ts": `export default {\n  ${line}\n};\n` })),
    ).toEqual([resolvesWithHint("apps/web/vite.config.ts", "sets an alias")]);
  });

  it("alias の行のコメントより前にあるものを残すこと", () => {
    expect(
      violations(repo({ "apps/web/vite.config.ts": "export default {alias}// a comment\n" })),
    ).toEqual([resolvesWithHint("apps/web/vite.config.ts", "sets an alias")]);
  });

  it("キーではない alias という語と、長い名前のキーを通すこと", () => {
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
  ])("%s のある pnpm-workspace.yaml を拒否すること", (setting, what) => {
    expect(violations(repo({ "pnpm-workspace.yaml": `${workspace}${setting}\n` }))).toEqual([
      resolves("pnpm-workspace.yaml", what),
    ]);
  });

  it("packages/ の下の package を hoist するパターンを、そこにある package だけ拒否すること", () => {
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
  ])("%s のある pnpm-workspace.yaml を通すこと", (setting) => {
    expect(violations(repo({ "pnpm-workspace.yaml": `${workspace}${setting}\n` }))).toEqual([]);
  });
});

describe("ADR 0028: すべてのモジュールが Effect の lint を実行すること", () => {
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
  ])("%s のあるモジュールを拒否すること", (_, scripts) => {
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

  it("lint-effect の script のないモジュールを拒否し、shared には求めないこと", () => {
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

describe("ADR 0054: モジュールの src/ が index.ts、層、__fixtures__/ を持つこと", () => {
  const layerMessage = (path: string) =>
    `${path} is not a layer of a module. src/ holds index.ts, domain/, application/, infrastructure/, http/ and __fixtures__/: a file outside a layer is not under the rules of the layers, so move it into one (docs/adr/0054, docs/domain-model/package-layout.md).`;
  const violations = (files: Record<string, string>): string[] =>
    failuresOf(modulesHaveLayers)(repo(files));

  const claim = {
    "packages/claim/src/index.ts": "export {};\n",
    "packages/claim/src/domain/a.ts": "export {};\n",
    "packages/claim/src/application/a.ts": "export {};\n",
    "packages/claim/src/infrastructure/a.ts": "export {};\n",
    "packages/claim/src/http/a.ts": "export {};\n",
    "packages/claim/src/__fixtures__/a.ts": "export {};\n",
  };

  it("層を持つモジュールを通すこと", () => {
    expect(violations(claim)).toEqual([]);
  });

  it("層の外のファイルと層ではないディレクトリを、それぞれ 1 回ずつ拒否すること", () => {
    expect(
      violations({
        ...claim,
        "packages/claim/src/get-claim.ts": "export {};\n",
        "packages/claim/src/utils/a.ts": "export {};\n",
        "packages/claim/src/utils/b.ts": "export {};\n",
      }),
    ).toEqual([
      layerMessage("packages/claim/src/get-claim.ts"),
      layerMessage("packages/claim/src/utils/"),
    ]);
  });

  it("ほかの package を放っておくこと", () => {
    expect(violations({ ...claim, "packages/other/src/x.ts": "export {};\n" })).toEqual([]);
  });
});
