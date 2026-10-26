// Mutation testing of the pure functions in src/ (#136, #30). Run by the `mutation` target.
export default {
  testRunner: "vitest",
  // pnpm does not hoist the plugins, so the default "@stryker-mutator/*" glob finds none.
  plugins: ["@stryker-mutator/vitest-runner"],
  // TypeScript 7 has no parseConfigFileTextToJson, which Stryker's tsconfig preprocessor calls.
  tsconfigFile: "",
  // Pure functions only: not the entry points that the process tests run, nor the test helpers.
  mutate: [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/**/cli.ts",
    "!src/test/**",
    "!src/**/fixtures/**",
  ],
  // Reuses the results in incrementalFile for the mutants and tests that did not change.
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  reporters: ["clear-text", "progress"],
  // break is the score measured when the target was added (#30): every mutant of rules.ts was killed.
  thresholds: { high: 100, low: 90, break: 100 },
};
