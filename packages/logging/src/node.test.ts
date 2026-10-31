import { context, trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { LogContext, LogFields } from "./index.ts";
import { createNodeLogger, type NodeLoggerOptions } from "./node.ts";
import { memoryDestination } from "./testing.ts";

const service = { name: "api", version: "1.2.3", environment: "test" } as const;

function setup(options: Partial<NodeLoggerOptions> = {}) {
  const { chunks, lines, write } = memoryDestination();
  const logger = createNodeLogger({
    destination: { write },
    level: "debug",
    service,
    now: () => "2025-08-26T10:30:00.123Z",
    ...options,
  });
  return { logger, chunks, lines };
}

describe("出力の形 (docs/logging/format.md、keys.md)", () => {
  it("1 行が 1 つの JSON で、共通のキーが付く", () => {
    const { logger, chunks, lines } = setup();
    logger.info("hello", { "url.path": "/a" });

    expect(chunks[0]?.endsWith("\n")).toBe(true);
    expect(lines()).toEqual([
      {
        timestamp: "2025-08-26T10:30:00.123Z",
        "severity.text": "INFO",
        level: "INFO",
        message: "hello",
        "service.name": "api",
        "service.version": "1.2.3",
        "deployment.environment": "test",
        "url.path": "/a",
      },
    ]);
  });

  it("timestamp は UTC のミリ秒 3 桁 (既定の時計)", () => {
    const { lines, write } = memoryDestination();
    createNodeLogger({ destination: { write }, level: "info", service }).info("x");
    expect(lines()[0]?.["timestamp"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("pid と hostname は付けない", () => {
    const { logger, lines } = setup();
    logger.info("x");
    expect(lines()[0]).not.toHaveProperty("pid");
    expect(lines()[0]).not.toHaveProperty("hostname");
  });

  it.each(["debug", "info"] as const)("%s は渡した文言を message にする", (method) => {
    const { logger, lines } = setup();
    logger[method]("m");
    expect(lines()[0]).toMatchObject({ message: "m", level: method.toUpperCase() });
  });
});

describe("レベル", () => {
  it("LOG_LEVEL より低いレベルは出さない", () => {
    const { logger, lines } = setup({ level: "warn" });
    logger.debug("d");
    logger.info("i");
    expect(lines()).toEqual([]);
  });

  it("info のとき debug は出さず、info は出す", () => {
    const { logger, lines } = setup({ level: "info" });
    logger.debug("d");
    logger.info("i");
    expect(lines().map((line) => line["message"])).toEqual(["i"]);
  });
});

describe("メッセージコード (docs/logging/message-codes.md)", () => {
  it("error は定義の文言と event.code を付ける", () => {
    const { logger, lines } = setup();
    logger.error("API-001", { "exception.type": "TypeError" });
    expect(lines()[0]).toMatchObject({
      "severity.text": "ERROR",
      level: "ERROR",
      "event.code": "API-001",
      message: "An unexpected error occurred while handling a request.",
      "exception.type": "TypeError",
    });
  });

  it("fatal は入口が使い、event.code を付ける", () => {
    const { logger, lines } = setup();
    logger.fatal("API-002");
    expect(lines()[0]).toMatchObject({
      "severity.text": "FATAL",
      level: "FATAL",
      "event.code": "API-002",
    });
  });

  it("info には event.code を付けない", () => {
    const { logger, lines } = setup();
    logger.info("x");
    expect(lines()[0]).not.toHaveProperty("event.code");
  });
});

describe("リクエストの文脈", () => {
  it("http.request.id、tenant_id、user.id を毎行に付ける", () => {
    const current: LogContext = { requestId: "req-1", tenantId: "t-1", userId: "u-1" };
    const { logger, lines } = setup({ context: () => current });
    logger.info("a");
    logger.error("API-001");
    for (const line of lines())
      expect(line).toMatchObject({
        "http.request.id": "req-1",
        tenant_id: "t-1",
        "user.id": "u-1",
      });
  });

  it("文脈の値は呼ぶたびに読む (あとから分かる user.id が付く)", () => {
    let current: LogContext = { requestId: "req-1" };
    const { logger, lines } = setup({ context: () => current });
    logger.info("before");
    current = { requestId: "req-1", userId: "u-1" };
    logger.info("after");
    expect(lines()[0]).not.toHaveProperty("user.id");
    expect(lines()[1]).toMatchObject({ "user.id": "u-1" });
  });

  it("文脈の一部だけでも、あるものだけを付ける", () => {
    const { logger, lines } = setup({ context: () => ({ tenantId: "t-1" }) });
    logger.info("x");
    expect(lines()[0]).toMatchObject({ tenant_id: "t-1" });
    expect(lines()[0]).not.toHaveProperty("http.request.id");
    expect(lines()[0]).not.toHaveProperty("user.id");
  });

  it("未ログインなら user.id を付けない。文脈がなければどれも付けない", () => {
    const { logger, lines } = setup({ context: () => undefined });
    logger.info("x");
    expect(lines()[0]).not.toHaveProperty("http.request.id");
    expect(lines()[0]).not.toHaveProperty("user.id");
    expect(lines()[0]).not.toHaveProperty("tenant_id");
  });
});

describe("トレースの相関 (docs/adr/0048)", () => {
  const exporter = new InMemorySpanExporter();
  const sdk = new NodeSDK({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
    metricReaders: [],
    logRecordProcessors: [],
  });
  beforeAll(() => sdk.start());
  afterAll(() => sdk.shutdown());

  it("今の span の trace_id、span_id、trace_flags を付ける", () => {
    const { logger, lines } = setup();
    trace.getTracer("test").startActiveSpan("work", (span) => {
      logger.info("inside");
      const { traceId, spanId } = span.spanContext();
      expect(lines()[0]).toMatchObject({ trace_id: traceId, span_id: spanId, trace_flags: "01" });
      span.end();
    });
  });

  it("無効な span の context (すべて 0) なら付けない", () => {
    const { logger, lines } = setup();
    const invalid = trace.wrapSpanContext({
      traceId: "0".repeat(32),
      spanId: "0".repeat(16),
      traceFlags: 0,
    });
    context.with(trace.setSpan(context.active(), invalid), () => logger.info("invalid"));
    expect(lines()[0]).not.toHaveProperty("trace_id");
  });

  it("span がなくても動き、trace_id を付けない", () => {
    const { logger, lines } = setup();
    expect(trace.getActiveSpan()).toBeUndefined();
    context.with(context.active(), () => logger.info("outside"));
    expect(lines()[0]).not.toHaveProperty("trace_id");
    expect(lines()[0]).not.toHaveProperty("span_id");
    expect(lines()[0]).not.toHaveProperty("trace_flags");
  });
});

describe("マスク (docs/logging/security.md)", () => {
  // LogFields の型は秘匿キーを渡せない (1 層目)。2 層目の redact は、型を迂回した値の最後の防御。
  const leak = (fields: Record<string, unknown>): LogFields => fields;

  it("最上位と 1 段下の秘匿キーを [REDACTED] にする", () => {
    const { logger, lines } = setup();
    logger.info(
      "x",
      leak({
        password: "p1",
        authorization: "Bearer t1",
        "set-cookie": "sid=1",
        nested: { token: "t2", client_secret: "s1", "set-cookie": "sid=2" },
      }),
    );
    const text = JSON.stringify(lines()[0]);
    for (const secret of ["p1", "Bearer t1", "sid=1", "t2", "s1", "sid=2"])
      expect(text).not.toContain(secret);
    expect(lines()[0]).toMatchObject({ password: "[REDACTED]", nested: { token: "[REDACTED]" } });
  });

  it("pg のエラーの detail、where、parameters を出さない", () => {
    const { logger, lines } = setup();
    logger.info(
      "x",
      leak({ detail: "Key (email)=(a@example.com)", where: "COPY", parameters: ["a@example.com"] }),
    );
    expect(JSON.stringify(lines()[0])).not.toContain("a@example.com");
  });

  // 守れないものを、守れないまま書いておく。3 層目 (CloudWatch Logs のデータ保護) と、発生源で載せないことで受け止める。
  it("守れないもの: message の文字列に混ぜた値は消えない", () => {
    const { logger, lines } = setup();
    logger.info("login failed with password=hunter2");
    expect(JSON.stringify(lines()[0])).toContain("hunter2");
  });

  it("守れないもの: 綴りの違うキーと、2 段より深い値は消えない", () => {
    const { logger, lines } = setup();
    logger.info("x", leak({ Password: "hunter3", a: { b: { password: "hunter4" } } })); // betterleaks:allow
    const text = JSON.stringify(lines()[0]);
    expect(text).toContain("hunter3");
    expect(text).toContain("hunter4");
  });
});
