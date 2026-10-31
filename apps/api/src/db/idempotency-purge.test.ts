import { ClaimTx } from "@agent-software-factory/claim";
import { createPool } from "@agent-software-factory/db";
import {
  countIdempotencyKeys,
  idempotencyKeyTableSql,
  seedIdempotencyKeys,
  type ExpiryExpression,
} from "@agent-software-factory/db/testing";
import {
  createdColumns,
  CurrentWrite,
  Database,
  dbCall,
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
  /** テンプレートの DB が最初から持つ業務の行 (seed) の数。 */
  let baseline = 0;

  beforeEach(async () => {
    await ctx.db.migrator.query(idempotencyKeyTableSql("claim"));
    baseline = Number(
      (await ctx.db.superuser.query<{ n: string }>("SELECT count(*) AS n FROM claim.t_claim"))
        .rows[0]?.n,
    );
  });

  const seed = (tenantId: string, count: number, expiry: ExpiryExpression, key?: string) =>
    seedIdempotencyKeys(ctx.db.superuser, {
      module: "claim",
      tenantId,
      userId: userA,
      count,
      expiry,
      key,
    });
  const claimRows = async () =>
    Number(
      (await ctx.db.superuser.query<{ n: string }>("SELECT count(*) AS n FROM claim.t_claim"))
        .rows[0]?.n,
    ) - baseline;
  const countOf = (tenantId: string) => countIdempotencyKeys(ctx.db.superuser, "claim", tenantId);

  const purge = (tenantId: string, batchSize?: number) =>
    ctx.run(purgeExpiredIdempotencyKeys(ClaimTx, { tenantId, ...writer }, { batchSize }));

  it("期限を過ぎた行だけを消し、期限内の行は残すこと", async () => {
    await seed(tenantA, 3, "expired");
    await seed(tenantA, 2, "alive");

    const result = await purge(tenantA);

    expect(result.deleted).toBe(3);
    expect(await countOf(tenantA)).toBe(2);
    const left = await ctx.db.superuser.query<{ expired: boolean }>(
      "SELECT expires_at <= now() AS expired FROM claim.idempotency_key",
    );
    expect(left.rows.every((row) => !row.expired)).toBe(true);
  });

  it("消す行がなければ、0 件で 1 回だけ確かめて終わること", async () => {
    await seed(tenantA, 2, "alive");

    expect(await purge(tenantA)).toEqual({ deleted: 0, batches: 1 });
    expect(await countOf(tenantA)).toBe(2);
  });

  it("別のテナントの期限切れの行は消さないこと", async () => {
    await seed(tenantA, 2, "expired");
    await seed(tenantB, 4, "expired");

    await purge(tenantA);

    expect(await countOf(tenantA)).toBe(0);
    expect(await countOf(tenantB)).toBe(4);

    const second = await purge(tenantB);
    expect(second.deleted).toBe(4);
    expect(await countOf(tenantB)).toBe(0);
  });

  it("上限を超える件数でも、上限ごとの複数回のトランザクションで消し切ること", async () => {
    await seed(tenantA, 25, "expired");
    await seed(tenantA, 3, "alive");

    const result = await purge(tenantA, 10);

    // 10 + 10 + 5 件。最後の 5 件は上限に満たないので、そこで終わる。
    expect(result).toEqual({ deleted: 25, batches: 3 });
    expect(await countOf(tenantA)).toBe(3);
  });

  it("件数がちょうど上限の倍数でも、最後に 0 件を確かめて終わること", async () => {
    await seed(tenantA, 20, "expired");

    expect(await purge(tenantA, 10)).toEqual({ deleted: 20, batches: 3 });
  });

  it("一度に消す件数の上限は 1 以上の整数であること", async () => {
    await expect(purge(tenantA, 0)).rejects.toThrow(/batchSize/);
    await expect(purge(tenantA, 1.5)).rejects.toThrow(/batchSize/);
  });

  /**
   * 冪等キーの要求を、業務の行を 1 つ書いたところで止めたまま、`during` を動かす。要求は `during` の後に commit する。
   * 掃除が、実行中の要求のロックを待つなら、`during` が終わらず、テストの timeout で失敗する。
   */
  const whileRequestRuns = async (
    key: string,
    during: (
      provide: <A, E>(e: Effect.Effect<A, E, Database>) => Promise<Exit.Exit<A, E>>,
    ) => Promise<void>,
  ) => {
    const pool = createPool({ connectionString: ctx.db.url("app_user"), max: 4 });
    const kysely = new Kysely<never>({ dialect: new PostgresDialect({ pool }) });
    const provide = <A, E>(effect: Effect.Effect<A, E, Database>) =>
      Effect.runPromiseExit(effect.pipe(Effect.provide(Database.layer(kysely))));
    try {
      const release = Effect.runSync(Deferred.make<void>());
      const entered = Effect.runSync(Deferred.make<void>());
      const slow: Effect.Effect<
        IdempotentResponse,
        never,
        CurrentWrite | typeof ClaimTx.Identifier
      > = Effect.gen(function* () {
        const write = yield* CurrentWrite;
        yield* dbCall(ClaimTx, (trx) =>
          trx
            .insertInto("claim.t_claim")
            .values({ tenant_id: tenantA, ...createdColumns(write) })
            .execute(),
        );
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        return { status: 201 };
      });
      const request = provide(
        inTenantTransaction(
          ClaimTx,
          { tenantId: tenantA, ...writer },
          withIdempotencyKey(
            ClaimTx,
            { tenantId: tenantA, userId: userA, key },
            { method: "POST", path: "/api/claims", query: "", body: "{}" },
            slow,
          ),
        ),
      );
      await Effect.runPromise(Deferred.await(entered));
      await during(provide);
      Effect.runSync(Deferred.succeed(release, undefined));
      expect(Exit.isSuccess(await request)).toBe(true);
    } finally {
      await kysely.destroy();
    }
  };

  const purgeIn = (provide: Parameters<Parameters<typeof whileRequestRuns>[1]>[0]) =>
    provide(purgeExpiredIdempotencyKeys(ClaimTx, { tenantId: tenantA, ...writer }));

  it("実行中の要求が期限切れの行を消して持つロックは待たず、その行は飛ばして、ほかの行を消すこと", async () => {
    const heldKey = "44444444-4444-4444-8444-444444444444";
    await seed(tenantA, 1, "expired", heldKey);
    await seed(tenantA, 5, "expired");

    // 同じキーの要求は、期限切れの行を消し、新しい行を入れて、commit までロックを持つ。
    await whileRequestRuns(heldKey, async (provide) => {
      const exit = await purgeIn(provide);
      expect(Exit.isSuccess(exit) ? exit.value.deleted : undefined).toBe(5);
    });

    // 要求は新しい行を入れて commit した。掃除はそれを消していない。
    const held = await ctx.db.superuser.query<{ alive: boolean }>(
      "SELECT expires_at > now() AS alive FROM claim.idempotency_key WHERE idempotency_key = $1",
      [heldKey],
    );
    expect(held.rows).toEqual([{ alive: true }]);
  });

  it("実行中の要求が書いた commit 前のキーの行と業務の行に触れず、待たずに期限切れの行を消すこと", async () => {
    const runningKey = "55555555-5555-4555-8555-555555555555";
    await seed(tenantA, 4, "expired");

    await whileRequestRuns(runningKey, async (provide) => {
      const exit = await purgeIn(provide);
      expect(Exit.isSuccess(exit) ? exit.value.deleted : undefined).toBe(4);
    });

    // 要求は commit した。キーの行と業務の行が残っている。
    expect(await countOf(tenantA)).toBe(1);
    expect(await claimRows()).toBe(1);
  });

  it("テナントごとに期限の古い順で探す索引 (tenant_id, expires_at) を使うこと", async () => {
    await seed(tenantA, 50, "expired");
    await seed(tenantB, 50, "expired");
    await ctx.db.superuser.query("ANALYZE claim.idempotency_key");

    // 件数の少ない試験の表では、計画が順次走査になりやすい。索引が使えることを確かめるため、順次走査を禁じて計画を見る。
    const client = await ctx.db.superuser.connect();
    try {
      await client.query("SET enable_seqscan = off");
      const plan = await client.query<{ "QUERY PLAN": string }>(
        `EXPLAIN SELECT tenant_id, user_id, idempotency_key FROM claim.idempotency_key
         WHERE tenant_id = $1 AND expires_at <= now() ORDER BY expires_at LIMIT 10`,
        [tenantA],
      );
      const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
      expect(text).toContain("idx_idempotency_key_tenant_expires_at");
      expect(text).not.toContain("Sort");
    } finally {
      client.release();
    }
  });
});
