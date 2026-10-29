// Detection-power fixture (#43) for how domain is written (root vite.config.ts, docs/adr/0027). Each statement
// below is one that a rule must report in packages/*/src/domain/: `throw` (domain/no-throw), `new Date()` and
// `Date.now()` (no-restricted-globals), and `Math.random()` and `Temporal.Now` (no-restricted-properties). If a rule is turned
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

// `Date` and `Temporal.Now` reached through the global object, and the current time of Temporal, are reported by
// no-restricted-properties (the clock entries of vite.config.ts).
export function readsTheClockThroughGlobalThis(): number {
  // oxlint-disable-next-line no-restricted-properties -- fixture: domain takes the time as an argument
  return globalThis.Date.now();
}

export function readsTheTemporalClock(): Temporal.Instant {
  // oxlint-disable-next-line no-restricted-properties -- fixture: domain takes the time as an argument
  return Temporal.Now.instant();
}

export function readsTheTemporalClockThroughGlobalThis(): Temporal.Instant {
  // oxlint-disable-next-line no-restricted-properties -- fixture: domain takes the time as an argument
  return globalThis.Temporal.Now.instant();
}

export function readsTheTemporalClockWithDestructuring(): Temporal.Instant {
  // oxlint-disable-next-line no-restricted-properties -- fixture: domain takes the time as an argument
  const { Now } = Temporal;
  return Now.instant();
}

// A function that takes the time as an argument is what domain writes. It carries no disable comment, so
// `vp check` fails if the rules start to report `Temporal.Instant` itself.
export function plusOneHour(at: Temporal.Instant): Temporal.Instant {
  return at.add({ hours: 1 });
}

// A `Date` in a type annotation is not reported by no-restricted-globals (docs/adr/0027). It carries no disable
// comment, so `vp check` fails if the rule starts to report it.
export function startOf(at: Date): Date {
  return at;
}
