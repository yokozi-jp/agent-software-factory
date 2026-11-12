import { join, relative } from "node:path";
import { defineConfig } from "vite-plus";
import policy from "./coverage-policy.json" with { type: "json" };

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
// What the record holds comes from the table of coverage-policy.json, which the merged check (tools/scripts/src/checks/
// merged-coverage/rules.ts, isMeasured) reads too (#577): `projects` are the directories whose `src` counts, `notMeasured`
// the kinds of files that never count, and `entries` the files that only start the program (a project's own minimum
// would count them at 0%, and the merged check does not). A file is added in one place, and the two cannot differ.
//
// Vitest matches a file inside the root of the project by its path from the root, and a file outside the root by its
// absolute path (or one that starts with "../"), so an entry is written in both forms: the absolute path, and the path
// from the project when the entry is in it.
const ownFiles = "src/**/*.ts";

// A path in the table to the patterns that Vitest matches: the absolute path, and the path from `project` if it is in it.
function entryPatterns(entry: string, project: string): string[] {
  const absolute = join(import.meta.dirname, entry);
  const own = relative(project, absolute);
  return own.startsWith("..") ? [absolute] : [absolute, own];
}

export function recordCoverage({
  own = ownFiles,
  project = process.cwd(),
}: {
  readonly own?: string;
  // The directory of the project: Vitest's root, the working directory of `vp test run`.
  readonly project?: string;
} = {}) {
  return {
    provider: "v8" as const,
    allowExternal: true,
    include: [own, ...policy.projects.map((glob) => `**/${glob}/src/**/*.{ts,tsx}`)],
    exclude: [
      ...policy.notMeasured,
      ...Object.keys(policy.entries).flatMap((entry) => entryPatterns(entry, project)),
    ],
  };
}

// The minimum of each file of the project's own `src`, for projects without the ratchet of the totals (apps/api, apps/web and
// tools/scripts have it). Only the own `src` has it: the other projects' files in the record are checked by the merged check.
export const ownFilesMinimum = { "src/**": { perFile: { lines: 90, branches: 90 } } };

// The vite.config.ts of a project that has no minimum of its own and only writes its record: the modules (their code is run by
// apps/api and apps/worker), the events packages (their tests are in test/) and ui (its stories run in apps/web).
// `passWithNoTests` lets a project without tests write a record at 0%.
export const recordOnlyConfig = (own: string = ownFiles) =>
  defineConfig({
    test: {
      passWithNoTests: true,
      coverage: recordCoverage({ own }),
    },
  });
