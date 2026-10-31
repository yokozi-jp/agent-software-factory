// 手元の ElasticMQ に、通知メールのキューと DLQ を作る (docs/tooling/local-worker.md)。入口なので process を読む。
// 同じ名前で作り直しても同じ URL を返すので、何度流してもよい。
import { createNotificationQueues, createSqsClient } from "../queues.ts";

const endpoint = process.env.SQS_ENDPOINT;
if (endpoint === undefined || endpoint === "") {
  process.stderr.write("環境変数 SQS_ENDPOINT が必要 (例: http://127.0.0.1:9324)\n");
  process.exit(2);
}

const sqs = createSqsClient({ endpoint });
try {
  const queues = await createNotificationQueues(sqs, { name: "notification-mail" });
  process.stdout.write(`queue: ${queues.queueUrl}\ndlq:   ${queues.dlqUrl}\n`);
} finally {
  sqs.destroy();
}
