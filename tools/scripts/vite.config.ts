import { defineConfig } from "vite-plus";

// fixtures/ holds files that other checks read (lint fixtures and the like), not tests to run.
const exclude = ["**/node_modules/**", "**/fixtures/**"];

const isolationTest = "src/test/isolation.test.ts";

// The `test-unit` target (pre-commit) runs the unit project without isolation. src/test/isolation.ts is run only
// by the isolation project, so that run leaves it out of coverage; the `test` target counts it.
const withoutIsolation = process.env.SCRIPTS_TEST_WITHOUT_ISOLATION === "1";

// Stryker runs the tests that import the files it mutates, whatever their project, in a copy of this project
// where the paths up to the workspace root lead nowhere. The tools project reads the real workspace, so it
// stay out of its runs (it sets STRYKER_MUTATOR_WORKER in the processes that run the tests).
const underStryker = process.env.STRYKER_MUTATOR_WORKER !== undefined;

// Tests for the scripts and hooks in src/ (docs/tooling/ci.md ("スクリプトのテスト")), in three projects:
//   unit             `test` target: reads only the files of this project (fixtures), so Nx can cache it.
//   isolation        `test` target: runs the unit project in a child process under Git hook variables. Its
//                    own project, so that the child, which runs only `unit`, cannot start it again.
//   tools            `test-tools` target (*.tools.test.ts): runs a real tool on a real config of this
//                    repository. Each file it reads is an input of the target in package.json; CI runs it
//                    where mise is.
export default defineConfig({
  test: {
    // Clears the git variables a Git hook exports, before any test file loads (src/test/setup.ts).
    setupFiles: ["src/test/setup.ts"],
    // The process tests start node and git several times each. Vitest's default of 5 s was too short on a
    // loaded machine: on 2026-10-26, with a load average of 20, a test of check-adr-number took 7.2 s.
    testTimeout: 60_000,
    // beforeAll of isolation.ts makes a sandbox repository with several git commands. The default of 10 s was too
    // short on 2026-10-28, with a load average of 20 to 27 from other sessions: it failed two pre-commit runs.
    hookTimeout: 60_000,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: [...exclude, "src/**/*.tools.test.ts", isolationTest],
        },
      },
      { extends: true, test: { name: "isolation", include: [isolationTest] } },
      {
        extends: true,
        test: {
          name: "tools",
          include: underStryker ? [] : ["src/**/*.tools.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      // Every source file counts, so a new file without tests fails the per-file minimum.
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/fixtures/**",
        // Entry points: they only read argv, stdin and the environment, run git and print.
        // The process tests (cli.test.ts) run them as child processes, which coverage does not see.
        "src/**/cli.ts",
        ...(withoutIsolation ? ["src/test/isolation.ts"] : []),
      ],
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
