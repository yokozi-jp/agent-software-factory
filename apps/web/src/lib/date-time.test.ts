import { describe, expect, it } from "vite-plus/test";
import {
  formatBusinessDate,
  formatBusinessInstant,
  readApiDate,
  readApiInstant,
} from "./date-time.ts";

describe("テストのブラウザのタイムゾーン", () => {
  it("contextOptions.timezoneId が効いて America/New_York になる", () => {
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/New_York");
  });
});

describe("瞬間の表示 (formatBusinessInstant)", () => {
  it("瞬間を、ブラウザのタイムゾーンではなく東京の日時で表示する", () => {
    const instant = readApiInstant("2026-03-31T15:30:00.000Z");
    expect(formatBusinessInstant(instant, "ja-JP")).toBe("2026/04/01 0:30");
  });

  it("言語に合わせた書式で表示する", () => {
    const instant = readApiInstant("2026-03-31T15:30:00.000Z");
    expect(formatBusinessInstant(instant, "en-US")).toBe("04/01/2026, 12:30 AM");
  });
});

describe("暦日の表示 (formatBusinessDate)", () => {
  it("暦日は変換せず、ブラウザのタイムゾーンによらず同じ日を表示する", () => {
    expect(formatBusinessDate(readApiDate("2026-03-31"), "ja-JP")).toBe("2026/03/31");
  });
});

describe("API の値の読み込み (readApiInstant と readApiDate)", () => {
  it("瞬間は Z の RFC 3339 から読む", () => {
    expect(readApiInstant("2026-03-31T15:30:00.000Z").epochMilliseconds).toBe(
      Date.UTC(2026, 2, 31, 15, 30),
    );
  });

  it("暦日は YYYY-MM-DD から読み、瞬間としては読めない", () => {
    expect(readApiDate("2026-03-31").toString()).toBe("2026-03-31");
    expect(() => readApiInstant("2026-03-31")).toThrow(RangeError);
  });
});
