// Node.js 24 には Temporal がない (Node.js 26 から組み込み、docs/adr/0043)。polyfill の global を入れる。
import "temporal-polyfill/global";
import { createDatabase } from "@agent-software-factory/db/node";
import { Database } from "@agent-software-factory/shared-kernel/tenant-db";
import { Effect } from "effect";

import { loadEnv, purgeEnvSchema } from "./env.ts";
import {
  idempotencyKeyModules,
  purgeFinishedLine,
  runPurgeJob,
  type PurgeJobInput,
} from "./purge-idempotency-keys-job.ts";

// 期限切れの冪等キーを消すバッチの入口 (Issue #325、docs/adr/0013、docs/adr/0040)。ECS のタスクのコマンドとして動き、
// 1 回で 1 つのテナントを受け持つ。入口だけが process.env を読む。検査に通らなければここで例外になり、起動しない (docs/adr/0032)。
const env = loadEnv(purgeEnvSchema, process.env);
const input: PurgeJobInput = {
  modules: idempotencyKeyModules,
  tenantId: env.TENANT_ID,
  txId: env.TX_ID,
  batchSize: env.PURGE_BATCH_SIZE,
};

const db = createDatabase({
  connectionString: env.APP_DATABASE_URL,
  max: env.DATABASE_POOL_MAX ?? 1,
});
try {
  const result = await Effect.runPromise(
    runPurgeJob(input).pipe(Effect.provide(Database.layer(db))),
  );
  console.log(purgeFinishedLine(input, result));
} finally {
  await db.destroy();
}
