import { ClaimTx } from "@agent-software-factory/claim";
import { createPool } from "@agent-software-factory/db/node";
import { awaitBlocked, idempotencyKeyTableSql } from "@agent-software-factory/db/testing";
import {
  createdColumns,
  CurrentWrite,
  dbCall,
  Database,
  inTenantTransaction,
} from "@agent-software-factory/shared-kernel/tenant-db";
import {
  IdempotencyInProgress,
  IdempotencyPayloadMismatch,
  NonSuccessResponse,
  withIdempotencyKey,
  type IdempotencyRequest,
  type IdempotentResponse,
} from "@agent-software-factory/shared-kernel/idempotency-db";
import { Cause, Data, Deferred, Effect, Exit, Option } from "effect";
import { Kysely, PostgresDialect, sql } from "kysely";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useDatabase, writer } from "../../test/use-database.ts";

// withIdempotencyKey と idempotency_key (Issue #323、docs/adr/0040): 実際の PostgreSQL で、同じキーの業務の処理が 1 回
// だけ動き、失敗した処理はキーの行も残さず、待ちが切れたら 409 になることを確かめる。公開の境界は共有の関数。
const tenantA = "00000000-0000-4000-8000-00000000000a";
const tenantB = "00000000-0000-4000-8000-00000000000b";
const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const key = "33333333-3333-4333-8333-333333333333";

const post: IdempotencyRequest = {
  method: "POST",
  path: "/api/claims",
  query: "",
  body: '{"amount":100}',
};

class WorkFailed extends Data.TaggedError("WorkFailed") {}

