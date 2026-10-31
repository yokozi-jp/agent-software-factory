import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  elasticMqClient,
  messageCount,
  newShortQueues,
  sendBody,
  waitForBody,
} from "../test/queue.ts";
import { mailTo, newRecipient, waitForMail } from "../test/mailpit.ts";
import { failFirst, mailpitLayer, notificationMessage, useWorker } from "../test/use-worker.ts";
import { pollQueue } from "./poller.ts";

// ECS のワーカー (pollQueue) を、本物の ElasticMQ、PostgreSQL、Mailpit につなぐ (Issue #366、docs/adr/0041)。結合テストは、
// 正常の流れと、代表の DLQ に絞る (docs/async/testing.md)。可視性タイムアウトは 1 秒に縮める。
describe("ECS のワーカー", () => {
  const ctx = useWorker();
  const sqs = elasticMqClient();
  const stops: AbortController[] = [];
  const loops: Promise<void>[] = [];

  afterEach(async () => {
    for (const stop of stops.splice(0)) stop.abort();
    await Promise.all(loops.splice(0));
  });

  /** `handle` でキューを読む繰り返しを始める。 */
  const startWorker = (
    queueUrl: string,
    handle: (m: { messageId: string; body: string }) => Promise<void>,
  ) => {
    const stop = new AbortController();
    const errors: { error: unknown; messageId: string | undefined }[] = [];
    stops.push(stop);
    loops.push(
      pollQueue({
        sqs,
        queueUrl,
        handle,
        signal: stop.signal,
        onError: (error, messageId) => errors.push({ error, messageId }),
        waitTimeSeconds: 1,
        retryDelayMillis: 50,
      }),
    );
    return { stop, errors };
  };

  it("キューのメッセージを読んで 1 通送り、メッセージを消すこと", async () => {
    const { queueUrl } = await newShortQueues(sqs);
    const to = newRecipient();
    const { handle } = ctx.worker();
    await sendBody(sqs, queueUrl, JSON.stringify(notificationMessage({ to })));

    const { stop, errors } = startWorker(queueUrl, handle);

    expect(await waitForMail(to, 1)).toHaveLength(1);
    // 消すのは処理の後。可視性タイムアウト (1 秒) が切れても戻ってこないこと。
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    stop.abort();
    expect(await messageCount(sqs, queueUrl)).toBe(0);
    expect(await mailTo(to)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("5 回失敗したメッセージは DLQ に移り、メールは届かないこと", async () => {
    const { queueUrl, dlqUrl } = await newShortQueues(sqs);
    const to = newRecipient();
    const body = JSON.stringify(notificationMessage({ to }));
    // 送信が毎回失敗する。アプリは DLQ へ送らず、例外を返すだけ (docs/adr/0041)。
    const { handle } = ctx.worker(failFirst(Number.POSITIVE_INFINITY, mailpitLayer()));
    await sendBody(sqs, queueUrl, body);

    const { stop, errors } = startWorker(queueUrl, handle);

    expect(await waitForBody(sqs, dlqUrl, 40)).toBe(body);
    stop.abort();
    // maxReceiveCount の 5 回、処理に失敗している。
    expect(errors).toHaveLength(5);
    expect(await mailTo(to)).toHaveLength(0);
    expect(await ctx.processedCount()).toBe(0);
  });

  it("失敗したメッセージの次のメッセージも、続けて処理すること", async () => {
    const { queueUrl } = await newShortQueues(sqs);
    const to = newRecipient();
    const { handle } = ctx.worker();
    await sendBody(sqs, queueUrl, "not json");
    await sendBody(sqs, queueUrl, JSON.stringify(notificationMessage({ to })));

    const { errors } = startWorker(queueUrl, handle);

    expect(await waitForMail(to, 1)).toHaveLength(1);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});
