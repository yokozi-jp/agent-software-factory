import { z } from "zod";

/**
 * A moment in a request body, query or path: RFC 3339 in UTC (`Z`) with exactly three digits of fraction, read into
 * a `Temporal.Instant`. An offset (`+09:00`), a missing fraction and RFC 9557 are refused, so one moment has one
 * way to be written. OpenAPI shows it as `format: date-time`. The response side is `toApiInstant` (./time.ts).
 */
export const apiInstant = z.iso
  .datetime({ precision: 3 })
  .transform((value) => Temporal.Instant.from(value));

/**
 * A calendar date, such as the date on a receipt: `YYYY-MM-DD`, read into a `Temporal.PlainDate`. It has no time
 * zone and is never converted. OpenAPI shows it as `format: date`. The response side is `toApiDate` (./time.ts).
 */
export const apiDate = z.iso.date().transform((value) => Temporal.PlainDate.from(value));
