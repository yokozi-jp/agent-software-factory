// Detection-power fixture (#43) for the no-restricted-imports rule on the tests of tools/scripts (root
// vite.config.ts). Each import below is what the rule must report. If the rule is turned off, or its
// `files` stop reaching tools/scripts/src/**/*.test.ts, the disable comments are unused and `vp check`
// fails (reportUnusedDisableDirectives). The file is named *.test.ts so the rule reaches it; Vitest,
// coverage and Stryker skip fixtures/.
// oxlint-disable-next-line no-restricted-imports -- fixture: the import the rule must stop
import { execFileSync } from "node:child_process";
// oxlint-disable-next-line no-restricted-imports -- fixture: the same module without the node: prefix
import { spawnSync } from "child_process";

export const imported = [execFileSync, spawnSync];
