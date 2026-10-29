// Detection-power fixture (#43) for the clock restrictions of vite.config.ts (docs/adr/0043). application takes the
// time as the `now` argument, and an entry point reads the Clock. Each line below is one that the rule must
// report. If a rule is turned off, or its `files` stop reaching this directory, the disable comments are unused
// and `vp check` fails (reportUnusedDisableDirectives). Knip and jscpd skip __fixtures__/.
// oxlint-disable-next-line no-restricted-imports -- fixture: application does not read the Clock
import { Clock } from "effect";
// oxlint-disable-next-line no-restricted-imports -- fixture: the subpath of the Clock is stopped too
import * as ClockModule from "effect/Clock";

export const clock = [Clock, ClockModule];

export function readsWithNew(): number {
  // oxlint-disable-next-line no-restricted-globals -- fixture: application takes `now` as an argument
  return new Date().getTime();
}

export function readsTheTemporalClock(): Temporal.Instant {
  // oxlint-disable-next-line no-restricted-properties -- fixture: application takes `now` as an argument
  return Temporal.Now.instant();
}

// The `now` argument is what application writes. It carries no disable comment, so `vp check` fails if the rules
// start to report `Temporal.Instant`.
export function plusOneDay(now: Temporal.Instant): Temporal.Instant {
  return now.add({ hours: 24 });
}
