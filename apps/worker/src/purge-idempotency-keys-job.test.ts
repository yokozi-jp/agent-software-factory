import { idempotencyKeyTableSql, createTestDatabase } from "@agent-software-factory/db/testing";
import { Database, type ModuleTx } from "@agent-software-factory/shared-kernel";
import { Context, Effect } from "effect";
import type { Kysely, Transaction } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  idempotencyKeyModules,
  purgeFinishedLine,
  runPurgeJob,
  type PurgeJobInput,
} from "./purge-idempotency-keys-job.ts";
import { createDatabase } from "./runtime.ts";

// 期限切れの冪等キーを消すバッチの本体 (Issue #325、docs/adr/0040): 本物の PostgreSQL で、入口と同じ pool (app_user) から動かす。
// 消し方そのもの (期限、テナント、上限、ロック) は shared-kernel の purgeExpiredIdempotencyKeys を apps/api の結合テストが確かめる。
const tenantId = "00000000-0000-4000-8000-00000000000a";
const otherTenant = "00000000-0000-4000-8000-00000000000b";

// 試験用の DB の型。表の中身は、掃除が SQL で直接書くので持たない。
interface TestDb {
  "claim.idempotency_key": { tenant_id: string };
}

// モジュールのコードに依存しないよう、試験用の Tx を 2 つ置く (schema は、テンプレートの DB にある claim と approval)。
class ClaimTestTx extends Context.Service<ClaimTestTx, Transaction<TestDb>>()("test/ClaimTx") {
  static readonly module = "claim" as const;
}
class ApprovalTestTx extends Context.Service<ApprovalTestTx, Transaction<TestDb>>()(
  "test/ApprovalTx",
) {
  static readonly module = "approval" as const;
}

// 配列に直接入れると、Context.Service の class の型の合成 (Unify) が static の module を落とす。1 つずつ ModuleTx に通す。
const asModule = <K extends ModuleTx>(tx: K): ModuleTx => tx;

describe("期限切れの冪等キーを消すバッチ", () => {
  let current: { db: Awaited<ReturnType<typeof createTestDatabase>>; kysely: Kysely<never> };

  beforeEach(async () => {
    const db = await createTestDatabase();
    current = {
      db,
      kysely: createDatabase({ connectionString: db.url("app_user"), max: 1 }),
    };
  });
  afterEach(async () => {
    await current.kysely.destroy();
    await current.db.close();
  });

  const seed = (module: string, tenant: string, count: number, expires: string) =>
    current.db.superuser.query(
      `INSERT INTO ${module}.idempotency_key
         (tenant_id, user_id, idempotency_key, request_hash, status_code, expires_at,
          created_at, created_by, created_pgm_cd, created_tx_id,
          updated_at, updated_by, updated_pgm_cd, updated_tx_id)
       SELECT $1::uuid, gen_random_uuid(), gen_random_uuid(), repeat('a', 64), 201, ${expires},
              now(), 'seed', 'seed', 'seed', now(), 'seed', 'seed', 'seed'
       FROM generate_series(1, $2::int)`,
      [tenant, count],
    );
  const countIn = async (module: string, tenant: string) =>
    Number(
      (
        await current.db.superuser.query<{ n: string }>(
          `SELECT count(*) AS n FROM ${module}.idempotency_key WHERE tenant_id = $1`,
          [tenant],
        )
      ).rows[0]?.n,
    );

  it("モジュールごとに、指定したテナントの期限切れの行だけを、上限ごとに消すこと", async () => {
    await current.db.migrator.query(idempotencyKeyTableSql("claim"));
    await current.db.migrator.query(idempotencyKeyTableSql("approval"));
    for (const module of ["claim", "approval"]) {
      await seed(module, tenantId, 3, "now() - interval '1 hour'");
      await seed(module, tenantId, 2, "now() + interval '1 hour'");
      await seed(module, otherTenant, 4, "now() - interval '1 hour'");
    }
    const input: PurgeJobInput = {
      modules: [asModule(ClaimTestTx), asModule(ApprovalTestTx)],
      tenantId,
      txId: "exec-1",
      batchSize: 2,
    };

    const result = await Effect.runPromise(
      runPurgeJob(input).pipe(Effect.provide(Database.layer(current.kysely))),
    );

    expect(result).toEqual({
      claim: { deleted: 3, batches: 2 },
      approval: { deleted: 3, batches: 2 },
    });
    for (const module of ["claim", "approval"]) {
      expect(await countIn(module, tenantId)).toBe(2);
      expect(await countIn(module, otherTenant)).toBe(4);
    }
  });

  it("モジュールがなければ何もせず、空の結果を返すこと", async () => {
    const result = await Effect.runPromise(
      runPurgeJob({ modules: [], tenantId, txId: "exec-2" }).pipe(
        Effect.provide(Database.layer(current.kysely)),
      ),
    );

    expect(result).toEqual({});
  });

  it("idempotencyKeyModules は、冪等キーの表を持つスキーマと一致すること", async () => {
    const tables = await current.db.superuser.query<{ table_schema: string }>(
      `SELECT table_schema FROM information_schema.tables
       WHERE table_name = 'idempotency_key' AND table_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY table_schema`,
    );

    expect(idempotencyKeyModules.map((tx) => tx.module).toSorted()).toEqual(
      tables.rows.map((row) => row.table_schema),
    );
  });

  it("終了のログは、件数だけを 1 行の JSON にすること", () => {
    const line = purgeFinishedLine(
      { modules: [], tenantId, txId: "exec-3" },
      { claim: { deleted: 5, batches: 1 } },
    );

    expect(JSON.parse(line)).toEqual({
      level: "info",
      event: "idempotency_key_purge_finished",
      txId: "exec-3",
      tenantId,
      "batch.stats": { claim: { deleted: 5, batches: 1 } },
    });
  });
});
