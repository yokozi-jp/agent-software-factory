/**
 * The time zone of the business, the one every screen shows a moment in (docs/adr/0043). The same name as
 * `BUSINESS_TIME_ZONE` in packages/shared-kernel/src/time.ts. It is written again here because that file imports Effect,
 * which does not go into the web bundle.
 */
const BUSINESS_TIME_ZONE = "Asia/Tokyo";

/** A moment in a response body: RFC 3339 in UTC (`Z`). An offset and a calendar date (`YYYY-MM-DD`) are refused. */
export function readApiInstant(value: string): Temporal.Instant {
  if (!value.endsWith("Z")) throw new RangeError(`not a moment in UTC (Z): ${value}`);
  return Temporal.Instant.from(value);
}

/** A calendar date in a response body: `YYYY-MM-DD`. It has no time zone and is never converted. */
export function readApiDate(value: string): Temporal.PlainDate {
  // `PlainDate.from` also reads "2026-03-31T10:00:00" and drops the time, so a date-time is refused here.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new RangeError(`not a calendar date (YYYY-MM-DD): ${value}`);
  return Temporal.PlainDate.from(value);
}

/**
 * Shows a moment in the business time zone, in the format of `locale` (the language of i18next). `timeZone` is
 * always passed: without it `Intl.DateTimeFormat` uses the time zone of the browser.
 */
export function formatBusinessInstant(instant: Temporal.Instant, locale: string): string {
  return instant.toLocaleString(locale, {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Shows a calendar date in the format of `locale`. A `PlainDate` has no time zone, so none is applied. */
export function formatBusinessDate(date: Temporal.PlainDate, locale: string): string {
  return date.toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
}
