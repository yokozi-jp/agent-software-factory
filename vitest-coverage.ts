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
// Vitest matches a file inside the root of the project by its path from the root ("Patterns are matched against each file's
// path relative to the project root", https://vitest.dev/config/coverage). For a file outside the root it also tries the
// absolute path and the path from the root that starts with "../" (the `isIncluded` of @vitest/coverage-v8 5.1.0, read on
// 2026-11-12), so an entry is written in both forms: the absolute path, and the path from the project when the entry is in
// it. vitest-coverage.tools.test.ts shows that each form is needed.
const ownFiles = "src/**/*.ts";

// The characters that picomatch reads in a glob, escaped in the part of an absolute path that is not from the table.
const escapeGlob = (text: string): string => text.replaceAll(/[\\*?[\]{}()!+@]/gu, String.raw`\$&`);

// A path of the table to the patterns that Vitest matches. The project is the directory Vitest runs in: the root defaults to
// the working directory, and Nx runs `vp test run` from the project (a different root would leave an entry of the project
// counted at 0%, which the project's own minimum reports).
function entryPatterns(entry: string): string[] {
  const absolute = join(import.meta.dirname, entry);
  const fromProject = relative(process.cwd(), absolute);
  const outside = fromProject === ".." || fromProject.startsWith("../");
  const pattern = join(escapeGlob(import.meta.dirname), entry);
  return outside ? [pattern] : [pattern, fromProject];
}

export function recordCoverage({ own = ownFiles }: { readonly own?: string } = {}) {
  return {
    provider: "v8" as const,
    allowExternal: true,
    include: [own, ...policy.projects.map((glob) => `**/${glob}/src/**/*.{ts,tsx}`)],
    exclude: [...policy.notMeasured, ...Object.keys(policy.entries).flatMap(entryPatterns)],
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
