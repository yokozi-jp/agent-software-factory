// The real Knip (`pnpm lint:unused`) with the knip.jsonc of this repository, on a sandboxed copy of the files
// that Knip reads. Each case adds one unused thing and expects the check to fail; the untouched copy passes.
// The copy links to the node_modules of the workspace and of its projects (pnpm install).
// Reads, in the workspace, the inputs of the test-tools target (tools/scripts/package.json): the root files
// that Knip or the plugins of Knip read, .github/workflows/ and .kiro/settings/mcp.json. The apps are small ones
// written below, not the real ones. So are the modules that knip.jsonc names.
// tools/ is this project. The Knip version is pinned in pnpm-workspace.yaml (`sharedGlobals`).
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const workspace = join(import.meta.dirname, "../../../..");
const knipBin = join(workspace, "node_modules/.bin/knip");
// What Knip reads outside the code of the projects: the root files below and the root code files, which name the
// workspace, the entries and the dependencies (lefthook.yml, nx.json and the others are read by its plugins).
const rootFiles = [
  ".gitignore",
  ".markdownlint-cli2.yaml",
  "knip.jsonc",
  "lefthook.yml",
  "mise.toml",
  "nx.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
];
const rootCode = /^[^.].*\.(js|cjs|mjs|jsx|ts|cts|mts|tsx)$/;
const folders = ["tools", ".github/workflows", ".kiro/settings/mcp.json"];
// Not copied: what git ignores, which Knip does not read either.
const skipped = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".stryker-tmp",
  "reports",
  ".tanstack",
]);

// The apps of the copy. knip.jsonc names apps/api (its entries src/index.ts and src/server.ts, and the dependencies
// it keeps) and the workspaces of pnpm-workspace.yaml; small apps written here take the place of the real ones, so
// that a change to the code of the apps does not make the tools tests run (docs/tooling/ci.md).
const sdkClients = [
  "@aws-sdk/client-eventbridge",
  "@aws-sdk/client-lambda",
  "@aws-sdk/client-ses",
  "@aws-sdk/client-sesv2",
  "@aws-sdk/client-sfn",
  "@aws-sdk/client-sns",
  "@aws-sdk/client-sqs",
];
const apps: Record<string, string> = {
  "apps/api/package.json": JSON.stringify(
    {
      name: "@agent-software-factory/api",
      private: true,
      type: "module",
      scripts: { check: "vp check" },
      dependencies: { "@hono/node-server": "catalog:", hono: "catalog:" },
      devDependencies: { "vite-plus": "catalog:" },
      nx: { name: "api" },
    },
    undefined,
    2,
  ),
  "apps/api/src/app.ts": 'import { Hono } from "hono";\n\nexport const app = new Hono();\n',
  "apps/api/src/index.ts": 'import { app } from "./app.ts";\n\nexport default app;\n',
  "apps/api/src/server.ts":
    'import { serve } from "@hono/node-server";\nimport { app } from "./app.ts";\n\nserve({ fetch: app.fetch });\n',
  "apps/web/package.json": JSON.stringify(
    {
      name: "@agent-software-factory/web",
      private: true,
      type: "module",
      scripts: { check: "vp check" },
      devDependencies: { "vite-plus": "catalog:" },
      nx: { name: "web" },
    },
    undefined,
    2,
  ),
  "apps/web/src/main.ts": 'export const title = "web";\n',
  // The Vite plugin of Knip reads the entry from index.html, as it does in the real app. Naming entries in
  // knip.jsonc (below) takes the default entries away, so main.ts needs this link.
  "apps/web/index.html":
    '<!doctype html>\n<html lang="en">\n  <body>\n    <script type="module" src="/src/main.ts"></script>\n  </body>\n</html>\n',
  // packages/ui and the files knip.jsonc names as entries of it (the parts `shadcn add` writes, docs/adr/0033,
  // 0034). Nothing imports them; as entries, their exports are not reported.
  "packages/ui/package.json": JSON.stringify(
    {
      name: "@agent-software-factory/ui",
      private: true,
      type: "module",
      exports: { "./components/*": "./src/components/*.tsx", "./lib/*": "./src/lib/*.ts" },
      scripts: { check: "vp check" },
      devDependencies: { "vite-plus": "catalog:" },
      nx: { name: "ui" },
    },
    undefined,
    2,
  ),
  "packages/ui/src/components/button.tsx": 'export const Button = "button";\n',
  "packages/ui/src/lib/utils.ts": 'export const cn = (...names: string[]) => names.join(" ");\n',
  // A detection-power fixture of the module boundaries, which nothing imports (ignoreFiles in knip.jsonc).
  "apps/api/src/__fixtures__/boundaries.ts":
    '// oxlint-disable-next-line no-restricted-imports -- fixture\nimport "../../../../packages/x/src/index.ts";\n',
  // The fixture of the entry files and the tests: a *.test.ts file, which Knip reads even in __fixtures__/, and which
  // imports the SDK clients that no-restricted-imports stops. The app depends on none of them, so knip.jsonc keeps
  // them in ignoreDependencies of apps/api; without the file, Knip would report those entries as unused.
  "apps/api/src/__fixtures__/bypass.test.ts": sdkClients
    .map((name) => `import "${name}";\n`)
    .join(""),
};

