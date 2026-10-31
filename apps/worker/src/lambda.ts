// Node.js 24 には Temporal がない (Node.js 26 から組み込み、docs/adr/0043)。polyfill の global を入れる。
import "temporal-polyfill/global";
import { loadEnv, workerEnvSchema } from "./env.ts";
import { createLambdaHandler } from "./lambda-handler.ts";
import { reportFailure } from "./log.ts";
import { createWorker } from "./runtime.ts";

// Lambda のワーカーの入口 (Event Functions、docs/adr/0013、docs/adr/0041)。入口だけが process.env を読む。
// 実行環境ごとに 1 回だけ、起動のときに runtime を作る。pool は 1 本にする (DATABASE_POOL_MAX=1)。
// 実行環境は止める合図を待たずに凍結されるので、worker.close() は呼ばない。
const worker = createWorker(loadEnv(workerEnvSchema, process.env));

/** 失敗したメッセージだけを `batchItemFailures` に入れて返す。event source mapping に ReportBatchItemFailures が要る。 */
export const handler = createLambdaHandler({ handle: worker.handle, onError: reportFailure });
