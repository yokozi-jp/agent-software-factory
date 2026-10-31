import { createNodeLogger } from "@agent-software-factory/logging/node";
import { memoryDestination } from "@agent-software-factory/logging/testing";
import { SpanKind } from "@opentelemetry/api";
import { startTelemetry, type Telemetry } from "@agent-software-factory/telemetry/node";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { createApp } from "./app.ts";
import { unusedRuntime } from "./runtime.ts";
import { requestLogContext } from "./http/logging.ts";

// 受信の span (docs/adr/0048)。SDK を起動してから createApp を呼ぶ。
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
    const response = await createApp({ runtime: unusedRuntime() }).request("/health");
    expect(response.status).toBe(200);
    // SimpleSpanProcessor は、resource の解決を待ってから exporter に渡す。
    await vi.waitFor(() =>
      expect(exporter.getFinishedSpans().map((span) => span.name)).toContain("GET /health"),
    );
    // 受信の span は @hono/otel だけが作る。instrumentation-http を入れていれば、ここが 2 本になる (docs/adr/0048)。
    expect(
      exporter.getFinishedSpans().filter((span) => span.kind === SpanKind.SERVER),
    ).toHaveLength(1);
  });

  it("エラー応答の trace_id は、受信の span の trace id と同じ (docs/adr/0035)", async () => {
    exporter.reset();

    const res = await createApp({ runtime: unusedRuntime() }).request("/not-found");
    const body: unknown = await res.json();

    await vi.waitFor(() => expect(exporter.getFinishedSpans()).not.toHaveLength(0));
    expect(body).toMatchObject({
      trace_id: exporter.getFinishedSpans()[0]?.spanContext().traceId,
    });
  });

  it("クエリ文字列、リクエストのヘッダー、Cookie は span に載らない", async () => {
    exporter.reset();
    const secret = "s3cret-value-that-must-not-reach-a-trace";
    await createApp({ runtime: unusedRuntime() }).request(`/health?code=${secret}`, {
      headers: { authorization: `Bearer ${secret}`, cookie: `session=${secret}` },
    });
    await vi.waitFor(() => expect(exporter.getFinishedSpans()).toHaveLength(1));
    const span = exporter.getFinishedSpans().find((s) => s.name === "GET /health");
    expect(span).toBeDefined();
    expect(JSON.stringify(span?.attributes)).toContain("/health");
    expect(JSON.stringify(span?.attributes)).not.toContain(secret);
  });

  it("ログの trace_id、span_id、trace_flags は、@hono/otel の受信の span と同じ (docs/adr/0049)", async () => {
    exporter.reset();
    const { lines, write } = memoryDestination();
    const logger = createNodeLogger({
      destination: { write },
      level: "debug",
      service: { name: "api-test", version: "0", environment: "test" },
      context: requestLogContext,
    });

    await createApp({ runtime: unusedRuntime(), logger }).request("/not-found");

    await vi.waitFor(() => expect(exporter.getFinishedSpans()).not.toHaveLength(0));
    const span = exporter.getFinishedSpans()[0]?.spanContext();
    // アクセスログの 2 行と、onError を通らない 404 だけ。どの行も同じ span を指す。
    expect(lines()).toHaveLength(2);
    for (const line of lines())
      expect(line).toMatchObject({
        trace_id: span?.traceId,
        span_id: span?.spanId,
        trace_flags: "01",
      });
  });
});
