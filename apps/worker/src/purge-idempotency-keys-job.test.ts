import { ApprovalTx } from "@agent-software-factory/approval";
import { ClaimTx } from "@agent-software-factory/claim";
import {
  countIdempotencyKeys,
  createTestDatabase,
  idempotencyKeyTableSql,
  seedIdempotencyKeys,
  type ExpiryExpression,
} from "@agent-software-factory/db/testing";
import { Database } from "@agent-software-factory/shared-kernel";
import { Effect } from "effect";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  asModule,
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

  const seed = (module: string, tenant: string, count: number, expiry: ExpiryExpression) =>
    seedIdempotencyKeys(current.db.superuser, { module, tenantId: tenant, count, expiry });
  const countIn = (module: string, tenant: string) =>
    countIdempotencyKeys(current.db.superuser, module, tenant);

  it("モジュールごとに、指定したテナントの期限切れの行だけを、上限ごとに消すこと", async () => {
    await current.db.migrator.query(idempotencyKeyTableSql("claim"));
    await current.db.migrator.query(idempotencyKeyTableSql("approval"));
    for (const module of ["claim", "approval"]) {
      await seed(module, tenantId, 3, "expired");
      await seed(module, tenantId, 2, "alive");
      await seed(module, otherTenant, 4, "expired");
    }
    const input: PurgeJobInput = {
      modules: [asModule(ClaimTx), asModule(ApprovalTx)],
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
