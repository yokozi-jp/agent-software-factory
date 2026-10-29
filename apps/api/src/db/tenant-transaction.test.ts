import { createTestDatabase, type TestDatabase } from "@agent-software-factory/db/testing";
import type { ClaimDatabase } from "@agent-software-factory/claim";
import { inTenantTransaction } from "@agent-software-factory/shared";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createModuleDatabases, type ModuleDatabases } from "./databases.ts";

// shared のテナントの設定とロールの切り替え (inTenantTransaction) と、モジュールの最初の表 claim.t_claim の RLS
// (docs/adr/0011、docs/adr/0029)。app_user の接続で、モジュールのロールに切り替えて確かめる。
const tenantA = "00000000-0000-4000-8000-00000000000a";
const tenantB = "00000000-0000-4000-8000-00000000000b";

// 申請の行。claim_id は DB が採番する。共通カラムの値は、アプリがバインドする (docs/db/postgresql-keys.md)。
const claimRow = (tenantId: string) => {
  const now = new Date("2026-10-28T00:00:00Z");
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

describe("inTenantTransaction と claim.t_claim の RLS", () => {
  let db: TestDatabase;
  let pool: Pool;
  let claim: ClaimDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
    // 接続を 1 本にして、前のトランザクションの設定が同じ接続に残るかを確かめられるようにする。
    pool = new Pool({ connectionString: db.url("app_user"), max: 1 });
    claim = new Kysely({ dialect: new PostgresDialect({ pool }) });
  });

  afterEach(async () => {
    await claim.destroy();
    await db.close();
  });

  const insertClaim = (tenantId: string) =>
    inTenantTransaction(claim, { module: "claim", tenantId }, (trx) =>
      trx.insertInto("claim.t_claim").values(claimRow(tenantId)).execute(),
    );

  it("トランザクションの中で、設定したテナントの行だけが見えること", async () => {
    await insertClaim(tenantA);
    await insertClaim(tenantB);

    const rows = await inTenantTransaction(claim, { module: "claim", tenantId: tenantA }, (trx) =>
      trx.selectFrom("claim.t_claim").select("tenant_id").execute(),
    );

    expect(rows).toEqual([{ tenant_id: tenantA }]);
  });

  it("claim_id を DB が連番で採番し、lock_no が 1 から始まること", async () => {
    const rows = await inTenantTransaction(claim, { module: "claim", tenantId: tenantA }, (trx) =>
      trx
        .insertInto("claim.t_claim")
        .values([claimRow(tenantA), claimRow(tenantA)])
        .returning(["claim_id", "lock_no"])
        .execute(),
    );

    expect(rows).toEqual([
      { claim_id: "1", lock_no: 1 },
      { claim_id: "2", lock_no: 1 },
    ]);
  });

  it("claim_id をアプリから入れられないこと (GENERATED ALWAYS)", async () => {
    await expect(
      inTenantTransaction(claim, { module: "claim", tenantId: tenantA }, (trx) =>
        trx
          .insertInto("claim.t_claim")
          .values({ ...claimRow(tenantA), claim_id: "1" })
          .execute(),
      ),
    ).rejects.toThrow(/cannot insert a non-DEFAULT value into column "claim_id"/);
  });

  it("別のテナントの行を入れられないこと", async () => {
    await expect(
      inTenantTransaction(claim, { module: "claim", tenantId: tenantA }, (trx) =>
        trx.insertInto("claim.t_claim").values(claimRow(tenantB)).execute(),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("テナントを設定しないと、モジュールのロールでも表を読めないこと", async () => {
    await expect(
      claim.transaction().execute(async (trx) => {
        await sql`SET LOCAL ROLE claim_module`.execute(trx);
        return trx.selectFrom("claim.t_claim").selectAll().execute();
      }),
    ).rejects.toThrow(/app\.current_tenant/);
  });

  it("補助関数の外では、app_user がモジュールの表を読めないこと", async () => {
    await expect(claim.selectFrom("claim.t_claim").selectAll().execute()).rejects.toThrow(
      /permission denied for schema claim/,
    );
  });

  it("トランザクションの中ではモジュールのロールで動き、終わるとロールが接続に残らないこと", async () => {
    const inside = await inTenantTransaction(claim, { module: "claim", tenantId: tenantA }, (trx) =>
      sql<{ role: string }>`SELECT current_user AS role`.execute(trx),
    );
    const outside = await sql<{ role: string }>`SELECT current_user AS role`.execute(claim);

    expect(inside.rows).toEqual([{ role: "claim_module" }]);
    expect(outside.rows).toEqual([{ role: "app_user" }]);
  });

  it("トランザクションが終わると、テナントが接続に残らないこと", async () => {
    await insertClaim(tenantA);

    const { rows } = await sql<{
      tenant: string | null;
    }>`SELECT current_setting('app.current_tenant', true) AS tenant`.execute(claim);

    expect(rows).toEqual([{ tenant: "" }]);
  });

  it("モジュールの名前をロール名に使うので、型にない名前は SQL に届かないこと", async () => {
    await expect(
      // 型の外から来た値を、型の検査を通さずに渡す (Reflect.apply の引数は any)。
      Reflect.apply(inTenantTransaction, undefined, [
        claim,
        { module: "claim; DROP ROLE app_user", tenantId: tenantA },
        () => Promise.resolve(),
      ]),
    ).rejects.toThrow(/Unknown module/);
  });

  it("work が失敗すると、ロールバックしてその失敗を返すこと", async () => {
    const failure = new Error("work failed");

    await expect(
      inTenantTransaction(claim, { module: "claim", tenantId: tenantA }, async (trx) => {
        await trx.insertInto("claim.t_claim").values(claimRow(tenantA)).execute();
        throw failure;
      }),
    ).rejects.toBe(failure);

    const rows = await inTenantTransaction(claim, { module: "claim", tenantId: tenantA }, (trx) =>
      trx.selectFrom("claim.t_claim").selectAll().execute(),
    );
    expect(rows).toEqual([]);
  });

  it("テナントの値を SQL の文ではなく bind 変数で渡すこと", async () => {
    await expect(
      inTenantTransaction(
        claim,
        { module: "claim", tenantId: "x'); DROP TABLE claim.t_claim; --" },
        (trx) => trx.selectFrom("claim.t_claim").selectAll().execute(),
      ),
    ).rejects.toThrow(/invalid input syntax for type uuid/);

    const exists = await db.superuser.query(`SELECT to_regclass('claim.t_claim') AS t`);
    expect(exists.rows).toEqual([{ t: "claim.t_claim" }]);
  });
});

// 表の所有を DB のロールの権限で止める (docs/adr/0029)。sql のタグ付きテンプレートは型で止まらないので、DB が止める。
// 承認と締めの表はまだないので、表の所有者の migrator が探りの表を作る。ALTER DEFAULT PRIVILEGES が、
// モジュールのロールに同じ権限を付ける。
describe("モジュールのロールの権限 (inTenantTransaction)", () => {
  let db: TestDatabase;
  let pool: Pool;
  let databases: ModuleDatabases;

  const scope = (module: "claim" | "approval" | "closing") => ({ module, tenantId: tenantA });

  beforeEach(async () => {
    db = await createTestDatabase();
    await db.migrator.query(
      `CREATE TABLE approval.t_probe (tenant_id uuid, id int);
       CREATE TABLE closing.t_probe (id int);
       ALTER TABLE approval.t_probe ENABLE ROW LEVEL SECURITY;
       CREATE POLICY tenant_isolation ON approval.t_probe
         USING (tenant_id = current_setting('app.current_tenant')::uuid);
       INSERT INTO approval.t_probe VALUES ('${tenantA}', 1), ('${tenantB}', 2)`,
    );
    pool = new Pool({ connectionString: db.url("app_user"), max: 1 });
    databases = createModuleDatabases(pool);
    await inTenantTransaction(databases.claim, scope("claim"), (trx) =>
      trx.insertInto("claim.t_claim").values(claimRow(tenantA)).execute(),
    );
    await inTenantTransaction(databases.claim, { module: "claim", tenantId: tenantB }, (trx) =>
      trx.insertInto("claim.t_claim").values(claimRow(tenantB)).execute(),
    );
  });

  afterEach(async () => {
    await pool.end();
    await db.close();
  });

  it("申請のトランザクションから、承認の表を読めないこと", async () => {
    await expect(
      inTenantTransaction(databases.claim, scope("claim"), (trx) =>
        sql`SELECT * FROM approval.t_probe`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied for schema approval/);
  });

  it("承認のトランザクションから、申請の表をテナントを効かせて読めること", async () => {
    const { rows } = await inTenantTransaction(databases.approval, scope("approval"), (trx) =>
      sql<{ tenant_id: string }>`SELECT tenant_id FROM claim.t_claim`.execute(trx),
    );

    expect(rows).toEqual([{ tenant_id: tenantA }]);
  });

  it("承認のトランザクションから、申請の表に書けないこと", async () => {
    await expect(
      inTenantTransaction(databases.approval, scope("approval"), (trx) =>
        sql`DELETE FROM claim.t_claim`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied for table t_claim/);
  });

  it("締めのトランザクションから、承認の表をテナントを効かせて読めて、書けないこと", async () => {
    const { rows } = await inTenantTransaction(databases.closing, scope("closing"), (trx) =>
      sql<{ id: number }>`SELECT id FROM approval.t_probe`.execute(trx),
    );
    expect(rows).toEqual([{ id: 1 }]);

    await expect(
      inTenantTransaction(databases.closing, scope("closing"), (trx) =>
        sql`INSERT INTO approval.t_probe VALUES (${tenantA}, 3)`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied for table t_probe/);
  });

  it("承認のトランザクションから、締めの表を読めないこと (方向に逆らう)", async () => {
    await expect(
      inTenantTransaction(databases.approval, scope("approval"), (trx) =>
        sql`SELECT * FROM closing.t_probe`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied for schema closing/);
  });

  it("締めのトランザクションから、auth.organization の id だけを読めること", async () => {
    await db.superuser.query(
      `INSERT INTO auth."organization" ("id", "name", "slug", "createdAt") VALUES ($1, 'org', 'org', now())`,
      [tenantA],
    );

    const { rows } = await inTenantTransaction(databases.closing, scope("closing"), (trx) =>
      sql<{ id: string }>`SELECT "id" FROM auth."organization"`.execute(trx),
    );
    expect(rows).toEqual([{ id: tenantA }]);

    await expect(
      inTenantTransaction(databases.closing, scope("closing"), (trx) =>
        sql`SELECT "name" FROM auth."organization"`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied for table organization/);
    await expect(
      inTenantTransaction(databases.closing, scope("closing"), (trx) =>
        sql`SELECT * FROM auth."user"`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied for table user/);
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
    const databases = createModuleDatabases(db.appUser);

    for (const database of [databases.claim, databases.approval, databases.closing]) {
      const { rows } = await sql<{ role: string }>`SELECT current_user AS role`.execute(database);
      expect(rows).toEqual([{ role: "app_user" }]);
    }
  });
});
