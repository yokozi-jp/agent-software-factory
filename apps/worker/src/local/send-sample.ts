// 通知メールのキューに、サンプルのメッセージを 1 件入れる (docs/tooling/local-worker.md)。本来は Outbox を送る処理が入れる
// (その処理は未実装、Issue #366)。入口なので process を読む。
//   pnpm send-sample [宛先のメールアドレス]
// `id` は毎回新しくする。同じ `id` は processed_message で重複として捨てられ、メールが出ない。
import { SendMessageCommand } from "@aws-sdk/client-sqs";

import { createSqsClient } from "../queues.ts";

const queueUrl = process.env.NOTIFICATION_QUEUE_URL;
const endpoint = process.env.SQS_ENDPOINT;
if (queueUrl === undefined || queueUrl === "" || endpoint === undefined || endpoint === "") {
  process.stderr.write("環境変数 NOTIFICATION_QUEUE_URL と SQS_ENDPOINT が必要\n");
  process.exit(2);
}

// packages/approval/events/test/fixtures/approval.notification_requested.v1.json と同じ形。
const message = {
  id: crypto.randomUUID(),
  tenantId: "11111111-1111-4111-8111-111111111111",
  kind: "approval.notification_requested",
  version: 1,
  occurredAt: new Date().toISOString(),
  to: process.argv[2] ?? "manager@example.com",
  template: "review_requested",
  values: { applicantName: "山田 太郎", claimTitle: "10月の交通費" },
};

const sqs = createSqsClient({ endpoint });
try {
  const sent = await sqs.send(
    new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }),
  );
  process.stdout.write(
    `sent: ${message.id} (SQS message ${sent.MessageId ?? "?"}) to ${message.to}\n`,
  );
} finally {
  sqs.destroy();
}
