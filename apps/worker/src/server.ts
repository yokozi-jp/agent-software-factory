// Node.js 24 には Temporal がない (Node.js 26 から組み込み、docs/adr/0043)。polyfill の global を入れる。
import "temporal-polyfill/global";
import { ecsEnvSchema, loadEnv } from "./env.ts";
import { reportFailure } from "./log.ts";
import { pollQueue } from "./poller.ts";
import { createSqsClient } from "./queues.ts";
import { createWorker } from "./runtime.ts";

// ECS のワーカーの入口 (docs/adr/0013、docs/adr/0041): 通知メールのキューを読む繰り返し。入口だけが process.env を読む。
// 検査に通らなければここで例外になり、起動しない (docs/adr/0032)。
const env = loadEnv(ecsEnvSchema, process.env);

const worker = createWorker(env);
const sqs = createSqsClient(env.SQS_ENDPOINT === undefined ? {} : { endpoint: env.SQS_ENDPOINT });

// 停止の合図で、処理中の 1 件を終えてから止める。
const stop = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => stop.abort());

console.log("notification worker started");
try {
  await pollQueue({
    sqs,
    queueUrl: env.NOTIFICATION_QUEUE_URL,
    handle: worker.handle,
    signal: stop.signal,
    onError: reportFailure,
  });
} finally {
  sqs.destroy();
  await worker.close();
}
