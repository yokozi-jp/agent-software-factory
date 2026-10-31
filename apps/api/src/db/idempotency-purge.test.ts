import { ClaimTx } from "@agent-software-factory/claim";
import { createPool } from "@agent-software-factory/db";
import { idempotencyKeyTableSql } from "@agent-software-factory/db/testing";
import {
  CurrentWrite,
  Database,
  inTenantTransaction,
  purgeExpiredIdempotencyKeys,
  withIdempotencyKey,
  type IdempotentResponse,
} from "@agent-software-factory/shared-kernel";
import { Deferred, Effect, Exit } from "effect";
import { Kysely, PostgresDialect } from "kysely";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useDatabase, writer } from "../../test/use-database.ts";

// purgeExpiredIdempotencyKeys (Issue #325、docs/adr/0040): 期限を過ぎた冪等キーの行だけを、テナントごとに、件数の上限を付けて
// 消す。実際の PostgreSQL で、残す行、別のテナント、複数回の実行、実行中の要求を確かめる。
const tenantA = "00000000-0000-4000-8000-00000000000a";
const tenantB = "00000000-0000-4000-8000-00000000000b";
const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("期限切れの冪等キーの掃除 purgeExpiredIdempotencyKeys", () => {
  const ctx = useDatabase();

  beforeEach(async () => {
    await ctx.db.migrator.query(idempotencyKeyTableSql("claim"));
  });

  /** `count` 行の冪等キーを、`expires` (SQL の式) の期限で、superuser が直接書く。RLS は superuser には効かない。 */
  const seed = async (tenantId: string, count: number, expires: string, key?: string) => {
    await ctx.db.superuser.query(
      `INSERT INTO claim.idempotency_key
         (tenant_id, user_id, idempotency_key, request_hash, status_code, expires_at,
          created_at, created_by, created_pgm_cd, created_tx_id,
          updated_at, updated_by, updated_pgm_cd, updated_tx_id)
       SELECT $1::uuid, $2::uuid, COALESCE($3::uuid, gen_random_uuid()), repeat('a', 64), 201, ${expires},
              now(), 'seed', 'seed', 'seed', now(), 'seed', 'seed', 'seed'
       FROM generate_series(1, $4::int)`,
      [tenantId, userA, key ?? null, count],
    );
  };
  const expired = "now() - interval '1 hour'";
  const alive = "now() + interval '1 hour'";

  const countOf = async (tenantId: string) =>
    Number(
      (
        await ctx.db.superuser.query<{ n: string }>(
          "SELECT count(*) AS n FROM claim.idempotency_key WHERE tenant_id = $1",
          [tenantId],
        )
      ).rows[0]?.n,
    );

  const purge = (tenantId: string, batchSize?: number) =>
    ctx.run(
      purgeExpiredIdempotencyKeys(
        ClaimTx,
        { tenantId, ...writer },
        batchSize === undefined ? {} : { batchSize },
      ),
    );

  it("期限を過ぎた行だけを消し、期限内の行は残すこと", async () => {
    await seed(tenantA, 3, expired);
    await seed(tenantA, 2, alive);

    const result = await purge(tenantA);

    expect(result.deleted).toBe(3);
    expect(await countOf(tenantA)).toBe(2);
    const left = await ctx.db.superuser.query<{ expired: boolean }>(
      "SELECT expires_at <= now() AS expired FROM claim.idempotency_key",
    );
    expect(left.rows.every((row) => !row.expired)).toBe(true);
  });

  it("消す行がなければ、0 件で 1 回だけ確かめて終わること", async () => {
    await seed(tenantA, 2, alive);

    expect(await purge(tenantA)).toEqual({ deleted: 0, batches: 1 });
    expect(await countOf(tenantA)).toBe(2);
  });

  it("別のテナントの期限切れの行は消さないこと", async () => {
    await seed(tenantA, 2, expired);
    await seed(tenantB, 4, expired);

    await purge(tenantA);

    expect(await countOf(tenantA)).toBe(0);
    expect(await countOf(tenantB)).toBe(4);

    const second = await purge(tenantB);
    expect(second.deleted).toBe(4);
    expect(await countOf(tenantB)).toBe(0);
  });

  it("上限を超える件数でも、上限ごとの複数回のトランザクションで消し切ること", async () => {
    await seed(tenantA, 25, expired);
    await seed(tenantA, 3, alive);

    const result = await purge(tenantA, 10);

    // 10 + 10 + 5 件。最後の 5 件は上限に満たないので、そこで終わる。
    expect(result).toEqual({ deleted: 25, batches: 3 });
    expect(await countOf(tenantA)).toBe(3);
  });

  it("件数がちょうど上限の倍数でも、最後に 0 件を確かめて終わること", async () => {
    await seed(tenantA, 20, expired);

    expect(await purge(tenantA, 10)).toEqual({ deleted: 20, batches: 3 });
  });

  it("一度に消す件数の上限は 1 以上の整数であること", async () => {
    await expect(purge(tenantA, 0)).rejects.toThrow(/batchSize/);
    await expect(purge(tenantA, 1.5)).rejects.toThrow(/batchSize/);
  });

  it("実行中の冪等キーの処理が持つ行のロックを待たず、その行は飛ばして、ほかの行を消すこと", async () => {
    const heldKey = "44444444-4444-4444-8444-444444444444";
    await seed(tenantA, 1, expired, heldKey);
    await seed(tenantA, 5, expired);
    const pool = createPool({ connectionString: ctx.db.url("app_user"), max: 4 });
    const kysely = new Kysely<never>({ dialect: new PostgresDialect({ pool }) });
    const provide = <A, E>(effect: Effect.Effect<A, E, Database>) =>
      Effect.runPromiseExit(effect.pipe(Effect.provide(Database.layer(kysely))));
    try {
      // 期限切れの行と同じキーの要求。withIdempotencyKey はその行を消し、commit までロックを持つ。
      const release = Effect.runSync(Deferred.make<void>());
      const entered = Effect.runSync(Deferred.make<void>());
      const slow: Effect.Effect<IdempotentResponse, never, CurrentWrite> = Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        return { status: 201 };
      });
      const holder = provide(
        inTenantTransaction(
          ClaimTx,
          { tenantId: tenantA, ...writer },
          withIdempotencyKey(
            ClaimTx,
            { tenantId: tenantA, userId: userA, key: heldKey },
            { method: "POST", path: "/api/claims", query: "", body: "{}" },
            slow,
          ),
        ),
      );
      await Effect.runPromise(Deferred.await(entered));

      // ロックを待つなら、holder が終わるまで終わらない。待たなければ、すぐに終わる。
      const started = Date.now();
      const exit = await provide(
        purgeExpiredIdempotencyKeys(ClaimTx, { tenantId: tenantA, ...writer }, {}),
      );
      const elapsed = Date.now() - started;

      expect(Exit.isSuccess(exit) ? exit.value.deleted : undefined).toBe(5);
      expect(elapsed).toBeLessThan(2000);

      Effect.runSync(Deferred.succeed(release, undefined));
      expect(Exit.isSuccess(await holder)).toBe(true);
      // 要求は新しい行を入れて commit した。掃除はそれを消していない。
      const held = await ctx.db.superuser.query<{ expired: boolean }>(
        "SELECT expires_at > now() AS expired FROM claim.idempotency_key WHERE idempotency_key = $1",
        [heldKey],
      );
      expect(held.rows).toEqual([{ expired: true }]);
    } finally {
      await kysely.destroy();
    }
  });
});
