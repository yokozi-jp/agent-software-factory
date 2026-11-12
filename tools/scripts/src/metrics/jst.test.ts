import { describe, expect, it } from "vite-plus/test";
import { DAY, day, month, months, startOf, week } from "./jst.ts";

const at = (iso: string): number => Date.parse(iso);

describe("日、月", () => {
  it("UTC より 9 時間進んだ JST の日と月を名付けること", () => {
    expect(day(at("2026-10-31T14:59:59Z"))).toBe("2026-10-31");
    expect(day(at("2026-10-31T15:00:00Z"))).toBe("2026-11-01");
    expect(month(at("2026-10-31T14:59:59Z"))).toBe("2026-10");
    expect(month(at("2026-10-31T15:00:00Z"))).toBe("2026-11");
  });
});

describe("week", () => {
  it("週を始める (JST の) 月曜日を名付けること", () => {
    // 2026-10-26 is a Monday.
    expect(week(at("2026-10-25T15:00:00Z"))).toBe("2026-10-26");
    expect(week(at("2026-10-25T14:59:59Z"))).toBe("2026-10-19");
    expect(week(at("2026-11-01T12:00:00Z"))).toBe("2026-10-26");
    expect(week(at("2026-10-28T03:00:00Z"))).toBe("2026-10-26");
  });
});

describe("startOf", () => {
  it("JST の日の始まりであること", () => {
    expect(startOf("2026-10-01")).toBe(at("2026-09-30T15:00:00Z"));
    expect(startOf("2028-02-29")).toBe(at("2028-02-28T15:00:00Z"));
  });

  it.each(["2026-02-30", "2026-13-01", "2026-10-1", "2026-10-01T00:00", "x2026-10-01", "10/01"])(
    "暦にない日である %s のとき、undefined であること",
    (text) => {
      expect(startOf(text)).toBeUndefined();
    },
  );

  it("次の日の始まりから 1 日離れていること", () => {
    expect(Number(startOf("2026-10-02")) - Number(startOf("2026-10-01"))).toBe(DAY);
    expect(DAY).toBe(86_400_000);
  });
});

describe("months", () => {
  it("ある時刻から別の時刻までの月を、両端を含めて年をまたいで一覧にすること", () => {
    expect(months(at("2026-11-20T00:00:00Z"), at("2027-02-01T00:00:00Z"))).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("同じ月の時刻では、1 つの月を一覧にすること", () => {
    expect(months(at("2026-10-01T00:00:00Z"), at("2026-10-31T00:00:00Z"))).toEqual(["2026-10"]);
  });
});
