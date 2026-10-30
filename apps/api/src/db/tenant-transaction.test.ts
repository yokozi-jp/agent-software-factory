import { ApprovalTx } from "@agent-software-factory/approval";
import { ClaimTx } from "@agent-software-factory/claim";
import { ClosingTx } from "@agent-software-factory/closing";
import { createPool } from "@agent-software-factory/db";
import { createTestDatabase, type TestDatabase } from "@agent-software-factory/db/testing";
import {
  beginTenantTransaction,
  Database,
  dbCall,
  dbCallUnique,
  inTenantTransaction,
  UniqueViolation,
} from "@agent-software-factory/shared";
import { Cause, Data, Effect, Exit, type Duration } from "effect";
import { Kysely, PostgresDialect, sql, type RawBuilder } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createModuleDatabases, type ModuleDatabases } from "./databases.ts";
import { useDatabase, writer } from "../../test/use-database.ts";

// shared のトランザクションの関数 (inTenantTransaction、dbCall、dbCallUnique) と、モジュールの最初の表 claim.t_claim の RLS
// (docs/adr/0011、docs/adr/0028、docs/adr/0029)。app_user の接続で、モジュールのロールに切り替えて確かめる。
const tenantA = "00000000-0000-4000-8000-00000000000a";
const tenantB = "00000000-0000-4000-8000-00000000000b";

// 申請の行。claim_id は DB が採番する。共通カラムの値は、アプリがバインドする (docs/db/postgresql-keys.md)。
const claimRow = (tenantId: string) => {
  const now = Temporal.Instant.from("2026-10-28T00:00:00Z").toString();
  const by = { by: "test-user", pgm_cd: "tenant-transaction.test", tx_id: "test-tx" };
  return {
    tenant_id: tenantId,
    created_at: now,
    created_by: by.by,
    created_pgm_cd: by.pgm_cd,
    created_tx_id: by.tx_id,
    updated_at: now,
    updated_by: by.by,
    updated_pgm_cd: by.pgm_cd,
    updated_tx_id: by.tx_id,
  };
};

class Marker extends Data.TaggedError("Marker")<{ readonly step: string }> {}

/** 申請のトランザクションの中で、申請の行を 1 件入れる。 */
const insertClaim = (tenantId: string) =>
  dbCall(ClaimTx, (trx) => trx.insertInto("claim.t_claim").values(claimRow(tenantId)).execute());

/** 申請のトランザクションの中で、見える申請のテナントを読む。 */
const readClaimTenants = dbCall(ClaimTx, (trx) =>
  trx.selectFrom("claim.t_claim").select("tenant_id").execute(),
);

/** 申請のトランザクションの中で、今のロールを読む。 */
const currentRole = dbCall(ClaimTx, (trx) =>
  sql<{ role: string }>`SELECT current_user AS role`.execute(trx),
);

