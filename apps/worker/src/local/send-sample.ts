// 通知メールのキューに、サンプルのメッセージを 1 件入れる (docs/tooling/local-worker.md)。本来は Outbox を送る処理が入れる
// (その処理は未実装、Issue #366)。入口なので process を読む。
//   pnpm send-sample [宛先のメールアドレス]
// `id` は毎回新しくする。同じ `id` は processed_message で重複として捨てられ、メールが出ない。
import { readFileSync } from "node:fs";

import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { z } from "zod";

import { createSqsClient } from "../queues.ts";

const queueUrl = process.env.NOTIFICATION_QUEUE_URL;
const endpoint = process.env.SQS_ENDPOINT;
if (queueUrl === undefined || queueUrl === "" || endpoint === undefined || endpoint === "") {
  process.stderr.write("環境変数 NOTIFICATION_QUEUE_URL と SQS_ENDPOINT が必要\n");
  process.exit(2);
}

// 契約の fixture (packages/approval/events/test/fixtures) を元にして、重複として捨てられないよう id と時刻を替える。
const fixture = z
  .record(z.string(), z.unknown())
  .parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../../packages/approval/events/test/fixtures/approval.notification_requested.v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
const message = {
  ...fixture,
  id: crypto.randomUUID(),
  occurredAt: new Date().toISOString(),
  to: process.argv[2] ?? "manager@example.com",
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
