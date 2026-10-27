import type { ClaimDatabase } from "@agent-software-factory/claim";
import { inTenantTransaction } from "@agent-software-factory/shared";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createTestDatabase, type TestDatabase } from "../../test/database.ts";
import { createModuleDatabases } from "./databases.ts";

// shared のテナントの設定 (inTenantTransaction) と、モジュールの最初の表 claim.t_claim の RLS (docs/adr/0011)。
// 表の権限はまだ app_user にない (Issue #268 でモジュールのロールに与える) ので、RLS は表の所有者の migrator で
// 確かめる。FORCE ROW LEVEL SECURITY なので、所有者にもポリシーが効く。
const tenantA = "00000000-0000-4000-8000-00000000000a";
const tenantB = "00000000-0000-4000-8000-00000000000b";
const claimId = "00000000-0000-4000-8000-000000000001";

describe("inTenantTransaction と claim.t_claim の RLS", () => {
  let db: TestDatabase;
  let pool: Pool;
  let claim: ClaimDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
    // 接続を 1 本にして、前のトランザクションの設定が同じ接続に残るかを確かめられるようにする。
    pool = new Pool({ connectionString: db.url("migrator"), max: 1 });
    claim = new Kysely({ dialect: new PostgresDialect({ pool }) });
  });

  afterEach(async () => {
    await claim.destroy();
    await db.close();
  });

  const insertClaim = (tenantId: string) =>
    inTenantTransaction(claim, { module: "claim", tenantId }, (trx) =>
      trx.insertInto("claim.t_claim").values({ tenant_id: tenantId, claim_id: claimId }).execute(),
    );

  it("トランザクションの中で、設定したテナントの行だけが見えること", async () => {
    await insertClaim(tenantA);
    await insertClaim(tenantB);

    const rows = await inTenantTransaction(claim, { module: "claim", tenantId: tenantA }, (trx) =>
      trx.selectFrom("claim.t_claim").select("tenant_id").execute(),
    );

    expect(rows).toEqual([{ tenant_id: tenantA }]);
  });

  it("別のテナントの行を入れられないこと", async () => {
    await expect(
      inTenantTransaction(claim, { module: "claim", tenantId: tenantA }, (trx) =>
        trx.insertInto("claim.t_claim").values({ tenant_id: tenantB, claim_id: claimId }).execute(),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("テナントを設定しないと、表を読めないこと", async () => {
    await expect(claim.selectFrom("claim.t_claim").selectAll().execute()).rejects.toThrow(
      /app\.current_tenant/,
    );
  });

  it("トランザクションが終わると、テナントが接続に残らないこと", async () => {
    await insertClaim(tenantA);

    const { rows } = await sql<{
      tenant: string | null;
    }>`SELECT current_setting('app.current_tenant', true) AS tenant`.execute(claim);

    expect(rows).toEqual([{ tenant: "" }]);
  });

  it("work が失敗すると、ロールバックしてその失敗を返すこと", async () => {
    const failure = new Error("work failed");

    await expect(
      inTenantTransaction(claim, { module: "claim", tenantId: tenantA }, async (trx) => {
        await trx
          .insertInto("claim.t_claim")
          .values({ tenant_id: tenantA, claim_id: claimId })
          .execute();
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

describe("モジュールの DB (createModuleDatabases)", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it("app_user の接続では、モジュールの表を読めないこと (権限は Issue #268 でモジュールのロールに与える)", async () => {
    const { claim } = createModuleDatabases(db.appUser);

    await expect(
      inTenantTransaction(claim, { module: "claim", tenantId: tenantA }, (trx) =>
        trx.selectFrom("claim.t_claim").selectAll().execute(),
      ),
    ).rejects.toThrow(/permission denied for schema claim/);
  });

  it("どのモジュールの DB も、同じ app_user の接続で SQL を流せること", async () => {
    const databases = createModuleDatabases(db.appUser);

    for (const database of [databases.claim, databases.approval, databases.closing]) {
      const { rows } = await sql<{ role: string }>`SELECT current_user AS role`.execute(database);
      expect(rows).toEqual([{ role: "app_user" }]);
    }
  });
});
