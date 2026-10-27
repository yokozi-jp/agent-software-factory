import { defineConfig } from "vite-plus";

// The tests of the Oxlint plugins in src/ (docs/adr/0030). The plugins are used by the root vite.config.ts, so
// they belong to no app: any app or package can turn a rule on. Each test runs the rules of one plugin with
// Oxlint's RuleTester.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Every plugin counts, so a new plugin without tests fails the per-file minimum.
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        // A fixed minimum for every file (#30).
        perFile: { lines: 90, branches: 90 },
        // The totals only go up: a run with better coverage writes the new, floored values here.
        autoUpdate: (newThreshold: number) => Math.floor(newThreshold),
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
