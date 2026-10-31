// Detection-power fixture (#43) for the restrictions in apps/worker/src that the entry files leave (root vite.config.ts,
// docs/adr/0032, docs/adr/0043): `process` and the clock. Each line below is one that no-restricted-globals or
// no-restricted-properties must report here, in a file that is not an entry file.
// If a rule is turned off, or its `files` stop reaching apps/worker/src/, the disable comment is unused and `vp check`
// fails (reportUnusedDisableDirectives). Knip skips __fixtures__/, and nothing imports this file.
// The Node.js modules are allowed here, unlike in apps/api/src: the line below carries no disable comment, so `vp check`
// fails if `import/no-nodejs-modules` starts to report it.
import "node:timers/promises";
// oxlint-disable-next-line no-restricted-globals -- fixture: environment variables are read in the entry file only
export const environment: unknown = process;
// oxlint-disable-next-line no-restricted-globals -- fixture: Date as a value reads the clock
export const now: number = Date.now();
// oxlint-disable-next-line no-restricted-properties -- fixture: the current time of Temporal
export const instant: Temporal.Instant = Temporal.Now.instant();
