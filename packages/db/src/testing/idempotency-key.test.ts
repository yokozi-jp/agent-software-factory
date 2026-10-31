import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { checkConventions } from "../convention-catalog.ts";
import { checkModuleRoles } from "../module-roles-catalog.ts";
import { createTestDatabase, idempotencyKeyTableSql, type TestDatabase } from "./index.ts";

// idempotency_key の migration の雛形 (packages/db/templates/idempotency_key.sql、docs/adr/0040)。
// 雛形から作った表が、DB の規約とモジュールのロールの検査を通り、RLS とロールの権限が決めたとおりであることを確かめる。
const reads = { claim: [], approval: ["claim"], closing: ["approval", "claim"] };
const tenantA = "00000000-0000-4000-8000-00000000000a";
const tenantB = "00000000-0000-4000-8000-00000000000b";
const user = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";

describe("idempotency_key の雛形", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
    for (const module of Object.keys(reads)) {
      await db.migrator.query(idempotencyKeyTableSql(module));
    }
  });

  afterEach(async () => {
    await db.close();
  });

  it("モジュール名を替えた SQL が、migrate:up の部分だけであること", () => {
    const sql = idempotencyKeyTableSql("claim");

    expect(sql).toContain("CREATE TABLE claim.idempotency_key");
    expect(sql).not.toContain("{{module}}");
    expect(sql).not.toContain("migrate:down");
  });

  it("モジュール名に使えない文字があれば、SQL を返さずに失敗すること", () => {
    expect(() => idempotencyKeyTableSql("claim; DROP SCHEMA claim")).toThrow(/Invalid module/);
  });

  it("3 つのモジュールに作った表が、DB の規約とモジュールのロールの検査を通ること", async () => {
    expect(await checkConventions(db.superuser)).toEqual([]);
    expect(await checkModuleRoles(db.superuser, reads)).toEqual([]);
  });

  it("主キーが (tenant_id, user_id, idempotency_key) で、expires_at の索引があること", async () => {
    const { rows } = await db.superuser.query<{ key: string; indexes: string[] }>(
      `SELECT (SELECT string_agg(a.attname, ', ' ORDER BY k.ord)
                 FROM pg_index i
                 CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                WHERE i.indrelid = c.oid AND i.indisprimary) AS key,
              (SELECT array_agg(indexdef) FROM pg_indexes
                WHERE schemaname = 'claim' AND tablename = 'idempotency_key') AS indexes
         FROM pg_class c WHERE c.oid = 'claim.idempotency_key'::regclass`,
    );

    expect(rows[0]?.key).toBe("tenant_id, user_id, idempotency_key");
    expect(rows[0]?.indexes.some((definition) => definition.includes("(expires_at)"))).toBe(true);
  });

  it("RLS が有効で、所有者にも強制され、テナントを設定した接続は自分のテナントの行しか見えないこと", async () => {
    const { rows } = await db.superuser.query<{ rls: boolean; force: boolean; policies: number }>(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
              (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'claim' AND tablename = 'idempotency_key') AS policies
         FROM pg_class c WHERE c.oid = 'claim.idempotency_key'::regclass`,
    );
    expect(rows[0]).toEqual({ rls: true, force: true, policies: 1 });

    const insert = async (tenantId: string) => {
      const client = await db.appUser.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE claim_module");
        await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
        await client.query(
          `INSERT INTO claim.idempotency_key (tenant_id, user_id, idempotency_key, request_hash, expires_at,
             created_at, created_by, created_pgm_cd, created_tx_id, updated_at, updated_by, updated_pgm_cd, updated_tx_id)
           VALUES ($1, $2, $3, repeat('0', 64), now(), now(), 'u', 'p', 't', now(), 'u', 'p', 't')`,
          [tenantId, user, key],
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    };
    // 別のテナントの同じ (user, key) は、それぞれ入る。
    await insert(tenantA);
    await insert(tenantB);

    const client = await db.appUser.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE claim_module");
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantA]);
      const seen = await client.query<{ tenant_id: string }>(
        "SELECT tenant_id FROM claim.idempotency_key",
      );
      expect(seen.rows).toEqual([{ tenant_id: tenantA }]);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