describe("inTenantTransaction と claim.t_claim の RLS", () => {
  const ctx = useDatabase();

  const { run, runExit } = ctx;
  const inClaim = <A, E>(tenantId: string, work: Effect.Effect<A, E, ClaimTx>) =>
    inTenantTransaction(ClaimTx, { tenantId, ...writer }, work);

  /** `idle in transaction` のまま残っている接続の数。 */
  const idleInTransaction = async (): Promise<number> => {
    const { rows } = await ctx.db.superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_stat_activity
       WHERE state = 'idle in transaction' AND datname = current_database()`,
    );
    return Number(rows[0]?.n);
  };
  const claimCount = async (): Promise<number> => {
    const { rows } = await ctx.db.superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM claim.t_claim`,
    );
    return Number(rows[0]?.n);
  };

  it("トランザクションの中で、設定したテナントの行だけが見えること", async () => {
    await run(inClaim(tenantA, insertClaim(tenantA)));
    await run(inClaim(tenantB, insertClaim(tenantB)));

    const rows = await run(inClaim(tenantA, readClaimTenants));

    expect(rows).toEqual([{ tenant_id: tenantA }]);
  });

  it("claim_id を DB が連番で採番し、lock_no が 1 から始まること", async () => {
    const rows = await run(
      inClaim(
        tenantA,
        dbCall(ClaimTx, (trx) =>
          trx
            .insertInto("claim.t_claim")
            .values([claimRow(tenantA), claimRow(tenantA)])
            .returning(["claim_id", "lock_no"])
            .execute(),
        ),
      ),
    );

    expect(rows).toEqual([
      { claim_id: "1", lock_no: 1 },
      { claim_id: "2", lock_no: 1 },
    ]);
  });

  it("claim_id をアプリから入れられないこと (GENERATED ALWAYS)", async () => {
    await expect(
      run(
        inClaim(
          tenantA,
          dbCall(ClaimTx, (trx) =>
            trx
              .insertInto("claim.t_claim")
              .values({ ...claimRow(tenantA), claim_id: "1" })
              .execute(),
          ),
        ),
      ),
    ).rejects.toThrow(/cannot insert a non-DEFAULT value into column "claim_id"/);
  });

  it("別のテナントの行を入れられないこと", async () => {
    await expect(run(inClaim(tenantA, insertClaim(tenantB)))).rejects.toThrow(/row-level security/);
  });

  it("テナントを設定しないと、モジュールのロールでも表を読めないこと", async () => {
    await expect(
      ctx.kysely.transaction().execute(async (trx) => {
        await sql`SET LOCAL ROLE claim_module`.execute(trx);
        return sql`SELECT * FROM claim.t_claim`.execute(trx);
      }),
    ).rejects.toThrow(/app\.current_tenant/);
  });

  it("補助関数の外では、app_user がモジュールの表を読めないこと", async () => {
    await expect(sql`SELECT * FROM claim.t_claim`.execute(ctx.kysely)).rejects.toThrow(
      /permission denied for schema claim/,
    );
  });

  it("トランザクションの中ではモジュールのロールで動き、終わるとロールが接続に残らないこと", async () => {
    const inside = await run(inClaim(tenantA, currentRole));
    const outside = await sql<{ role: string }>`SELECT current_user AS role`.execute(ctx.kysely);

    expect(inside.rows).toEqual([{ role: "claim_module" }]);
    expect(outside.rows).toEqual([{ role: "app_user" }]);
  });

  it("トランザクションが終わると、テナントが接続に残らないこと", async () => {
    await run(inClaim(tenantA, insertClaim(tenantA)));

    const { rows } = await sql<{
      tenant: string | null;
    }>`SELECT current_setting('app.current_tenant', true) AS tenant`.execute(ctx.kysely);

    expect(rows).toEqual([{ tenant: "" }]);
  });

  it("テナントの値を SQL の文ではなく bind 変数で渡すこと", async () => {
    await expect(
      run(inClaim("x'); DROP TABLE claim.t_claim; --", readClaimTenants)),
    ).rejects.toThrow(/invalid input syntax for type uuid/);

    const exists = await ctx.db.superuser.query(`SELECT to_regclass('claim.t_claim') AS t`);
    expect(exists.rows).toEqual([{ t: "claim.t_claim" }]);
    expect(await idleInTransaction()).toBe(0);
  });

  describe("終わり方", () => {
    it("成功したら commit すること", async () => {
      await run(inClaim(tenantA, insertClaim(tenantA)));

      expect(await claimCount()).toBe(1);
      expect(await idleInTransaction()).toBe(0);
    });

    it("型付きの失敗では rollback し、失敗をそのまま返すこと", async () => {
      const exit = await runExit(
        inClaim(
          tenantA,
          Effect.andThen(insertClaim(tenantA), Effect.fail(new Marker({ step: "typed" }))),
        ),
      );

      expect(Exit.hasFails(exit)).toBe(true);
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(false);
      expect(await claimCount()).toBe(0);
      expect(await idleInTransaction()).toBe(0);
    });

    it("defect では rollback すること", async () => {
      const exit = await runExit(
        inClaim(
          tenantA,
          Effect.andThen(insertClaim(tenantA), Effect.die(new Error("defect in work"))),
        ),
      );

      expect(Exit.hasDies(exit)).toBe(true);
      expect(await claimCount()).toBe(0);
      expect(await idleInTransaction()).toBe(0);
    });

    it("中断 (タイムアウト) では rollback し、トランザクションが残らないこと", async () => {
      const exit = await runExit(
        inClaim(tenantA, Effect.andThen(insertClaim(tenantA), Effect.sleep("5 seconds"))).pipe(
          Effect.timeout("300 millis"),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(await claimCount()).toBe(0);
      expect(await idleInTransaction()).toBe(0);
    });

    it("commit が失敗したら defect になり、行は残らず、トランザクションも残らないこと", async () => {
      // 遅延させた一意制約は、commit の時に初めて破れる。
      await ctx.db.migrator.query(
        `CREATE TABLE approval.t_deferred (tenant_id uuid NOT NULL, code text NOT NULL,
           CONSTRAINT uq_deferred_code UNIQUE (tenant_id, code) DEFERRABLE INITIALLY DEFERRED)`,
      );
      const insert = dbCall(ApprovalTx, (trx) =>
        sql`INSERT INTO approval.t_deferred (tenant_id, code) VALUES (${tenantA}, 'x')`.execute(
          trx,
        ),
      );

      const exit = await runExit(
        inTenantTransaction(
          ApprovalTx,
          { tenantId: tenantA, ...writer },
          Effect.andThen(insert, insert),
        ),
      );

      expect(Exit.hasDies(exit)).toBe(true);
      expect(Exit.hasFails(exit)).toBe(false);
      const { rows } = await ctx.db.superuser.query(`SELECT 1 FROM approval.t_deferred`);
      expect(rows).toEqual([]);
      expect(await idleInTransaction()).toBe(0);
    });

    it("rollback した後の同じ接続で、次のトランザクションが動くこと", async () => {
      await runExit(
        inClaim(
          tenantA,
          Effect.andThen(insertClaim(tenantA), Effect.fail(new Marker({ step: "x" }))),
        ),
      );

      await run(inClaim(tenantA, insertClaim(tenantA)));

      expect(await claimCount()).toBe(1);
    });
  });

  describe("dbCall と dbCallUnique", () => {
    beforeEach(async () => {
      await ctx.db.migrator.query(
        `CREATE TABLE approval.t_unique (tenant_id uuid NOT NULL, code text NOT NULL,
           CONSTRAINT uq_unique_code UNIQUE (tenant_id, code))`,
      );
    });

    const insertCode = (tenantId: string, code: string) =>
      dbCallUnique(ApprovalTx, (trx) =>
        sql`INSERT INTO approval.t_unique (tenant_id, code) VALUES (${tenantId}, ${code})`.execute(
          trx,
        ),
      );
    const inApproval = <A, E>(tenantId: string, work: Effect.Effect<A, E, ApprovalTx>) =>
      inTenantTransaction(ApprovalTx, { tenantId, ...writer }, work);

    it("一意制約の違反を、制約の名前つきの UniqueViolation にして、catchTag で処理できること", async () => {
      await run(inApproval(tenantA, insertCode(tenantA, "a")));

      const result = await run(
        inApproval(tenantA, insertCode(tenantA, "a")).pipe(
          Effect.catchTag("UniqueViolation", (violation) => Effect.succeed(violation)),
        ),
      );

      expect(result).toBeInstanceOf(UniqueViolation);
      expect(result).toMatchObject({ _tag: "UniqueViolation", constraint: "uq_unique_code" });
      expect(await idleInTransaction()).toBe(0);
    });

    it("一意制約以外の DB の失敗は、dbCallUnique でも dbCall でも defect になること", async () => {
      const notNull = (call: typeof dbCall | typeof dbCallUnique) =>
        runExit(
          inApproval(
            tenantA,
            call(ApprovalTx, (trx) =>
              sql`INSERT INTO approval.t_unique (tenant_id, code) VALUES (${tenantA}, NULL)`.execute(
                trx,
              ),
            ),
          ),
        );

      const unique = await notNull(dbCallUnique);
      const plain = await notNull(dbCall);

      expect(Exit.hasDies(unique)).toBe(true);
      expect(Exit.hasFails(unique)).toBe(false);
      expect(Exit.hasDies(plain)).toBe(true);
    });

    it("dbCall では、一意制約の違反も defect になること", async () => {
      await run(inApproval(tenantA, insertCode(tenantA, "b")));

      const exit = await runExit(
        inApproval(
          tenantA,
          dbCall(ApprovalTx, (trx) =>
            sql`INSERT INTO approval.t_unique (tenant_id, code) VALUES (${tenantA}, 'b')`.execute(
              trx,
            ),
          ),
        ),
      );

      expect(Exit.hasDies(exit)).toBe(true);
      expect(Exit.hasFails(exit)).toBe(false);
    });
  });

  describe("型", () => {
    it("申請のトランザクションの中で、承認の repository は型エラーになること", () => {
      const readApproval = dbCall(ApprovalTx, (trx) =>
        sql`SELECT * FROM approval.t_probe`.execute(trx),
      );

      // 実行しない。型の検査 (vp check) だけが確かめる。
      const never = () =>
        // @ts-expect-error -- 申請のトランザクションは ClaimTx だけを提供する。ApprovalTx が足りない。
        run(inTenantTransaction(ClaimTx, { tenantId: tenantA, ...writer }, readApproval));

      expect(typeof never).toBe("function");
    });

    it("トランザクションの外では、repository が型エラーになること", () => {
      // 実行しない。Database の他に ClaimTx が要るので、run に渡せない。
      // @ts-expect-error -- ClaimTx を提供する inTenantTransaction の外では、insertClaim は動かない。
      const never = () => run(insertClaim(tenantA));

      expect(typeof never).toBe("function");
    });
  });
});

describe("pool が空のとき", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  /** pool の接続を 1 本にして、その 1 本を 1.5 秒つかむトランザクションを始めてから、`during` を流す。 */
  const withHeldPool = async (
    during: (layer: ReturnType<typeof Database.layer>) => Promise<void>,
  ): Promise<void> => {
    const pool = createPool({
      connectionString: db.url("app_user"),
      max: 1,
      connectionTimeoutMillis: 600,
    });
    const kysely = new Kysely<never>({ dialect: new PostgresDialect({ pool }) });
    const layer = Database.layer(kysely);
    try {
      const holder = Effect.runPromise(
        inTenantTransaction(
          ClaimTx,
          { tenantId: tenantA, ...writer },
          Effect.sleep("1500 millis"),
        ).pipe(Effect.provide(layer)),
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      await during(layer);
      await holder;
    } finally {
      await kysely.destroy();
    }
  };

  /** 空のトランザクションを 1 つ始める。`timeout` があれば、Effect.timeout を掛ける。 */
  const attempt = (layer: ReturnType<typeof Database.layer>, timeout?: Duration.Input) => {
    const empty = inTenantTransaction(ClaimTx, { tenantId: tenantA, ...writer }, Effect.void);
    return Effect.runPromiseExit(
      (timeout === undefined ? empty : empty.pipe(Effect.timeout(timeout))).pipe(
        Effect.provide(layer),
      ),
    );
  };

  it("connectionTimeoutMillis で待ちが終わり、defect になること", async () => {
    await withHeldPool(async (layer) => {
      const startedAt = performance.now();

      const exit = await attempt(layer);

      expect(Exit.hasDies(exit)).toBe(true);
      expect(performance.now() - startedAt).toBeLessThan(1200);
    });
  });

  it("接続を待つ間は中断できず、Effect.timeout では待ちが切れないこと (切るのは connectionTimeoutMillis)", async () => {
    await withHeldPool(async (layer) => {
      const startedAt = performance.now();

      const exit = await attempt(layer, "100 millis");

      // 100 ms の timeout は、待ちが終わるまで効かない。結果は TimeoutError だが、返るのは待ちが終わった後 (600 ms)。
      expect(Exit.hasFails(exit)).toBe(true);
      expect(performance.now() - startedAt).toBeGreaterThan(450);
    });
  });
});

describe("beginTenantTransaction (Effect の外の原始操作)", () => {
  const ctx = useDatabase();

  it("モジュールのロールとテナントを設定したトランザクションを返し、呼び出し側が commit すること", async () => {
    const trx = await beginTenantTransaction(ctx.kysely, { module: "approval", tenantId: tenantA });
    const { rows } = await sql<{
      role: string;
      tenant: string;
    }>`SELECT current_user AS role, current_setting('app.current_tenant') AS tenant`.execute(trx);
    await trx.commit().execute();

    expect(rows).toEqual([{ role: "approval_module", tenant: tenantA }]);
    const after = await sql<{ role: string }>`SELECT current_user AS role`.execute(ctx.kysely);
    expect(after.rows).toEqual([{ role: "app_user" }]);
  });

  it("モジュールの名前をロール名に使うので、型にない名前は SQL に届かず、トランザクションが残らないこと", async () => {
    await expect(
      // 型の外から来た値を、型の検査を通さずに渡す (Reflect.apply の引数は any)。
      Reflect.apply(beginTenantTransaction, undefined, [
        ctx.kysely,
        { module: "claim; DROP ROLE app_user", tenantId: tenantA },
      ]),
    ).rejects.toThrow(/Unknown module/);

    const { rows } = await ctx.db.superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_stat_activity
       WHERE state = 'idle in transaction' AND datname = current_database()`,
    );
    expect(rows).toEqual([{ n: "0" }]);
    const role = await sql<{ role: string }>`SELECT current_user AS role`.execute(ctx.kysely);
    expect(role.rows).toEqual([{ role: "app_user" }]);
  });
});

// 表の所有を DB のロールの権限で止める (docs/adr/0029)。sql のタグ付きテンプレートは型で止まらないので、DB が止める。
// 承認と締めの表はまだないので、表の所有者の migrator が探りの表を作る。ALTER DEFAULT PRIVILEGES が、
// モジュールのロールに同じ権限を付ける。
describe("モジュールのロールの権限 (inTenantTransaction)", () => {
  const ctx = useDatabase();

  const { run } = ctx;

  /** そのモジュールのトランザクションで、型を通さずに SQL を流す。権限の拒否は DB が返す。 */
  const query = <R>(module: "claim" | "approval" | "closing", text: RawBuilder<R>) => {
    switch (module) {
      case "claim":
        return inTenantTransaction(
          ClaimTx,
          { tenantId: tenantA, ...writer },
          dbCall(ClaimTx, (trx) => text.execute(trx)),
        );
      case "approval":
        return inTenantTransaction(
          ApprovalTx,
          { tenantId: tenantA, ...writer },
          dbCall(ApprovalTx, (trx) => text.execute(trx)),
        );
      case "closing":
        return inTenantTransaction(
          ClosingTx,
          { tenantId: tenantA, ...writer },
          dbCall(ClosingTx, (trx) => text.execute(trx)),
        );
    }
  };

  beforeEach(async () => {
    await ctx.db.migrator.query(
      `CREATE TABLE approval.t_probe (tenant_id uuid, id int);
       CREATE TABLE closing.t_probe (id int);
       ALTER TABLE approval.t_probe ENABLE ROW LEVEL SECURITY;
       CREATE POLICY tenant_isolation ON approval.t_probe
         USING (tenant_id = current_setting('app.current_tenant')::uuid);
       INSERT INTO approval.t_probe VALUES ('${tenantA}', 1), ('${tenantB}', 2)`,
    );
    for (const tenantId of [tenantA, tenantB]) {
      await run(
        inTenantTransaction(
          ClaimTx,
          { tenantId, ...writer },
          dbCall(ClaimTx, (trx) =>
            trx.insertInto("claim.t_claim").values(claimRow(tenantId)).execute(),
          ),
        ),
      );
    }
  });

  it("申請のトランザクションから、承認の表を読めないこと", async () => {
    await expect(run(query("claim", sql`SELECT * FROM approval.t_probe`))).rejects.toThrow(
      /permission denied for schema approval/,
    );
  });

  it("承認のトランザクションから、申請の表をテナントを効かせて読めること", async () => {
    const { rows } = await run(query("approval", sql`SELECT tenant_id FROM claim.t_claim`));

    expect(rows).toEqual([{ tenant_id: tenantA }]);
  });

  it("承認のトランザクションから、申請の表に書けないこと", async () => {
    await expect(run(query("approval", sql`DELETE FROM claim.t_claim`))).rejects.toThrow(
      /permission denied for table t_claim/,
    );
  });

  it("締めのトランザクションから、承認の表をテナントを効かせて読めて、書けないこと", async () => {
    const { rows } = await run(query("closing", sql`SELECT id FROM approval.t_probe`));
    expect(rows).toEqual([{ id: 1 }]);

    await expect(
      run(query("closing", sql`INSERT INTO approval.t_probe VALUES (${tenantA}, 3)`)),
    ).rejects.toThrow(/permission denied for table t_probe/);
  });

  it("承認のトランザクションから、締めの表を読めないこと (方向に逆らう)", async () => {
    await expect(run(query("approval", sql`SELECT * FROM closing.t_probe`))).rejects.toThrow(
      /permission denied for schema closing/,
    );
  });

  it("締めのトランザクションから、auth.organization の id だけを読めること", async () => {
    await ctx.db.superuser.query(
      `INSERT INTO auth."organization" ("id", "name", "slug", "createdAt") VALUES ($1, 'org', 'org', now())`,
      [tenantA],
    );

    const { rows } = await run(
      query("closing", sql<{ id: string }>`SELECT "id" FROM auth."organization"`),
    );
    expect(rows).toEqual([{ id: tenantA }]);

    await expect(
      run(query("closing", sql`SELECT "name" FROM auth."organization"`)),
    ).rejects.toThrow(/permission denied for table organization/);
    await expect(run(query("closing", sql`SELECT * FROM auth."user"`))).rejects.toThrow(
      /permission denied for table user/,
    );
  });
});

describe("モジュールの DB (createModuleDatabases)", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it("どのモジュールの DB も、同じ app_user の接続で SQL を流せること", async () => {
    const databases: ModuleDatabases = createModuleDatabases(db.appUser);

    for (const database of [databases.claim, databases.approval, databases.closing]) {
      const { rows } = await sql<{ role: string }>`SELECT current_user AS role`.execute(database);
      expect(rows).toEqual([{ role: "app_user" }]);
    }
  });
});