// The packages in the shape of a module, which depend on effect: the modules import it in infrastructure/transaction.ts
// (the Tx tag), so knip.jsonc does not list them; module-fixtures, whose fixtures alone import it, is listed.
const modules = ["claim", "approval", "closing", "module-fixtures"];
for (const name of modules) {
  apps[`packages/${name}/package.json`] = JSON.stringify(
    {
      name: `@agent-software-factory/${name}`,
      private: true,
      type: "module",
      exports: { ".": "./src/index.ts" },
      // lint-effect is what uses @effect/tsgo, a dependency of the root.
      scripts: { check: "vp check", "lint-effect": "effect-tsgo oxlint --type-aware" },
      dependencies: { effect: "catalog:" },
      devDependencies: { "vite-plus": "catalog:" },
      nx: { name },
    },
    undefined,
    2,
  );
  apps[`packages/${name}/src/index.ts`] =
    name === "module-fixtures" ? "export {};\n" : 'import type {} from "effect";\nexport {};\n';
}

// The events package of each module (docs/adr/0026): a workspace of its own, which Knip reads like the modules.
for (const name of modules.filter((module) => module !== "module-fixtures")) {
  apps[`packages/${name}/events/package.json`] = JSON.stringify(
    {
      name: `@agent-software-factory/${name}-events`,
      private: true,
      type: "module",
      exports: { ".": "./src/index.ts" },
      scripts: { check: "vp check" },
      devDependencies: { "vite-plus": "catalog:" },
      nx: { name: `${name}-events` },
    },
    undefined,
    2,
  );
  apps[`packages/${name}/events/src/index.ts`] = "export {};\n";
}

// packages/db and the modules knip.jsonc lists in its ignoreDependencies (docs/adr/0038): db depends on them for types, and
// only its fixtures import them, which Knip does not read. claim is the exception: a test of db imports it (the type
// test of the generated types), so knip.jsonc does not list it, and the fixture imports it from a file that Knip reads.
apps["packages/db/package.json"] = JSON.stringify(
  {
    name: "@agent-software-factory/db",
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts" },
    scripts: { check: "vp check" },
    devDependencies: {
      ...Object.fromEntries(
        ["claim", "approval", "closing"].map((name) => [
          `@agent-software-factory/${name}`,
          "workspace:*",
        ]),
      ),
      "vite-plus": "catalog:",
    },
    nx: { name: "db" },
  },
  undefined,
  2,
);
apps["packages/db/src/index.ts"] =
  'import type {} from "@agent-software-factory/claim";\nexport {};\n';
// packages/i18n and the config of i18next-cli that knip.jsonc names as its entry (docs/adr/0044). Nothing imports the
// config; the i18n-keys script runs it with --config.
apps["packages/i18n/package.json"] = JSON.stringify(
  {
    name: "@agent-software-factory/i18n",
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts" },
    scripts: { check: "vp check" },
    devDependencies: { "vite-plus": "catalog:" },
    nx: { name: "i18n" },
  },
  undefined,
  2,
);
apps["packages/i18n/src/index.ts"] = "export {};\n";
apps["packages/i18n/i18next.config.ts"] = "export default {};\n";
// A file of the trees that the detection-power test of the key check runs the CLI on (ignoreFiles in knip.jsonc).
apps["packages/i18n/test/__fixtures__/keys/complete/apps/web/src/screen.tsx"] = "export {};\n";

