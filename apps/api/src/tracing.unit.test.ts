import { startTelemetry, type Telemetry } from "@agent-software-factory/telemetry/node";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { createApp } from "./app.ts";

// 受信の span (docs/adr/0047)。SDK を起動してから createApp を呼ぶ。
describe("受信のトレース", () => {
  const exporter = new InMemorySpanExporter();
  let telemetry: Telemetry;

  beforeAll(() => {
    telemetry = startTelemetry({
      env: {},
      serviceName: "api-test",
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });
  });
  afterAll(() => telemetry.shutdown());

  it("リクエストごとに、メソッドと route を名前にした span ができる", async () => {
    const response = await createApp().request("/health");
    expect(response.status).toBe(200);
    // SimpleSpanProcessor は、resource の解決を待ってから exporter に渡す。
    await vi.waitFor(() =>
      expect(exporter.getFinishedSpans().map((span) => span.name)).toContain("GET /health"),
    );
  });

  it("クエリ文字列、リクエストのヘッダー、Cookie は span に載らない", async () => {
    exporter.reset();
    const secret = "s3cret-value-that-must-not-reach-a-trace";
    await createApp().request(`/health?code=${secret}`, {
      headers: { authorization: `Bearer ${secret}`, cookie: `session=${secret}` },
    });
    await vi.waitFor(() => expect(exporter.getFinishedSpans()).toHaveLength(1));
    const span = exporter.getFinishedSpans().find((s) => s.name === "GET /health");
    expect(span).toBeDefined();
    expect(JSON.stringify(span?.attributes)).toContain("/health");
    expect(JSON.stringify(span?.attributes)).not.toContain(secret);
  });
});
