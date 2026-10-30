import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { activeTraceFields } from "./index.ts";
import { startTelemetry, type Telemetry } from "./node.ts";

describe("activeTraceFields", () => {
  let telemetry: Telemetry;

  beforeAll(() => {
    telemetry = startTelemetry({
      env: {},
      serviceName: "test",
      spanProcessors: [new SimpleSpanProcessor({ exporter: new InMemorySpanExporter() })],
    });
  });
  afterAll(() => telemetry.shutdown());

  it("span の外では undefined を返す", () => {
    expect(activeTraceFields()).toBeUndefined();
  });

  it("span の中では、その span の trace_id、span_id、trace_flags を W3C の桁数で返す", () => {
    trace.getTracer("test").startActiveSpan("work", (span) => {
      const fields = activeTraceFields();
      const context = span.spanContext();
      expect(fields).toEqual({
        trace_id: context.traceId,
        span_id: context.spanId,
        trace_flags: "01",
      });
      expect(fields?.trace_id).toMatch(/^[0-9a-f]{32}$/);
      expect(fields?.span_id).toMatch(/^[0-9a-f]{16}$/);
      span.end();
    });
  });
});