let box: Sandbox;
let copy: string;

const put = (path: string, text: string): void => {
  mkdirSync(dirname(join(copy, path)), { recursive: true });
  writeFileSync(join(copy, path), text);
};

// The root files and the folders above, and the apps, in `copy`.
function populate(): void {
  mkdirSync(copy, { recursive: true });
  for (const name of readdirSync(workspace))
    if (rootFiles.includes(name) || rootCode.test(name))
      cpSync(join(workspace, name), join(copy, name));
  for (const folder of folders)
    if (existsSync(join(workspace, folder)))
      cpSync(join(workspace, folder), join(copy, folder), {
        recursive: true,
        filter: (source) => !skipped.has(basename(source)),
      });
  for (const [path, text] of Object.entries(apps)) put(path, text);
  symlinkSync(join(workspace, "node_modules"), join(copy, "node_modules"));
  for (const project of [
    "apps/api",
    "apps/web",
    "packages/ui",
    "packages/db",
    "packages/i18n",
    "tools/scripts",
    ...modules.map((name) => `packages/${name}`),
  ])
    symlinkSync(join(workspace, project, "node_modules"), join(copy, project, "node_modules"));
}

// --exclude catalog: the pnpm catalog lists what the real apps use, and the small apps use only some of it.
const knip = () => {
  const result = runIn(copy, knipBin, ["--no-progress", "--exclude", "catalog"]);
  return { status: result.status, output: result.stdout + result.stderr };
};
const edit = (path: string, change: (text: string) => string): void => {
  writeFileSync(join(copy, path), change(readFileSync(join(copy, path), "utf8")));
};

beforeAll(() => {
  box = sandbox();
  copy = join(box.root, "copy");
});
afterAll(() => {
  box.remove();
});
beforeEach(() => {
  rmSync(copy, { recursive: true, force: true });
  populate();
}, 120_000);

describe("Knip with knip.jsonc", () => {
  it("passes on the configuration of this repository and small apps", () => {
    expect(knip()).toMatchObject({ status: 0 });
  }, 120_000);

  // Each case below also names what Knip reports, so that it cannot pass on an unrelated finding.
  it("reports an export nothing imports", () => {
    appendFileSync(join(copy, "apps/api/src/app.ts"), "export const unusedValue = 1;\n");
    const result = knip();
    expect(result.status).toBe(1);
    expect(result.output).toContain("unusedValue");
  }, 120_000);

  it("reports a file nothing imports", () => {
    put("apps/web/src/orphan.ts", "export const orphan = 1;\n");
    const result = knip();
    expect(result.status).toBe(1);
    expect(result.output).toContain("apps/web/src/orphan.ts");
  }, 120_000);

  it("reports a dependency the project does not use", () => {
    edit("apps/web/package.json", (text) =>
      text.replace('"vite-plus": "catalog:"', '"vite-plus": "catalog:", "jscpd": "catalog:"'),
    );
    const result = knip();
    expect(result.status).toBe(1);
    expect(result.output).toContain("jscpd");
  }, 120_000);

  // treatConfigHintsAsErrors: an exception that is no longer needed fails, so it gets removed.
  it("reports an ignoreDependencies entry for a dependency that is used", () => {
    edit("knip.jsonc", (text) =>
      // apps/api already has an ignoreDependencies (the SDK clients of the fixture of the entry files); add to it.
      text.replace(
        '"ignoreDependencies": [\n        "@aws-sdk/client-eventbridge",',
        '"ignoreDependencies": [\n        "hono",\n        "@aws-sdk/client-eventbridge",',
      ),
    );
    const result = knip();
    expect(result.status).toBe(1);
    expect(result.output).toContain("hono");
  }, 120_000);

  // An export tagged @public is kept on purpose (docs/adr/0017).
  it("passes an unused export tagged @public", () => {
    appendFileSync(
      join(copy, "apps/api/src/app.ts"),
      "/** @public */\nexport const keptValue = 1;\n",
    );
    expect(knip()).toMatchObject({ status: 0 });
  }, 120_000);

  // The agent skills under .agents/ are installed from upstream and are not this repository's code.
  it("ignores a file under .agents/", () => {
    put(".agents/skills/example/unused.cjs", "module.exports = {};\n");
    expect(knip()).toMatchObject({ status: 0 });
  }, 120_000);
});
