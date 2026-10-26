// Days, weeks and months in Japan Standard Time, which the factory metrics group by (docs/agents/factory-metrics.md).
// JST is UTC+9 without daylight saving time (Asia/Tokyo in the IANA time zone database), so a fixed offset
// is enough.

export const DAY = 24 * 60 * 60 * 1000;
const OFFSET = 9 * 60 * 60 * 1000;

const shifted = (ms: number): Date => new Date(ms + OFFSET);

// "YYYY-MM-DD" of the JST day that holds `ms`.
export const day = (ms: number): string => shifted(ms).toISOString().slice(0, 10);

// "YYYY-MM" of the JST month that holds `ms`.
export const month = (ms: number): string => shifted(ms).toISOString().slice(0, 7);

// "YYYY-MM-DD" of the Monday that starts the JST week holding `ms` (ISO 8601 weeks start on Monday).
export const week = (ms: number): string => day(ms - ((shifted(ms).getUTCDay() + 6) % 7) * DAY);

// The start of the JST day "YYYY-MM-DD"; undefined when the text is not such a date. Date.parse gives NaN for
// a month or day out of range (2026-13-01) and for other forms, but turns a day past the end of the month
// (2026-02-30) into the next month, so the result must also print as the same text.
export function startOf(date: string): number | undefined {
  const ms = Date.parse(`${date}T00:00:00+09:00`);
  return !Number.isNaN(ms) && day(ms) === date ? ms : undefined;
}

// The month after "YYYY-MM". Date.UTC counts months from 0, so the 1-based month number is the next month.
const nextMonth = (key: string): string => {
  const [year, monthNumber] = key.split("-").map(Number);
  return month(Date.UTC(Number(year), Number(monthNumber), 1));
};

// The months from the one holding `from` to the one holding `to`, both included.
export function months(from: number, to: number): string[] {
  const out: string[] = [];
  for (let key = month(from); key <= month(to); key = nextMonth(key)) out.push(key);
  return out;
}
