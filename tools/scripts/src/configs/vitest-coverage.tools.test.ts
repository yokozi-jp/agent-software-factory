// Process tests for vitest-coverage.ts with the real Vitest (`vp test run --coverage`, pinned in pnpm-workspace.yaml) and
// the real v8 provider, on a small workspace in a sandbox: apps/a, packages/b and packages/other. The merged coverage check
// (docs/adr/0053) is only as good as the records that the projects write, so this shows that the record of a project
// holds the files of another project that its tests ran, and nothing else outside its root. Reads vitest-coverage.ts of
// the workspace, an input of the test-tools target (package.json, "{workspaceRoot}/*.ts"). The table of the sandbox is not
// the real coverage-policy.json: it has the same keys (docs/adr/0053, #577) and entries on both sides of the project root.
import { cpSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { isObject } from "../checks/json.ts";
import {
  isMeasured,
  parseFileCoverage,
  parsePolicy,
  summarize,
} from "../checks/merged-coverage/rules.ts";
import { runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const workspace = join(import.meta.dirname, "../../../..");
const vp = join(workspace, "node_modules/.bin/vp");

// The table that the sandbox is checked with: `entries` are two files of apps/a (inside its root; a test loads one and not
// the other) and a file of packages/b that the tests of apps/a load (outside its root).
const table = {
  minimum: { lines: 90, branches: 90 },
  projects: ["apps/*", "packages/*"],
  notMeasured: ["**/*.test.{ts,tsx}"],
  entries: {
    "apps/a/src/main.ts": "starts apps/a",
    "apps/a/src/loaded.ts": "starts apps/a, and a test loads it",
    "packages/b/src/entry.ts": "starts packages/b",
    "packages/b/src/cmd/**": "commands that packages/b runs by hand",
  },
  exceptions: {},
};

let box: Sandbox;
let repo: string;
const put = (path: string, text: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};

// `vp test run --coverage` in a project of the sandbox, then its record: the covered lines of each file (as
// merged-coverage reads them), keyed by the path relative to the sandbox.
function record(project: string): {
  readonly status: number | null;
  readonly files: Record<string, number>;
} {
  const result = runIn(join(repo, project), vp, ["test", "run", "--coverage"], {
    timeout: 120_000,
  });
  const parsed: unknown = JSON.parse(
    readFileSync(join(repo, project, "coverage/coverage-final.json"), "utf8"),
  );
  if (!isObject(parsed)) throw new Error(`the record of ${project} is not an object`);
  const files = Object.fromEntries(
    Object.entries(parsed).map(([absolute, value]) => {
      const file = parseFileCoverage(value);
      if (file === undefined) throw new Error(`${absolute}: not in Istanbul's format`);
      return [relative(repo, absolute), summarize(file).lines.covered];
    }),
  );
  return { status: result.status, files };
}

beforeAll(() => {
  box = sandbox();
  // The characters that a glob reads are in the path of the checkout: the entries are escaped in the absolute patterns.
  repo = join(box.root, "repo [1] (a)");
  put("package.json", '{"type":"module"}');
  cpSync(join(workspace, "vitest-coverage.ts"), join(repo, "vitest-coverage.ts"));
  put("coverage-policy.json", JSON.stringify(table));
  // vitest-coverage.ts imports vite-plus, and the coverage provider is found from the root of the project.
  mkdirSync(join(repo, "node_modules/@vitest"), { recursive: true });
  symlinkSync(
    realpathSync(join(workspace, "node_modules/vite-plus")),
    join(repo, "node_modules/vite-plus"),
  );
  symlinkSync(
    realpathSync(join(workspace, "tools/scripts/node_modules/@vitest/coverage-v8")),
    join(repo, "node_modules/@vitest/coverage-v8"),
  );

  // apps/a: its tests run packages/b, and one of its own files is never loaded.
  put(
    "apps/a/vite.config.ts",
    'import { defineConfig } from "vite-plus";\nimport { recordCoverage } from "../../vitest-coverage.ts";\nexport default defineConfig({ test: { coverage: recordCoverage() } });\n',
  );
  put("apps/a/src/a.ts", "export const a = (): number => 1;\n");
  put("apps/a/src/unloaded.ts", "export const unloaded = (): number => 2;\n");
  put(
    "apps/a/src/a.test.ts",
    'import { expect, it } from "vite-plus/test";\nimport { used } from "../../../packages/b/src/b.ts";\nimport { entry } from "../../../packages/b/src/entry.ts";\nimport { run } from "../../../packages/b/src/cmd/run.ts";\nimport { a } from "./a.ts";\nimport { dotted } from "./.dotted.ts";\nimport { loaded } from "./loaded.ts";\nit("runs b", () => {\n  expect(used() + a() + entry() + loaded() + dotted() + run()).toBe(6);\n});\n',
  );
  put("apps/a/src/main.ts", "export const main = (): number => 4;\n");
  put("apps/a/src/loaded.ts", "export const loaded = (): number => 1;\n");
  // A name that starts with a dot: Vitest records it (dot: true), so the check has to count it.
  put("apps/a/src/.dotted.ts", "export const dotted = (): number => 1;\n");
  put("packages/b/src/entry.ts", "export const entry = (): number => 1;\n");
  put("packages/b/src/cmd/run.ts", "export const run = (): number => 1;\n");
  // packages/b: no test of its own, as the modules and the events packages have none.
  put(
    "packages/b/vite.config.ts",
    'import { recordOnlyConfig } from "../../vitest-coverage.ts";\nexport default recordOnlyConfig();\n',
  );
  put(
    "packages/b/src/b.ts",
    "export const used = (): number => 1;\nexport const unused = (): number => 2;\n",
  );
  // A project that no test of apps/a loads.
  put("packages/other/src/other.ts", "export const other = (): number => 3;\n");
});
afterAll(() => {
  box.remove();
});

describe("recordCoverage", { timeout: 120_000 }, () => {
  it("テストが実行した別の project のファイルと、どのテストも読み込まなかった自分のファイルを記録すること", () => {
    const { status, files } = record("apps/a");

    expect(status).toBe(0);
    // b.ts was run by the tests of apps/a, though it is outside the project root.
    expect(files["packages/b/src/b.ts"]).toBeGreaterThan(0);
    expect(files["apps/a/src/a.ts"]).toBeGreaterThan(0);
    expect(files["apps/a/src/unloaded.ts"]).toBe(0);
  });

  it("ほかには何も持たないこと: テストファイルも、入口も、ルートの外で実行されない project のファイルも持たない", () => {
    const { files } = record("apps/a");

    expect(Object.keys(files).toSorted()).toEqual([
      "apps/a/src/.dotted.ts",
      "apps/a/src/a.ts",
      "apps/a/src/unloaded.ts",
      "packages/b/src/b.ts",
    ]);
  });
});

describe("coverage-policy.json の表", { timeout: 120_000 }, () => {
  it("合わせた検査が数えるファイルだけを持つ記録を作ること", () => {
    const policy = parsePolicy(table);
    if (typeof policy === "string") throw new Error(policy);
    const files = [
      ...Object.keys(record("apps/a").files),
      ...Object.keys(record("packages/b").files),
    ];

    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((path) => !isMeasured(path, policy))).toEqual([]);
    // The files that the table leaves out are not counted by the check either, in the project and outside its root.
    for (const path of [
      "apps/a/src/main.ts",
      "apps/a/src/loaded.ts",
      "packages/b/src/entry.ts",
      "packages/b/src/cmd/run.ts",
      "apps/a/src/a.test.ts",
    ]) {
      expect(isMeasured(path, policy)).toBe(false);
    }
  });
});

describe("recordOnlyConfig", { timeout: 120_000 }, () => {
  it("テストのない project に 0% の記録を書いて通すこと", () => {
    const { status, files } = record("packages/b");

    expect(status).toBe(0);
    // entry.ts of the project is an entry, so it is not listed at 0%.
    expect(files).toEqual({ "packages/b/src/b.ts": 0 });
  });
});
