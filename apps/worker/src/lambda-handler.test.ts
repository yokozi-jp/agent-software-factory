import { describe, expect, it } from "vite-plus/test";

import { sqsEvent, sqsRecord } from "../test/sqs-event.ts";
import { mailTo, newRecipient, waitForMail } from "../test/mailpit.ts";
import { failFirst, mailpitLayer, notificationMessage, useWorker } from "../test/use-worker.ts";
import { createLambdaHandler } from "./lambda-handler.ts";

// Lambda のワーカーの handler(event) を、本物の PostgreSQL と Mailpit につなぐ (Issue #366、docs/adr/0041)。SQS のイベントの形の
// 値を作って直接呼ぶ。標準キューなので、失敗したメッセージだけが batchItemFailures に入り、後ろのメッセージは止まらない。
describe("Lambda のワーカー handler(event)", () => {
  const ctx = useWorker();

  const handlerFor = (mail?: Parameters<typeof ctx.worker>[0]) => {
    const failures: string[] = [];
    const { handle } = ctx.worker(mail);
    const handler = createLambdaHandler({
      handle,
      onError: (_error, messageId) => failures.push(messageId),
    });
    return { handler, failures };
  };

  it("成功と失敗の混ざったイベントを渡すと、失敗した 1 件だけが batchItemFailures に入ること", async () => {
    const { handler, failures } = handlerFor();
    const to = newRecipient();
    const event = sqsEvent([
      sqsRecord("m-1", JSON.stringify(notificationMessage({ to }))),
      sqsRecord("m-2", "not json"),
      sqsRecord("m-3", JSON.stringify(notificationMessage({ to, template: "sent_back" }))),
    ]);

    const response = await handler(event);

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "m-2" }] });
    expect(failures).toEqual(["m-2"]);
    // 失敗したメッセージより後ろのメッセージも処理している。
    expect(await waitForMail(to, 2)).toHaveLength(2);
  });

  it("送信が失敗したメッセージだけを返し、再配送のイベントで 1 通届いて空になること", async () => {
    const { handler } = handlerFor(failFirst(1, mailpitLayer()));
    const to = newRecipient();
    const first = sqsRecord("m-1", JSON.stringify(notificationMessage({ to })));
    const second = sqsRecord("m-2", JSON.stringify(notificationMessage({ to })));

    const afterFirstDelivery = await handler(sqsEvent([first, second]));
    const afterRedelivery = await handler(sqsEvent([first]));

    expect(afterFirstDelivery).toEqual({ batchItemFailures: [{ itemIdentifier: "m-1" }] });
    expect(afterRedelivery).toEqual({ batchItemFailures: [] });
    expect(await waitForMail(to, 2)).toHaveLength(2);
  });

  it("全部成功したイベントには、空の batchItemFailures を返すこと", async () => {
    const { handler } = handlerFor();
    const to = newRecipient();

    const response = await handler(
      sqsEvent([sqsRecord("m-1", JSON.stringify(notificationMessage({ to })))]),
    );

    expect(response).toEqual({ batchItemFailures: [] });
    expect(await waitForMail(to, 1)).toHaveLength(1);
    expect(await mailTo(to)).toHaveLength(1);
  });
});
