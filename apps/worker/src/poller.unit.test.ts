import { SQSClient } from "@aws-sdk/client-sqs";
import { createServer } from "node:http";
import { describe, expect, it } from "vite-plus/test";

import { pollQueue } from "./poller.ts";

describe("キューを読む繰り返し", () => {
  it("SQS に届かないときは、失敗を知らせて待ってから読み直し、停止の合図で止まること", async () => {
    // つながらないポート。SDK の再試行は 1 回にして、すぐ失敗させる。
    const sqs = new SQSClient({
      endpoint: "http://127.0.0.1:1",
      region: "ap-northeast-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      maxAttempts: 1,
    });
    const stop = new AbortController();
    const errors: unknown[] = [];

    const loop = pollQueue({
      sqs,
      queueUrl: "http://127.0.0.1:1/000000000000/q",
      handle: () => Promise.resolve(),
      signal: stop.signal,
      onError: (error, messageId) => {
        errors.push([error, messageId]);
        if (errors.length === 2) stop.abort();
      },
      retryDelayMillis: 10,
    });

    await loop;
    expect(errors).toHaveLength(2);
    expect(errors.every((entry) => Array.isArray(entry) && entry[1] === undefined)).toBe(true);
  });

  it("停止の合図が先に出ていれば、何も読まずに終わること", async () => {
    const sqs = new SQSClient({ endpoint: "http://127.0.0.1:1", region: "ap-northeast-1" });
    const stop = new AbortController();
    stop.abort();

    await expect(
      pollQueue({
        sqs,
        queueUrl: "http://127.0.0.1:1/000000000000/q",
        handle: () => Promise.reject(new Error("must not be called")),
        signal: stop.signal,
        onError: () => {
          throw new Error("must not be called");
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("受信の最中に停止の合図が出たら、失敗として知らせずに止まること", async () => {
    // 応答しないサーバー。long polling で待っているところに、停止の合図が出る。
    const server = createServer(() => undefined);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("the server has no port");
    const { port } = address;
    const sqs = new SQSClient({
      endpoint: `http://127.0.0.1:${port}`,
      region: "ap-northeast-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    const stop = new AbortController();
    const errors: unknown[] = [];

    const loop = pollQueue({
      sqs,
      queueUrl: `http://127.0.0.1:${port}/000000000000/q`,
      handle: () => Promise.resolve(),
      signal: stop.signal,
      onError: (error) => errors.push(error),
    });
    setTimeout(() => stop.abort(), 100);

    await loop;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    expect(errors).toEqual([]);
  });

  it("メッセージのない応答 (Messages が省かれる) では何も処理せず、続けて読むこと", async () => {
    // 本物の SQS は、キューが空のとき Messages を返さない。2 回目の受信で止める。
    let receives = 0;
    const stop = new AbortController();
    const server = createServer((_request, response) => {
      receives += 1;
      if (receives === 2) stop.abort();
      response.writeHead(200, { "content-type": "application/x-amz-json-1.0" });
      response.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("the server has no port");
    const sqs = new SQSClient({
      endpoint: `http://127.0.0.1:${address.port}`,
      region: "ap-northeast-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });

    await pollQueue({
      sqs,
      queueUrl: `http://127.0.0.1:${address.port}/000000000000/q`,
      handle: () => Promise.reject(new Error("must not be called")),
      signal: stop.signal,
      onError: () => {
        throw new Error("must not be called");
      },
    });

    await new Promise((resolve) => server.close(resolve));
    expect(receives).toBe(2);
  });
});
