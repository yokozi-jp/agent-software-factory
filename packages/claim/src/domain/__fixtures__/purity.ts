// Detection-power fixture (#43) for how domain is written (root vite.config.ts, docs/adr/0027). Each statement
// below is one that a rule must report in packages/*/src/domain/: `throw` (domain/no-throw), `new Date()` and
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

// Other ways to write the same thing, which the rules also report.
export function drawsWithBrackets(): number {
  // oxlint-disable-next-line no-restricted-properties -- fixture: domain takes the random value as an argument
  return Math["random"]();
}

export function drawsWithDestructuring(): number {
  // oxlint-disable-next-line no-restricted-properties -- fixture: domain takes the random value as an argument
  const { random } = Math;
  return random();
}

export function checksInstanceOfDate(value: unknown): boolean {
  // oxlint-disable-next-line no-restricted-globals -- fixture: domain takes the time as an argument
  return value instanceof Date;
}

// A known gap: `Date` reached through the global object is not reported (docs/adr/0027). It carries no disable
// comment, so `vp check` fails when Oxlint starts to report it. Then drop this function, move the line above
// with a disable comment, and fix the ADR.
export function readsTheClockThroughGlobalThis(): number {
  return globalThis.Date.now();
}

// A `Date` in a type annotation is not reported by no-restricted-globals (docs/adr/0027). It carries no disable
// comment, so `vp check` fails if the rule starts to report it.
export function startOf(at: Date): Date {
  return at;
}
