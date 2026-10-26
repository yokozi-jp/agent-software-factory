import { describe, expect, it } from "vite-plus/test";
import { DAY, day, month, months, startOf, week } from "./jst.ts";

const at = (iso: string): number => Date.parse(iso);

describe("day, month", () => {
  it("names the JST day and month, nine hours ahead of UTC", () => {
    expect(day(at("2026-10-31T14:59:59Z"))).toBe("2026-10-31");
    expect(day(at("2026-10-31T15:00:00Z"))).toBe("2026-11-01");
    expect(month(at("2026-10-31T14:59:59Z"))).toBe("2026-10");
    expect(month(at("2026-10-31T15:00:00Z"))).toBe("2026-11");
  });
});

describe("week", () => {
  it("names the Monday (JST) that starts the week", () => {
    // 2026-10-26 is a Monday.
    expect(week(at("2026-10-25T15:00:00Z"))).toBe("2026-10-26");
    expect(week(at("2026-10-25T14:59:59Z"))).toBe("2026-10-19");
    expect(week(at("2026-11-01T12:00:00Z"))).toBe("2026-10-26");
    expect(week(at("2026-10-28T03:00:00Z"))).toBe("2026-10-26");
  });
});

describe("startOf", () => {
  it("is the start of the JST day", () => {
    expect(startOf("2026-10-01")).toBe(at("2026-09-30T15:00:00Z"));
    expect(startOf("2028-02-29")).toBe(at("2028-02-28T15:00:00Z"));
  });

  it.each(["2026-02-30", "2026-13-01", "2026-10-1", "2026-10-01T00:00", "x2026-10-01", "10/01"])(
    "is undefined for %s, which is not a day of the calendar",
    (text) => {
      expect(startOf(text)).toBeUndefined();
    },
  );

  it("is a day apart from the start of the next day", () => {
    expect(Number(startOf("2026-10-02")) - Number(startOf("2026-10-01"))).toBe(DAY);
    expect(DAY).toBe(86_400_000);
  });
});

describe("months", () => {
  it("lists the months from one time to another, both included, across a year", () => {
    expect(months(at("2026-11-20T00:00:00Z"), at("2027-02-01T00:00:00Z"))).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("lists one month for times in the same month", () => {
    expect(months(at("2026-10-01T00:00:00Z"), at("2026-10-31T00:00:00Z"))).toEqual(["2026-10"]);
  });
});
