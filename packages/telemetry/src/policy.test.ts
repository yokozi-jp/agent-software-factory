// 計装が、既定で危ない属性を取らないことの試験 (保証カタログ「計装が既定で危ない属性を取らない」、docs/adr/0048)。
// 方針の値と、実際に出る span の両方を見る: 値だけだと、計装の既定が変わったときに気づかない。
import { createServer } from "node:http";

import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { startTelemetry, type Telemetry } from "./node.ts";
import {
  awsSdkInstrumentationConfig,
  pgInstrumentationConfig,
  undiciInstrumentationConfig,
} from "./policy.ts";

const secret = "s3cret-value-that-must-not-reach-a-trace";

describe("取る属性の方針", () => {
  it("pg は SQL の値を取らず、接続の span を切る", () => {
    expect(pgInstrumentationConfig.enhancedDatabaseReporting).toBe(false);
    expect(pgInstrumentationConfig.ignoreConnectSpans).toBe(true);
    expect(pgInstrumentationConfig.addSqlCommenterCommentToQueries).toBe(false);
  });

  it("fetch の計装は、ヘッダーを属性にする設定を持たず、hook はクエリを落とす 1 つだけ", () => {
    expect(Object.keys(undiciInstrumentationConfig)).toEqual(["requestHook"]);
  });

  it("AWS SDK の計装は、入力と応答を属性にする hook を持たない", () => {
    expect(Object.keys(awsSdkInstrumentationConfig)).toEqual(["suppressInternalInstrumentation"]);
  });
});

describe("出た span に載っているもの", () => {
  const exporter = new InMemorySpanExporter();
  let telemetry: Telemetry;

  beforeAll(() => {
    telemetry = startTelemetry({
      env: {},
      serviceName: "test",
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });
  });
  afterAll(() => telemetry.shutdown());

  it("fetch の span に、リクエストのヘッダー、body、クエリ文字列の値が載らない", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("x-response-secret", secret);
      response.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    const { port } = address;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/path?api_key=${secret}`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, cookie: `session=${secret}` },
        body: JSON.stringify({ password: secret }),
      });
      await response.text();
    } finally {
      server.close();
    }
    // span は、レスポンスを読み終えたあとの非同期の通知で閉じる。
    await vi.waitFor(() => expect(exporter.getFinishedSpans().length).toBeGreaterThan(0));
    const spans = exporter.getFinishedSpans();
    // 載るのは送り先とメソッドとステータスで、これが空だと次の検査が何も見ていない。
    expect(JSON.stringify(spans.map((span) => span.attributes))).toContain("url.path");
    expect(JSON.stringify(spans.map((span) => span.attributes))).not.toContain(secret);
  });

  it("pg の span に、パラメータ化したクエリの値が載らない", async () => {
    exporter.reset();
    // pg は CommonJS で、計装は require を差し替える。計装より前に評価されないよう、起動後に import する。
    const { Client } = (await import("pg")).default;
    const client = new Client({
      host: "127.0.0.1",
      // 誰も待ち受けない port。接続に失敗しても、query を呼んだ時点の span は作られる。
      port: 1,
      connectionTimeoutMillis: 500,
    });
    // 接続の前に呼ぶ query は、接続の失敗で拒否される。span は呼んだ時点で始まる。
    await Promise.all([
      client.connect().catch(() => undefined),
      client.query("SELECT $1::text AS value", [secret]).catch(() => undefined),
    ]);
    const spans = exporter.getFinishedSpans();
    const pgSpan = spans.find((span) => JSON.stringify(span.attributes).includes("SELECT"));
    expect(pgSpan).toBeDefined();
    expect(JSON.stringify(pgSpan?.attributes)).toContain("$1");
    expect(JSON.stringify(spans.map((span) => span.attributes))).not.toContain(secret);
  });
});
