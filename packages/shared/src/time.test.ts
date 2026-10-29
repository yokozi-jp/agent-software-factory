import { Clock, Effect, Layer, ManagedRuntime } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vite-plus/test";
import { BUSINESS_TIME_ZONE, currentInstant, toApiDate, toApiInstant } from "./time.ts";

function clockAt(iso: string): Clock.Clock {
  const ms = Date.parse(iso);
  return {
    currentTimeMillisUnsafe: () => ms,
    currentTimeMillis: Effect.succeed(ms),
    currentTimeNanosUnsafe: () => BigInt(ms) * 1_000_000n,
    currentTimeNanos: Effect.succeed(BigInt(ms) * 1_000_000n),
    monotonicTimeNanosUnsafe: () => 0n,
    monotonicTimeNanos: Effect.succeed(0n),
    sleep: () => Effect.void,
  };
}

describe("テストのタイムゾーン", () => {
  it("Vitest の node の project は America/New_York で動く", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/New_York");
  });
});

describe("BUSINESS_TIME_ZONE", () => {
  it("業務のタイムゾーンは IANA の名前の Asia/Tokyo", () => {
    expect(BUSINESS_TIME_ZONE).toBe("Asia/Tokyo");
  });
});

describe("currentInstant", () => {
  it("与えた Clock の時刻を Temporal.Instant で返す", async () => {
    const runtime = ManagedRuntime.make(
      Layer.succeed(Clock.Clock)(clockAt("2026-03-31T15:00:00.123Z")),
    );
    const now = await runtime.runPromise(currentInstant);
    expect(now.toString()).toBe("2026-03-31T15:00:00.123Z");
    await runtime.dispose();
  });

  it("TestClock で進めた時刻を返す", async () => {
    const program = Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-03-31T15:00:00.000Z"));
      yield* TestClock.adjust("1 hour");
      return yield* currentInstant;
    });
    const now = await Effect.runPromise(Effect.provide(program, TestClock.layer()));
    expect(now.toString()).toBe("2026-03-31T16:00:00Z");
  });
});

describe("toApiInstant", () => {
  it("ミリ秒が 0 でも 3 桁で書く", () => {
    expect(toApiInstant(Temporal.Instant.from("2026-04-01T02:00:00Z"))).toBe(
      "2026-04-01T02:00:00.000Z",
    );
  });

  it("ミリ秒より細かい桁は 3 桁に切り捨てる", () => {
    expect(toApiInstant(Temporal.Instant.from("2026-04-01T02:00:00.123987Z"))).toBe(
      "2026-04-01T02:00:00.123Z",
    );
  });

  it("プロセスのタイムゾーンに依らず Z で書く", () => {
    expect(toApiInstant(Temporal.Instant.from("2026-04-01T11:00:00+09:00"))).toBe(
      "2026-04-01T02:00:00.000Z",
    );
  });
});

describe("toApiDate", () => {
  it("暦日を YYYY-MM-DD で書く", () => {
    expect(toApiDate(Temporal.PlainDate.from("2026-03-31"))).toBe("2026-03-31");
  });
});
