import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createTestDatabase, type TestDatabase } from "./database.ts";
import { openRolledBack, rolledBackPerTest } from "./rolled-back.ts";

// ロールの変更を、ROLLBACK するまで、ほかの接続から見せないこと (Issue #448)。
describe("openRolledBack", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  const canCreateRole = async () =>
    (
      await db.superuser.query<{ rolcreaterole: boolean }>(
        `SELECT rolcreaterole FROM pg_roles WHERE rolname = 'app_user'`,
      )
    ).rows[0]?.rolcreaterole;

  it("ロールの変更は、中では見え、ほかの接続からは見えず、rollback で消えること", async () => {
    const session = await openRolledBack(db);

    await session.superuser.query(`ALTER ROLE app_user CREATEROLE`);
    const inside = await session.superuser.query<{ rolcreaterole: boolean }>(
      `SELECT rolcreaterole FROM pg_roles WHERE rolname = 'app_user'`,
    );
    const outside = await canCreateRole();
    await session.rollback();

    expect(inside.rows[0]?.rolcreaterole).toBe(true);
    expect(outside).toBe(false);
    expect(await canCreateRole()).toBe(false);
  });

  it("migrator の口で作った表は、所有者が migrator で、rollback で消えること", async () => {
    const session = await openRolledBack(db);

    await session.migrator.query(`CREATE TABLE claim.t_rolled_back (id int)`);
    const owner = await session.superuser.query<{ tableowner: string }>(
      `SELECT tableowner FROM pg_tables WHERE tablename = 't_rolled_back'`,
    );
    await session.rollback();

    expect(owner.rows).toEqual([{ tableowner: "migrator" }]);
    const after = await db.superuser.query(
      `SELECT 1 FROM pg_tables WHERE tablename = 't_rolled_back'`,
    );
    expect(after.rowCount).toBe(0);
  });

  it("並べて呼んだ問い合わせを、1 つずつ流し、失敗があっても後の問い合わせを流せること", async () => {
    const session = await openRolledBack(db);

    const results = await Promise.allSettled([
      session.superuser.query(`SELECT 1 AS n`),
      session.superuser.query(`SELECT * FROM no_such_table`),
    ]);
    await session.rollback();

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  });
});

describe("rolledBackPerTest", () => {
  const session = rolledBackPerTest();
  let outsideTest: unknown;
  // rolledBackPerTest が登録した beforeEach より前に動く beforeAll では、まだテストのトランザクションがない。
  beforeAll(async () => {
    try {
      await session.superuser.query("SELECT 1");
    } catch (error) {
      outsideTest = error;
    }
  });

  it("テストの外で使うと、失敗すること", () => {
    expect(String(outsideTest)).toContain("テストの中で使う");
  });

  it("前のテストで変えたロールが、次のテストに残らないこと", async () => {
    const result = await session.superuser.query(`ALTER ROLE app_user CREATEROLE`);
    expect(result.command).toBe("ALTER");
  });

  it("次のテストでは、元に戻っていること", async () => {
    const { rows } = await session.superuser.query<{ rolcreaterole: boolean }>(
      `SELECT rolcreaterole FROM pg_roles WHERE rolname = 'app_user'`,
    );
    expect(rows).toEqual([{ rolcreaterole: false }]);
  });
});
