import { defineConfig } from "vite-plus";

// The tests of migrate and of the type generation run against a real PostgreSQL. globalSetup starts one container for
// all the tests and runs the migrations on a template database that createTestDatabase copies (docs/adr/0025).
// vitest hides a failure of globalSetup behind `code.charCodeAt is not a function` (see apps/api/vite.config.ts), so
// when the tests fail to start, suspect the container.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // __fixtures__/ shows that the lint rules are on; it is not a test (docs/adr/0037).
    exclude: ["**/node_modules/**", "**/__fixtures__/**"],
    globalSetup: ["./test/global-setup.ts"],
    hookTimeout: 240_000,
    testTimeout: 60_000,
    // The strength of the tests (#30, docs/tooling/ci.md ("coverage の下限")).
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "src/__fixtures__/**",
        // The `./seed` export of package.json, with no code yet. Issue #332 writes the seed and its tests; remove this
        // entry then.
        "src/seed/**",
      ],
      // A fixed minimum for every file, as in apps/api (#30). The totals that apps/api ratchets up are not set here.
      thresholds: { perFile: { lines: 90, branches: 90 } },
    },
  },
});
