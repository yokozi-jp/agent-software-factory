import { Clock, Effect } from "effect";

/**
 * The time zone of the business: the boundary of a closing, the day that "today" is, and what a screen or a mail
 * shows. One for the whole system, as the name from the IANA time zone database, not an offset. The functions that
 * compute with it take it as an argument and never read the `TZ` of the process.
 */
export const BUSINESS_TIME_ZONE = "Asia/Tokyo";

/**
 * The current moment. Only an entry point (a route handler, one message of a worker, one run of a job) reads it,
 * once, and passes it to application and domain as the `now` argument. A test gives the runtime a fixed `Clock` or
 * `TestClock.layer()` (docs/domain-model/application-effect.md).
 */
export const currentInstant: Effect.Effect<Temporal.Instant> = Effect.map(
  Clock.currentTimeMillis,
  (millis) => Temporal.Instant.fromEpochMilliseconds(millis),
);

/**
 * A moment as the API, the logs and the CSV write it: RFC 3339, in UTC (`Z`), with exactly three digits of
 * fraction. `JSON.stringify` of a `Temporal.Instant` drops a fraction of zero, so every value goes through here.
 */
export function toApiInstant(instant: Temporal.Instant): string {
  return instant.toString({ fractionalSecondDigits: 3 });
}

/** A calendar date as the API and the CSV write it: `YYYY-MM-DD` (the `full-date` of RFC 3339). */
export function toApiDate(date: Temporal.PlainDate): string {
  return date.toString();
}
