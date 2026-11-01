// Detection-power fixture (#43) for the domain of the driver logging (docs/adr/0054): the rules of domain reach
// packages/logging/src/domain/, as they reach the domain of a module (docs/adr/0026, docs/adr/0027). Each statement below is
// one that a rule must report: an import of the library of the driver (pino), `throw`, `new Date()` and
// `Math.random()`. If a rule is turned off, a driver override replaces it, or its `files` stop reaching this directory,
// the disable comment is unused and `vp check` fails (reportUnusedDisableDirectives). Knip and jscpd skip
// __fixtures__/, and nothing imports this file.
// oxlint-disable-next-line no-restricted-imports -- fixture: domain imports no library
import "pino";

export function throwsAnError(): never {
  // oxlint-disable-next-line domain/no-throw -- fixture: domain returns a Result and does not throw
  throw new Error("fixture");
}

export function readsTheClock(): number {
  // oxlint-disable-next-line no-restricted-globals -- fixture: domain takes the time as an argument
  return new Date().getTime();
}

export function drawsARandomNumber(): number {
  // oxlint-disable-next-line no-restricted-properties -- fixture: domain takes the random value as an argument
  return Math.random();
}