describe("withIdempotencyKey と idempotency_key", () => {
  const ctx = useDatabase();

  /** 業務の処理が呼ばれた回数。 */
  let calls = 0;

  beforeEach(async () => {
    calls = 0;
    await ctx.db.migrator.query(idempotencyKeyTableSql("claim"));
    baseline = await rawClaimCount();
  });

  /** 業務の表 (claim.t_claim) に 1 行書いて 201 を返す、業務の処理の代わり。 */
  const createClaim = (
    tenantId: string,
  ): Effect.Effect<IdempotentResponse, never, CurrentWrite | typeof ClaimTx.Identifier> =>
    Effect.gen(function* () {
      calls += 1;
      const write = yield* CurrentWrite;
      yield* dbCall(ClaimTx, (trx) =>
        trx
          .insertInto("claim.t_claim")
          .values({ tenant_id: tenantId, ...createdColumns(write) })
          .execute(),
      );
      return { status: 201, body: { created: calls } };
    });

  /** 業務の行を書いた後、`release` されるまで commit しない業務の処理。ほかの要求を待たせておくのに使う。 */
  const slowClaim = () => {
    const release = Effect.runSync(Deferred.make<void>());
    const slowWork = Effect.gen(function* () {
      const response = yield* createClaim(tenantA);
      yield* Deferred.await(release);
      return response;
    });
    return { release, slowWork };
  };

  /** application の層がすること: トランザクションを開き、その中で共有の関数に業務の処理を渡す。 */
  const call = <E, R>(
    work: Effect.Effect<IdempotentResponse, E, R>,
    options: {
      tenantId?: string;
      userId?: string;
      request?: IdempotencyRequest;
      /** あれば、トランザクションの中で接続の pid を取って渡す。`awaitBlocked` が待つ側と待たせる側を見分けるのに使う。 */
      pid?: Deferred.Deferred<number>;
    } = {},
  ) => {
    const tenantId = options.tenantId ?? tenantA;
    const idempotent = withIdempotencyKey(
      ClaimTx,
      { tenantId, userId: options.userId ?? userA, key },
      options.request ?? post,
      work,
    );
    return inTenantTransaction(
      ClaimTx,
      { tenantId, ...writer },
      options.pid === undefined ? idempotent : withPid(options.pid, idempotent),
    );
  };

  const keyRows = async () =>
    (
      await ctx.db.superuser.query<{ tenant_id: string; user_id: string; status_code: number }>(
        "SELECT tenant_id, user_id, status_code FROM claim.idempotency_key ORDER BY tenant_id, user_id",
      )
    ).rows;
  /** テストが業務の表に足した行の数。テンプレートの DB が最初から持つ行 (seed) は数えない。 */
  let baseline = 0;
  const rawClaimCount = async () =>
    Number(
      (await ctx.db.superuser.query<{ n: string }>("SELECT count(*) AS n FROM claim.t_claim"))
        .rows[0]?.n,
    );
  const claimCount = async () => (await rawClaimCount()) - baseline;

  /** 失敗の値。失敗でなければテストを失敗させる。 */
  const failureOf = <A, E>(exit: Exit.Exit<A, E>): E => {
    if (!Exit.isFailure(exit)) throw new Error("The effect did not fail.");
    const failure = Cause.findErrorOption(exit.cause);
    if (Option.isNone(failure)) throw new Error("The effect died.");
    return failure.value;
  };

  /** 接続を 4 本持つ pool。useDatabase の pool は 1 本なので、2 つの要求が順に動いてしまい、競合を確かめられない。 */
  const withPool = async <A>(
    use: (
      provide: <B, E>(e: Effect.Effect<B, E, Database>) => Promise<Exit.Exit<B, E>>,
    ) => Promise<A>,
  ) => {
    const pool = createPool({ connectionString: ctx.db.url("app_user"), max: 4 });
    const kysely = new Kysely<never>({ dialect: new PostgresDialect({ pool }) });
    try {
      return await use((effect) =>
        Effect.runPromiseExit(effect.pipe(Effect.provide(Database.layer(kysely)))),
      );
    } finally {
      await kysely.destroy();
    }
  };

  /** 接続の pid を取ってから `effect` を動かす。`awaitBlocked` が待つ側と待たせる側を見分けるのに使う。 */
  const withPid = <A, E, R>(
    pids: Deferred.Deferred<number>,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R | typeof ClaimTx.Identifier> =>
    Effect.gen(function* () {
      const result = yield* dbCall(ClaimTx, (trx) =>
        sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(trx),
      );
      yield* Deferred.succeed(pids, result.rows[0]?.pid ?? 0);
      return yield* effect;
    });

  it("初めてのキーは業務の処理を呼び、2xx の状態コードと本文をキーの行に書いて commit すること", async () => {
    const response = await ctx.run(call(createClaim(tenantA)));

    expect(response).toEqual({ status: 201, body: { created: 1 } });
    expect(await keyRows()).toEqual([{ tenant_id: tenantA, user_id: userA, status_code: 201 }]);
    const stored = await ctx.db.superuser.query<{
      response_body: unknown;
      expires_at: Date;
      at: Date;
    }>("SELECT response_body, expires_at, created_at AS at FROM claim.idempotency_key");
    expect(stored.rows[0]?.response_body).toEqual({ created: 1 });
    // 保存期間は 24 時間 (docs/adr/0040)。
    const row = stored.rows[0];
    expect(row && (row.expires_at.getTime() - row.at.getTime()) / 3_600_000).toBe(24);
  });

  it("commit した後の再試行は、業務の処理を呼ばずに保存した状態コードと本文を返すこと", async () => {
    await ctx.run(call(createClaim(tenantA)));

    const retried = await ctx.run(call(createClaim(tenantA)));

    expect(retried).toEqual({ status: 201, body: { created: 1 } });
    expect(calls).toBe(1);
    expect(await claimCount()).toBe(1);
    expect(await keyRows()).toHaveLength(1);
  });

  it("同じキーの 2 つの要求を並行に流すと、業務の処理は 1 回で、2 つ目は保存した応答を返すこと", async () => {
    await withPool(async (provide) => {
      // 1 つ目の業務の処理は、`release` されるまで commit しない。
      const { release, slowWork } = slowClaim();
      const firstPid = Effect.runSync(Deferred.make<number>());
      const secondPid = Effect.runSync(Deferred.make<number>());

      const firstRun = provide(call(slowWork, { pid: firstPid }));
      const holder = await Effect.runPromise(Deferred.await(firstPid));
      const secondRun = provide(call(createClaim(tenantA), { pid: secondPid }));
      const waiter = await Effect.runPromise(Deferred.await(secondPid));
      await awaitBlocked(ctx.db.superuser, { waiter, holder });
      Effect.runSync(Deferred.succeed(release, undefined));

      const [one, two] = await Promise.all([firstRun, secondRun]);
      expect(Exit.isSuccess(one) && Exit.isSuccess(two)).toBe(true);
      expect(Exit.isSuccess(two) ? two.value : undefined).toEqual({
        status: 201,
        body: { created: 1 },
      });
      expect(calls).toBe(1);
      expect(await claimCount()).toBe(1);
      expect(await keyRows()).toHaveLength(1);
    });
  });

  it("業務の処理が失敗したら、キーの行も業務の行も残らず、同じキーでの再試行が業務の処理をもう一度呼ぶこと", async () => {
    const failing = createClaim(tenantA).pipe(Effect.andThen(Effect.fail(new WorkFailed())));

    const failed = await ctx.runExit(call(failing));

    expect(failureOf(failed)).toBeInstanceOf(WorkFailed);
    expect(await keyRows()).toEqual([]);
    expect(await claimCount()).toBe(0);

    const retried = await ctx.run(call(createClaim(tenantA)));
    expect(retried).toEqual({ status: 201, body: { created: 2 } });
    expect(calls).toBe(2);
  });

  it("2xx 以外の応答は保存せず、NonSuccessResponse に載せ、同じキーでの再試行が業務の処理をもう一度呼ぶこと", async () => {
    const unprocessable = Effect.sync(() => {
      calls += 1;
      return { status: 422, body: { type: "/problems/claim/not-allowed" } };
    });

    const exit = await ctx.runExit(call(unprocessable));

    const failure = failureOf(exit);
    expect(failure instanceof NonSuccessResponse ? failure.response.status : undefined).toBe(422);
    expect(await keyRows()).toEqual([]);

    await ctx.run(call(createClaim(tenantA)));
    expect(calls).toBe(2);
  });

  it("本文のない 2xx (204) も保存し、再試行にも本文なしで同じ状態コードを返すこと", async () => {
    const noContent = Effect.sync(() => {
      calls += 1;
      return { status: 204 };
    });
    await ctx.run(call(noContent));

    const retried = await ctx.run(call(noContent));

    expect(retried).toEqual({ status: 204, body: null });
    expect(calls).toBe(1);
  });

  it("期限が切れて掃除されていない行は、もう記録ではなく、同じキーで業務の処理をもう一度呼ぶこと", async () => {
    await ctx.run(call(createClaim(tenantA)));
    await ctx.db.superuser.query(
      "UPDATE claim.idempotency_key SET expires_at = now() - interval '1 second'",
    );

    const again = await ctx.run(call(createClaim(tenantA)));

    expect(again).toEqual({ status: 201, body: { created: 2 } });
    expect(calls).toBe(2);
    expect(await keyRows()).toHaveLength(1);
  });

  it("method、経路、クエリ文字列、本文のどれかが違う同じキーは IdempotencyPayloadMismatch で、業務の処理を呼ばないこと", async () => {
    await ctx.run(call(createClaim(tenantA)));

    const others: IdempotencyRequest[] = [
      { ...post, method: "PATCH" },
      { ...post, path: "/api/claims/1" },
      { ...post, query: "dryRun=true" },
      { ...post, body: '{"amount": 100}' },
    ];
    for (const request of others) {
      const exit = await ctx.runExit(call(createClaim(tenantA), { request }));
      expect(failureOf(exit)).toBeInstanceOf(IdempotencyPayloadMismatch);
    }

    expect(calls).toBe(1);
    expect(await claimCount()).toBe(1);
  });

  it("別のテナントと別の利用者の同じキーは、それぞれ自分の行を入れて業務の処理を呼ぶこと", async () => {
    await ctx.run(call(createClaim(tenantA), { tenantId: tenantA, userId: userA }));
    await ctx.run(call(createClaim(tenantB), { tenantId: tenantB, userId: userA }));
    await ctx.run(call(createClaim(tenantA), { tenantId: tenantA, userId: userB }));

    expect(calls).toBe(3);
    expect((await keyRows()).map((row) => [row.tenant_id, row.user_id])).toEqual([
      [tenantA, userA],
      [tenantA, userB],
      [tenantB, userA],
    ]);
  });

  it("1 つ目が lock_timeout より長くかかると、2 つ目は IdempotencyInProgress (Retry-After 付き) で切れ、1 つ目は commit できること", async () => {
    await withPool(async (provide) => {
      const { release, slowWork } = slowClaim();
      const firstPid = Effect.runSync(Deferred.make<number>());
      const firstRun = provide(call(slowWork, { pid: firstPid }));
      await Effect.runPromise(Deferred.await(firstPid));

      const second = await provide(call(createClaim(tenantA)));

      const failure = failureOf(second);
      expect(failure instanceof IdempotencyInProgress ? failure.retryAfterSeconds : undefined).toBe(
        5,
      );
      Effect.runSync(Deferred.succeed(release, undefined));
      expect(Exit.isSuccess(await firstRun)).toBe(true);
      expect(calls).toBe(1);
      expect(await keyRows()).toHaveLength(1);
    });
  }, 30_000);

  it("業務の更新が別のロックを lock_timeout より長く待っても、切れないこと (INSERT の後に lock_timeout を戻している)", async () => {
    const blocker = await ctx.db.superuser.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE claim.t_claim IN ACCESS EXCLUSIVE MODE");
      const holder =
        (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid ?? 0;
      const pid = Effect.runSync(Deferred.make<number>());
      const running = ctx.runExit(call(createClaim(tenantA), { pid }));
      // 業務の INSERT が表のロックを待ち始めてから、lock_timeout の 5 秒より長く待たせて、放す。
      await awaitBlocked(ctx.db.superuser, {
        waiter: await Effect.runPromise(Deferred.await(pid)),
        holder,
      });
      await new Promise((resolve) => setTimeout(resolve, 5_500));
      await blocker.query("COMMIT");

      expect(Exit.isSuccess(await running)).toBe(true);
      expect(await claimCount()).toBe(1);
    } finally {
      blocker.release();
    }
  }, 30_000);
});
