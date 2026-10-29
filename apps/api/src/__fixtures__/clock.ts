// Detection-power fixture (#43) for the clock restrictions in apps/api/src (root vite.config.ts, #365).
// Each line below is one that no-restricted-globals or no-restricted-properties must report. If a rule is turned
// off, or its `files` stop reaching packages/*/src/, the disable comment is unused and `vp check` fails
// (reportUnusedDisableDirectives). Knip skips __fixtures__/, and nothing imports this file.
// oxlint-disable-next-line no-restricted-globals -- fixture: a bare `Date` as a value
export const withNew: number = new Date().getTime();
// oxlint-disable-next-line no-restricted-globals -- fixture: Date.now() reads the clock
export const withNow: number = Date.now();
// oxlint-disable-next-line no-restricted-properties -- fixture: Date read from globalThis
export const viaGlobalThis: number = globalThis.Date.now();
// oxlint-disable-next-line no-restricted-properties -- fixture: the current time of Temporal
export const temporalNow: Temporal.Instant = Temporal.Now.instant();
// oxlint-disable-next-line no-restricted-properties -- fixture: Temporal read from globalThis
export const temporalViaGlobalThis: Temporal.Instant = globalThis.Temporal.Now.instant();
// A `Date` in a type annotation is not reported: a library gives one (Better Auth, pg). The line carries no
// disable comment, so `vp check` fails if the rule starts to report the type.
export const asType = (at: Date): Date => at;
