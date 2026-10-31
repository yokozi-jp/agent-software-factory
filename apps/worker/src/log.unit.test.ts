import { describe, expect, it, vi } from "vite-plus/test";

import { failureLine, reportFailure } from "./log.ts";

describe("失敗のログ", () => {
  it("メッセージの id とエラーの名前と文だけを 1 行の JSON にすること", () => {
    const line = failureLine(new RangeError("bad"), "m-1");

    expect(JSON.parse(line)).toEqual({
      level: "error",
      event: "notification_failed",
      messageId: "m-1",
      error: "RangeError: bad",
    });
  });

  it("Error でない値は文字にして、id がなければ id を省くこと", () => {
    const parsed: unknown = JSON.parse(failureLine("boom", undefined));

    expect(parsed).toEqual({ level: "error", event: "notification_failed", error: "boom" });
  });

  it("reportFailure は、その 1 行を標準エラーに書くこと", () => {
    const write = vi.spyOn(console, "error").mockImplementation(() => undefined);

    reportFailure(new Error("bad"), "m-1");

    expect(write).toHaveBeenCalledWith(failureLine(new Error("bad"), "m-1"));
    write.mockRestore();
  });
});
