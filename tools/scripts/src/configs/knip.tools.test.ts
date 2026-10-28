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
  // The files knip.jsonc names as entries of apps/web (the parts `shadcn add` writes, docs/adr/0033). Nothing
  // imports them; as entries, their exports are not reported.
  "apps/web/src/components/ui/button.tsx": 'export const Button = "button";\n',
  "apps/web/src/lib/utils.ts": 'export const cn = (...names: string[]) => names.join(" ");\n',
  // A detection-power fixture of the module boundaries, which nothing imports (ignoreFiles in knip.jsonc).
  "apps/api/src/__fixtures__/boundaries.ts":
    '// oxlint-disable-next-line no-restricted-imports -- fixture\nimport "../../../../packages/x/src/index.ts";\n',
};

// The packages in the shape of a module named in knip.jsonc, which depend on effect before their application/ and
// infrastructure/ import it: the modules, and module-fixtures, whose fixtures alone import it.
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
  apps[`packages/${name}/src/index.ts`] = "export {};\n";
}

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
      text.replace('"apps/api": {', '"apps/api": { "ignoreDependencies": ["hono"],'),
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
