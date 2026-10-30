import { describe, expect, it } from "vite-plus/test";

import { startTelemetry } from "./node.ts";

describe("startTelemetry: 起動しない条件", () => {
  it("送り先の環境変数がなければ何も始めず、止めても例外にならない", async () => {
    const telemetry = startTelemetry({ env: {}, serviceName: "api" });
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it("送り先が空文字なら、ないものとして扱う", async () => {
    const telemetry = startTelemetry({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "", OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "" },
      serviceName: "api",
    });
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it("OTEL_SDK_DISABLED=true なら、送り先があっても始めない", async () => {
    // 始めていれば、後続のテストファイルとは別の worker なので衝突はしないが、shutdown が SDK を止める経路に入る。
    // ここでは「何も登録しない」ことを、global の tracer provider が差し替わっていないことで確かめる。
    const { trace } = await import("@opentelemetry/api");
    const before = trace.getTracerProvider();
    const telemetry = startTelemetry({
      env: { OTEL_SDK_DISABLED: "true", OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" },
      serviceName: "api",
    });
    expect(trace.getTracerProvider()).toBe(before);
    await telemetry.shutdown();
  });
});
