// Detection-power fixture (#43) for how domain is written (root vite.config.ts, docs/adr/0027). Each statement
// below is one that a rule must report in packages/closing/src/domain/: `throw` (domain/no-throw), `new Date()` and
// `Date.now()` (no-restricted-globals), and `Math.random()` (no-restricted-properties). If a rule is turned
// off, or its `files` stop reaching this directory, the disable comment is unused and `vp check` fails
// (reportUnusedDisableDirectives). Knip and jscpd skip __fixtures__/, and nothing imports this file.

export function throwsAnError(): never {
  // oxlint-disable-next-line domain/no-throw -- fixture: domain returns a Result and does not throw
  throw new Error("fixture");
}

export function readsTheClockWithNew(): number {
  // oxlint-disable-next-line no-restricted-globals -- fixture: domain takes the time as an argument
  return new Date().getTime();
}

export function readsTheClockWithNow(): number {
  // oxlint-disable-next-line no-restricted-globals -- fixture: domain takes the time as an argument
  return Date.now();
}

export function drawsARandomNumber(): number {
  // oxlint-disable-next-line no-restricted-properties -- fixture: domain takes the random value as an argument
  return Math.random();
}

// The one use of `Date` that domain may have: the type of an annotation. It carries no disable comment, so
// `vp check` fails if no-restricted-globals starts to report it.
export function startOf(at: Date): Date {
  return at;
}
