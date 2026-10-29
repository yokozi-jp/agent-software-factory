import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { apiDate, apiInstant } from "./api-time.ts";

describe("apiInstant", () => {
  it("Z でミリ秒が 3 桁の RFC 3339 を Temporal.Instant にする", () => {
    const parsed = apiInstant.parse("2026-04-01T02:00:00.000Z");
    expect(parsed).toBeInstanceOf(Temporal.Instant);
    expect(parsed.toString()).toBe("2026-04-01T02:00:00Z");
  });

  it.each([
    ["オフセット付き", "2026-04-01T11:00:00.000+09:00"],
    ["ミリ秒がない", "2026-04-01T02:00:00Z"],
    ["ミリ秒が 6 桁", "2026-04-01T02:00:00.123456Z"],
    ["存在しない日", "2026-02-30T02:00:00.000Z"],
    ["暦日だけ", "2026-04-01"],
    ["RFC 9557 の名前付き", "2026-04-01T11:00:00.000+09:00[Asia/Tokyo]"],
  ])("%s は受けない", (_name, input) => {
    expect(apiInstant.safeParse(input).success).toBe(false);
  });

  it("OpenAPI には format: date-time の文字列として出る", () => {
    expect(z.toJSONSchema(apiInstant, { io: "input" })).toMatchObject({
      type: "string",
      format: "date-time",
    });
  });
});

describe("apiDate", () => {
  it("YYYY-MM-DD を Temporal.PlainDate にする", () => {
    const parsed = apiDate.parse("2026-03-31");
    expect(parsed).toBeInstanceOf(Temporal.PlainDate);
    expect(parsed.toString()).toBe("2026-03-31");
  });

  it.each([
    ["存在しない日", "2026-02-30"],
    ["瞬間", "2026-03-31T00:00:00.000Z"],
    ["区切りが違う", "2026/03/31"],
  ])("%s は受けない", (_name, input) => {
    expect(apiDate.safeParse(input).success).toBe(false);
  });

  it("OpenAPI には format: date の文字列として出る", () => {
    expect(z.toJSONSchema(apiDate, { io: "input" })).toMatchObject({
      type: "string",
      format: "date",
    });
  });
});
