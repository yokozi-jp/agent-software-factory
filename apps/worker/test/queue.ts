import {
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import { inject } from "vite-plus/test";

import { createNotificationQueues, createSqsClient } from "../src/queues.ts";

/** ElasticMQ に向けた SQS の client。仮の認証情報だけで動く。`AWS_USE_DUALSTACK_ENDPOINT` は渡さない (createSqsClient が固定する)。 */
export const elasticMqClient = (): SQSClient =>
  createSqsClient({
    endpoint: inject("sqsEndpoint"),
    region: "ap-northeast-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });

/** テストごとに別のキューを作るための名前。ElasticMQ は全テストで共有する。 */
export const uniqueQueueName = (): string => `notification-mail-${crypto.randomUUID()}`;

export const sendBody = (sqs: SQSClient, queueUrl: string, body: string) =>
  sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));

/** キューにあるメッセージの数 (見えるものと、処理中で見えないもの)。 */
export async function messageCount(sqs: SQSClient, queueUrl: string): Promise<number> {
  const { Attributes } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
    }),
  );
  return (
    Number(Attributes?.["ApproximateNumberOfMessages"] ?? 0) +
    Number(Attributes?.["ApproximateNumberOfMessagesNotVisible"] ?? 0)
  );
}

/** `queueUrl` に `body` のメッセージが届くまで待つ (最大 `seconds` 秒)。届いたら本文を返し、届かなければ undefined。 */
export async function waitForBody(
  sqs: SQSClient,
  queueUrl: string,
  seconds: number,
): Promise<string | undefined> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const { Messages } = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 1 }),
    );
    if (Messages?.[0]?.Body !== undefined) return Messages[0].Body;
  }
  return undefined;
}

/** 可視性タイムアウトを 1 秒に縮めた、通知メールのキューと DLQ を新しく作る (試験用、docs/adr/0041)。 */
export const newShortQueues = (sqs: SQSClient) =>
  createNotificationQueues(sqs, { name: uniqueQueueName(), visibilityTimeoutSeconds: 1 });
