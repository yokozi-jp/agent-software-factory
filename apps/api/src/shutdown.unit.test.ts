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

  it("処理中のリクエストが待ちの上限までに終わらなくても、資源を閉じてトレースを送ること", async () => {
    const { calls, steps } = recording({ closeServer: () => new Promise<void>(() => {}) });

    await stopGracefully(steps, { timeoutMs: 10 });

    expect(calls).toEqual(["closeResources", "flushTelemetry"]);
  });

  it("受け付けの停止に失敗しても、資源を閉じてトレースを送ること", async () => {
    const { calls, steps } = recording({
      closeServer: () => Promise.reject(new Error("not running")),
    });

    await stopGracefully(steps);

    expect(calls).toEqual(["closeResources", "flushTelemetry"]);
  });

  it("資源を閉じるのに失敗したら、トレースを送ってから、その失敗で終わること", async () => {
    const { calls, steps } = recording({
      closeResources: () => Promise.reject(new Error("pool did not end")),
    });

    await expect(stopGracefully(steps)).rejects.toThrow("pool did not end");
    expect(calls).toEqual(["closeServer", "flushTelemetry"]);
  });
});
