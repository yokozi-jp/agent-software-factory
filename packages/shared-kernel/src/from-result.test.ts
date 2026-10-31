import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { fromResult } from "./from-result.ts";
import type { Result } from "./result.ts";

type SubmitError = { readonly _tag: "NoLines" } | { readonly _tag: "TotalExceedsLimit" };

describe("fromResult", () => {
  it("成功の Result は、その値で成功する Effect になる", async () => {
    const result: Result<number, SubmitError> = { _tag: "Ok", value: 7 };
    expect(await Effect.runPromise(fromResult(result))).toBe(7);
  });

  it("失敗の Result は、その失敗の _tag のまま失敗する Effect になる", async () => {
    const result: Result<number, SubmitError> = { _tag: "Err", error: { _tag: "NoLines" } };
    const failure = await Effect.runPromise(Effect.flip(fromResult(result)));
    expect(failure).toEqual({ _tag: "NoLines" });
  });

  it("失敗は catchTag で処理できる", async () => {
    const result: Result<string, SubmitError> = {
      _tag: "Err",
      error: { _tag: "TotalExceedsLimit" },
    };
    const handled = fromResult(result).pipe(
      Effect.catchTag("TotalExceedsLimit", () => Effect.succeed("recovered")),
    );
    expect(await Effect.runPromise(handled)).toBe("recovered");
  });
});
