// The check of the coverage records (./coverage.ts), called alone on a small repository held in memory: a case breaks one file
// of a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { projectsWriteCoverage } from "./coverage.ts";
import { failuresOf, json, repo } from "./fixtures/repo.ts";
import {
  coverageConfig,
  coverageDevDependencies,
  coveragePolicy,
  coverageScripts,
  packageJson,
} from "./fixtures/passing-repo.ts";

describe("ADR 0053: コードのある各 project が coverage の記録を書くこと", () => {
  const violations = failuresOf(projectsWriteCoverage);
  const manifest = (fields: Record<string, unknown>) => ({
    "packages/claim/package.json": packageJson("claim", fields),
  });
  const testScriptMessage = (path: string, project: string) =>
    `${path} must have a test script that starts with "vp test run" and has --coverage, as one command, so that ${project} writes coverage/coverage-final.json and the merged check counts its files (docs/adr/0053, docs/tooling/ci.md).`;
  const providerMessage = (path: string) =>
    `${path} must have @vitest/coverage-v8 in devDependencies ("catalog:"), the provider that writes the record (docs/adr/0053).`;
  const configMessage = (path: string, project: string) =>
    `${path} must import recordCoverage or recordOnlyConfig from vitest-coverage.ts and use it as the default export or in \`coverage\`, so that ${project} writes its record (docs/adr/0053).`;

  it("コードのあるすべての project が記録を書くリポジトリを通すこと", () => {
    expect(violations(repo())).toEqual([]);
  });

  describe("test の script", () => {
    it.each([
      "vp test run --coverage",
      'vp test run --coverage --exclude "**/__fixtures__/**"',
      "vp test run --exclude x --coverage",
      "vp test run\t--coverage",
      "vp test run --coverage --coverage.include=src/**/*.ts",
      "vp test run --coverage --coverage.enabled=true",
      "vp  test   run  --coverage",
      "vp test run --coverage --exclude=--no-coverage",
      "vp test run --coverage --no-coverage-reporter",
      "vp test run --coverage --coverage.enabled=falsey",
    ])("%j を通すこと", (script) => {
      expect(violations(repo(manifest({ scripts: { test: script } })))).toEqual([]);
    });

    it.each([
      "vp test run",
      "vp test",
      "vp test --coverage",
      "vitest run --coverage",
      "vp test run --coverage=false",
      "vp test run --coverage.enabled",
      "vp test run --no-coverage",
      "vp test run --coverage-x",
      "vp test runx --coverage",
      "pnpm exec vp test run --coverage",
      "vp test run && echo --coverage",
      "vp test run # --coverage",
      "vp test run; echo --coverage",
      "vp test run | tee --coverage",
      "vp test run $(echo --coverage)",
      "vp test run `echo --coverage`",
      "vp test run > --coverage",
      "vp test run\n--coverage",
      "vp test run --coverage --no-coverage",
      "vp test run --coverage --coverage=false",
      "vp test run --coverage --coverage.enabled=false",
    ])("%j の test の script を挙げること", (script) => {
      expect(violations(repo(manifest({ scripts: { test: script } })))).toEqual([
        testScriptMessage("packages/claim/package.json", "packages/claim"),
      ]);
    });

    it.each([{ scripts: {} }, { scripts: { test: 1 } }, { scripts: undefined }])(
      "%j の package.json を挙げること",
      (fields) => {
        expect(violations(repo(manifest(fields)))).toEqual([
          testScriptMessage("packages/claim/package.json", "packages/claim"),
        ]);
      },
    );
  });

  describe("provider", () => {
    it("devDependencies に @vitest/coverage-v8 のない package を挙げること", () => {
      expect(violations(repo(manifest({ devDependencies: {} })))).toEqual([
        providerMessage("packages/claim/package.json"),
      ]);
    });

    it("dependencies の @vitest/coverage-v8 を dev 依存と取り違えないこと", () => {
      expect(
        violations(
          repo(manifest({ devDependencies: undefined, dependencies: coverageDevDependencies })),
        ),
      ).toEqual([providerMessage("packages/claim/package.json")]);
    });
  });

  describe("vite.config.ts", () => {
    const withConfig = (source: string | undefined) => ({
      "packages/claim/vite.config.ts": source,
    });
    const importOf = (name: string) => `import { ${name} } from "../../vitest-coverage.ts";\n`;

    it.each([
      `${importOf("recordOnlyConfig")}export default recordOnlyConfig();`,
      `${importOf("recordOnlyConfig")}export default recordOnlyConfig("src/**/*.{ts,tsx}");`,
      `${importOf("recordOnlyConfig")}export default  recordOnlyConfig();`,
      'import{ recordOnlyConfig } from "../../vitest-coverage.ts";\nexport default recordOnlyConfig();',
      'import { recordOnlyConfig }from "../../vitest-coverage.ts";\nexport default recordOnlyConfig();',
      'import { recordOnlyConfig } from"../../vitest-coverage.ts";\nexport default recordOnlyConfig();',
      `${importOf("recordCoverage")}export default defineConfig({ test: { coverage: { ...recordCoverage({ own: "src/**/*.ts" }) } } });`,
      `${importOf("recordCoverage")}export default { include: ["src/**/*.ts"], test: { coverage: recordCoverage() } };`,
      `${importOf("recordCoverage")}export default { test: { coverage:\n recordCoverage() } };`,
      `import { ownFilesMinimum, recordCoverage } from "../../vitest-coverage.ts";\nexport default { test: { coverage: { ...recordCoverage(), thresholds: ownFilesMinimum } } };`,
      `import {\n  recordCoverage,\n} from '../../vitest-coverage.ts';\nexport default { test: { coverage: { ...recordCoverage() } } };`,
      `import { recordOnlyConfig } from "../../../vitest-coverage.ts";\nexport default recordOnlyConfig();`,
    ])("%j を通すこと", (source) => {
      expect(violations(repo(withConfig(source)))).toEqual([]);
    });

    it("vite.config.ts のない package を挙げること", () => {
      expect(violations(repo(withConfig(undefined)))).toEqual([
        configMessage("packages/claim/vite.config.ts", "packages/claim"),
      ]);
    });

    it.each([
      "export default {};",
      "export default defineConfig({ test: { passWithNoTests: true } });",
      // The import without the call, and the call without the import.
      `${importOf("recordCoverage")}export default {};`,
      "export default recordOnlyConfig();",
      // Another name, another file, or a name that only contains the helper's.
      `${importOf("recordCoverageOf")}export default recordCoverageOf();`,
      `${importOf("recordOnlyConfig")}export default myrecordOnlyConfig();`,
      'import { recordOnlyConfig } from "./other.ts";\nexport default recordOnlyConfig();',
      'import { recordOnlyConfig } from "vitest-coverage.ts";\nexport default recordOnlyConfig();',
      'import { recordOnlyConfig } from "../../vitest-coverage.js";\nexport default recordOnlyConfig();',
      // The helper without a call, and a call whose result is dropped.
      `${importOf("recordOnlyConfig")}export default recordOnlyConfig;`,
      `${importOf("recordCoverage")}recordCoverage();\nexport default { test: { coverage: { enabled: false } } };`,
      `${importOf("recordCoverage")}const options = recordCoverage();\nexport default {};`,
    ])("%j の vite.config.ts を挙げること", (source) => {
      expect(violations(repo(withConfig(source)))).toEqual([
        configMessage("packages/claim/vite.config.ts", "packages/claim"),
      ]);
    });
  });

  describe("coverage-policy.json の表", () => {
    const bare = { "packages/bare/package.json": json({ name: "bare" }) };

    it("表が除かないファイルをコードと見なし、除いたファイルは見なさないこと", () => {
      const policy = (fields: object) => ({
        "coverage-policy.json": json({ ...coveragePolicy, ...fields }),
        ...bare,
        "packages/bare/src/server.ts": "export {};\n",
      });
      expect(violations(repo(policy({})))).toEqual([
        testScriptMessage("packages/bare/package.json", "packages/bare"),
        providerMessage("packages/bare/package.json"),
        configMessage("packages/bare/vite.config.ts", "packages/bare"),
      ]);
      expect(
        violations(repo(policy({ entries: { "packages/bare/src/server.ts": "entry" } }))),
      ).toEqual([]);
      expect(violations(repo(policy({ notMeasured: ["**/server.ts"] })))).toEqual([]);
    });

    it("projects の directory を、記録を書く場所と見なすこと", () => {
      expect(
        violations(
          repo({
            "coverage-policy.json": json({ ...coveragePolicy, projects: ["apps/*"] }),
            ...bare,
            "packages/bare/src/index.ts": "export {};\n",
          }),
        ),
      ).toEqual([]);
    });

    it("workspace が挙げていない projects の directory を指摘すること", () => {
      const message = (glob: string) =>
        `pnpm-workspace.yaml must list "${glob}" in packages, as coverage-policy.json does in projects: a directory that is not a workspace package is not run by Nx, so it writes no coverage record (docs/adr/0053).`;
      expect(
        violations(
          repo({
            "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - tools/*\n",
          }),
        ),
      ).toEqual([message("packages/*"), message("packages/*/events")]);
      expect(violations(repo({ "pnpm-workspace.yaml": "catalog: {}\n" }))).toHaveLength(3);
      expect(
        violations(
          repo({
            "coverage-policy.json": json({ ...coveragePolicy, projects: ["apps/*"] }),
            "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
          }),
        ),
      ).toEqual([]);
    });

    it("表のない repository を指摘すること", () => {
      expect(violations(repo({ "coverage-policy.json": undefined }))).toEqual([
        "coverage-policy.json is missing (docs/adr/0053).",
      ]);
    });

    it("読めない表を、tree と同じく 1 回だけ報告すること", () => {
      expect(violations(repo({ "coverage-policy.json": "{" }))).toEqual([
        expect.stringContaining("coverage-policy.json is not valid JSON"),
      ]);
    });

    it("形の合わない表を指摘すること", () => {
      expect(violations(repo({ "coverage-policy.json": json({ minimum: {} }) }))).toEqual([
        "coverage-policy.json: minimum needs numbers for lines and branches",
      ]);
    });
  });

  describe("読む project", () => {
    const bare = (project: string) => ({
      [`${project}/package.json`]: json({ name: project }),
      [`${project}/src/index.ts`]: "export {};\n",
    });

    it.each([
      ["packages/ui", "packages/ui/src/components/button.tsx"],
      ["apps/web", "apps/web/src/main.tsx"],
      ["packages/other/events", "packages/other/events/src/schema.ts"],
    ])("%s を %s 経由で読むこと", (project, file) => {
      expect(
        violations(repo({ [`${project}/package.json`]: json({ name: project }), [file]: "x" })),
      ).toEqual([
        testScriptMessage(`${project}/package.json`, project),
        providerMessage(`${project}/package.json`),
        configMessage(`${project}/vite.config.ts`, project),
      ]);
    });

    it("project を順に、それぞれの失敗とともに挙げること", () => {
      expect(
        violations(
          repo({
            ...bare("packages/zeta"),
            ...bare("apps/alpha"),
            ...bare("packages/zeta/events"),
          }),
        ).map((failure) => failure.split(" ")[0]),
      ).toEqual([
        "apps/alpha/package.json",
        "apps/alpha/package.json",
        "apps/alpha/vite.config.ts",
        "packages/zeta/package.json",
        "packages/zeta/package.json",
        "packages/zeta/vite.config.ts",
        "packages/zeta/events/package.json",
        "packages/zeta/events/package.json",
        "packages/zeta/events/vite.config.ts",
      ]);
    });

    it.each([
      "packages/bare/src/__fixtures__/a.ts",
      "packages/bare/src/a.test.ts",
      "packages/bare/src/a.test.tsx",
      "packages/bare/src/a.d.ts",
      "packages/bare/src/a.gen.ts",
      "packages/bare/src/a.stories.tsx",
      "packages/bare/src/data.json",
      "packages/bare/test/a.ts",
      "packages/bare/lib/a.ts",
      "packages/bare/events/test/a.ts",
    ])("唯一のファイルが %s である project を読まないこと", (file) => {
      expect(
        violations(repo({ "packages/bare/package.json": json({ name: "bare" }), [file]: "x" })),
      ).toEqual([]);
    });

    it("package.json のない directory を読まないこと", () => {
      expect(violations(repo({ "packages/unnamed/src/index.ts": "export {};\n" }))).toEqual([]);
    });

    it("apps と packages の外のコードを読まないこと", () => {
      expect(
        violations(
          repo({
            "tools/lib/package.json": json({ name: "lib" }),
            "tools/lib/src/index.ts": "export {};\n",
            "packages/nested/deep/package.json": json({ name: "deep" }),
            "packages/nested/deep/src/index.ts": "export {};\n",
          }),
        ),
      ).toEqual([]);
    });

    it("src/events directory のファイルの project を、その events package ではなく package とすること", () => {
      expect(
        violations(
          repo({
            "packages/solo/package.json": json({
              name: "solo",
              scripts: coverageScripts,
              devDependencies: coverageDevDependencies,
            }),
            "packages/solo/vite.config.ts": coverageConfig,
            "packages/solo/src/events/schema.ts": "export {};\n",
          }),
        ),
      ).toEqual([]);
    });
  });
});
