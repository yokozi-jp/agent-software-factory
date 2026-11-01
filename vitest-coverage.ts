import { defineConfig } from "vite-plus";

// The `coverage` options that every project's vite.config.ts shares, so that each project writes a record
// (coverage/coverage-final.json) which the merged check in CI adds up with the others (docs/adr/0053,
// docs/tooling/ci.md ("coverage の下限")).
//
// The record holds the files of the project (`own`, relative to the project) and the files of the other projects that its
// tests ran (shared-kernel, a module's infrastructure, ui): `allowExternal` lets Vitest report a file outside the
// project root, and the second pattern of `include` matches it by its absolute path, whichever project it is in. No
// project lists the others by hand, so a new directory or package is not missed. Vitest lists the files that no test
// loaded (at 0%) only under the project root, so the record does not hold the files of unrelated projects.
//
// `exclude` has what is never measured (the same list as `isMeasured` in tools/scripts/src/checks/merged-coverage/rules.ts)
// and the entry files of the project, which only its own minimum needs (`thresholds["src/**"]`): the merged check reads
// the exceptions from coverage-policy.json.
export function recordCoverage({
  own = "src/**/*.ts",
  exclude = [],
}: {
  readonly own?: string;
  readonly exclude?: readonly string[];
} = {}) {
  return {
    provider: "v8" as const,
    allowExternal: true,
    include: [own, "**/{apps,packages}/*/{,events/}src/**/*.{ts,tsx}"],
    exclude: [
      "**/*.test.{ts,tsx}",
      "**/__fixtures__/**",
      "**/*.gen.ts",
      "**/*.d.ts",
      "**/*.stories.tsx",
      ...exclude,
    ],
  };
}

// The minimum of each file of the project's own `src`, for projects without the ratchet of the totals (apps/api, apps/web and
// tools/scripts have it). Only the own `src` has it: the other projects' files in the record are checked by the merged check.
export const ownFilesMinimum = { "src/**": { perFile: { lines: 90, branches: 90 } } };

// The vite.config.ts of a project that has no minimum of its own and only writes its record: the modules (their code is run by
// apps/api and apps/worker), the events packages (their tests are in test/) and ui (its stories run in apps/web).
// `passWithNoTests` lets a project without tests write a record at 0%.
export const recordOnlyConfig = (own?: string) =>
  defineConfig({
    test: {
      passWithNoTests: true,
      coverage: recordCoverage(own === undefined ? {} : { own }),
    },
  });
