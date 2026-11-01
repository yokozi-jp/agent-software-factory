import { describe, expect, it } from "vite-plus/test";

import { stopGracefully, type StopSteps } from "./shutdown.ts";

// 停止の合図を受けた後の順序 (docs/adr/0028)。受け付けを止めて処理中のリクエストを待ち、資源を閉じ、トレースを送り切る。
const recording = (overrides: Partial<StopSteps> = {}) => {
  const calls: string[] = [];
  const step = (name: string) => () => {
    calls.push(name);
    return Promise.resolve();
  };
  const steps: StopSteps = {
    closeServer: step("closeServer"),
    closeResources: step("closeResources"),
    flushTelemetry: step("flushTelemetry"),
    ...overrides,
  };
  return { calls, steps };
};

describe("停止の手順 (stopGracefully)", () => {
  it("受け付けを止めて処理中のリクエストを待ってから、資源を閉じ、最後にトレースを送ること", async () => {
    const { calls, steps } = recording();

    await stopGracefully(steps);

    expect(calls).toEqual(["closeServer", "closeResources", "flushTelemetry"]);
  });

  // 待ちの上限は、受け付けの停止と資源の close の 2 つをまとめて縛る。pool の end は使用中の接続を待つので、どちらかが
  // 終わらなければ、残りを進めてトレースを送り、上限を過ぎたことを失敗にする。
  it.each([
    ["処理中のリクエスト", "closeServer", ["closeResources", "flushTelemetry"]],
    ["資源を閉じる処理", "closeResources", ["closeServer", "flushTelemetry"]],
  ] as const)(
    "%sが待ちの上限までに終わらなければ、トレースを送ってから、その旨の失敗で終わること",
    async (_, hanging, expected) => {
      const { calls, steps } = recording({ [hanging]: () => new Promise<void>(() => {}) });

      await expect(stopGracefully(steps, { timeoutMs: 10 })).rejects.toThrow(
        /did not close within 10 ms/,
      );
      expect(calls).toEqual(expected);
    },
  );

  it("受け付けの停止に失敗したら、資源を閉じてトレースを送ってから、その失敗で終わること", async () => {
    const { calls, steps } = recording({
      closeServer: () => Promise.reject(new Error("not running")),
    });

    await expect(stopGracefully(steps)).rejects.toThrow(/did not stop accepting: not running/);
    expect(calls).toEqual(["closeResources", "flushTelemetry"]);
  });

  it("トレースの送信が、それ自身の待ちの上限までに終わらなくても終わること", async () => {
    const { calls, steps } = recording({ flushTelemetry: () => new Promise<void>(() => {}) });

    await expect(stopGracefully(steps, { flushTimeoutMs: 10 })).resolves.toBeUndefined();
    expect(calls).toEqual(["closeServer", "closeResources"]);
  });

  it("資源を閉じるのに失敗したら、トレースを送ってから、その失敗で終わること", async () => {
    const { calls, steps } = recording({
      closeResources: () => Promise.reject(new Error("pool did not end")),
    });

    await expect(stopGracefully(steps)).rejects.toThrow("pool did not end");
    expect(calls).toEqual(["closeServer", "flushTelemetry"]);
  });
});
