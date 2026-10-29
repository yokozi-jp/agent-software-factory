import { describe, expect, it } from "vite-plus/test";

describe("テストのタイムゾーン", () => {
  it("api の test は America/New_York で動く", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/New_York");
  });

  it("Temporal が global にある", () => {
    expect(Temporal.Instant.from("2026-04-01T02:00:00Z").epochMilliseconds).toBe(1_775_008_800_000);
  });
});
