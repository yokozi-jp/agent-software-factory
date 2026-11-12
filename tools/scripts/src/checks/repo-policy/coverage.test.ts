// The check of the coverage records (./coverage.ts), called alone on a small repository held in memory: a case breaks one file
// of a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { projectsWriteCoverage } from "./coverage.ts";
import { failuresOf, json, repo } from "./fixtures/repo.ts";
import {
  coverageConfig,
  coverageDevDependencies,
  coverageScripts,
  packageJson,
} from "./fixtures/passing-repo.ts";

describe("ADR 0053: each project with code writes a coverage record", () => {
  const violations = failuresOf(projectsWriteCoverage);
  const manifest = (fields: Record<string, unknown>) => ({
    "packages/claim/package.json": packageJson("claim", fields),
  });
  const testScriptMessage = (path: string, project: string) =>
    `${path} must have a test script that runs "vp test run" with --coverage, so that ${project} writes coverage/coverage-final.json and the merged check counts its files (docs/adr/0053, docs/tooling/ci.md).`;
  const providerMessage = (path: string) =>
    `${path} must have @vitest/coverage-v8 in devDependencies ("catalog:"), the provider that writes the record (docs/adr/0053).`;
  const configMessage = (path: string, project: string) =>
    `${path} must call recordCoverage or recordOnlyConfig of vitest-coverage.ts, so that ${project} writes its record (docs/adr/0053).`;

  it("passes a repository where every project with code writes its record", () => {
    expect(violations(repo())).toEqual([]);
  });

  describe("the test script", () => {
    it.each([
      "vp test run --coverage",
      'vp test run --coverage --exclude "**/__fixtures__/**"',
      "vp test run --exclude x --coverage",
      "vp test run\t--coverage",
    ])("passes %j", (script) => {
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
    ])("names a test script of %j", (script) => {
      expect(violations(repo(manifest({ scripts: { test: script } })))).toEqual([
        testScriptMessage("packages/claim/package.json", "packages/claim"),
      ]);
    });

    it.each([{ scripts: {} }, { scripts: { test: 1 } }, { scripts: undefined }])(
      "names a package.json with %j",
      (fields) => {
        expect(violations(repo(manifest(fields)))).toEqual([
          testScriptMessage("packages/claim/package.json", "packages/claim"),
        ]);
      },
    );
  });

  describe("the provider", () => {
    it("names a package that does not have @vitest/coverage-v8 in devDependencies", () => {
      expect(violations(repo(manifest({ devDependencies: {} })))).toEqual([
        providerMessage("packages/claim/package.json"),
      ]);
    });

    it("does not take @vitest/coverage-v8 in dependencies for the dev dependency", () => {
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

    it.each([
      "export default recordOnlyConfig();",
      'export default defineConfig({ test: { coverage: { ...recordCoverage({ own: "src/**/*.ts" }) } } });',
      'export default { include: ["src/**/*.ts"], ...recordOnlyConfig() };',
    ])("passes %j", (source) => {
      expect(violations(repo(withConfig(source)))).toEqual([]);
    });

    it("names a package without a vite.config.ts", () => {
      expect(violations(repo(withConfig(undefined)))).toEqual([
        configMessage("packages/claim/vite.config.ts", "packages/claim"),
      ]);
    });

    it.each([
      "export default {};",
      "export default defineConfig({ test: { passWithNoTests: true } });",
      "import { recordCoverage } from './x.ts';\nexport default {};",
      "export default recordCoverageOf();",
      "export default myrecordOnlyConfig();",
      "export default recordOnlyConfig;",
    ])("names a vite.config.ts of %j", (source) => {
      expect(violations(repo(withConfig(source)))).toEqual([
        configMessage("packages/claim/vite.config.ts", "packages/claim"),
      ]);
    });
  });

  describe("which projects it reads", () => {
    const bare = (project: string) => ({
      [`${project}/package.json`]: json({ name: project }),
      [`${project}/src/index.ts`]: "export {};\n",
    });

    it.each([
      ["packages/ui", "packages/ui/src/components/button.tsx"],
      ["apps/web", "apps/web/src/main.tsx"],
      ["packages/other/events", "packages/other/events/src/schema.ts"],
    ])("reads %s through %s", (project, file) => {
      expect(
        violations(repo({ [`${project}/package.json`]: json({ name: project }), [file]: "x" })),
      ).toEqual([
        testScriptMessage(`${project}/package.json`, project),
        providerMessage(`${project}/package.json`),
        configMessage(`${project}/vite.config.ts`, project),
      ]);
    });

    it("names the projects in order, each with its own failures", () => {
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
    ])("does not read a project whose only file is %s", (file) => {
      expect(
        violations(repo({ "packages/bare/package.json": json({ name: "bare" }), [file]: "x" })),
      ).toEqual([]);
    });

    it("does not read a directory with no package.json", () => {
      expect(violations(repo({ "packages/unnamed/src/index.ts": "export {};\n" }))).toEqual([]);
    });

    it("does not read the code outside apps and packages", () => {
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

    it("takes the project of a file in a src/events directory to be the package, not its events package", () => {
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
