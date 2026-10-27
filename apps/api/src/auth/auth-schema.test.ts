import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";

// migration (db/migrations) を本番と同じ経路で流した DB の、表と権限を確かめる (docs/adr/0022、docs/adr/0025)。
describe("auth スキーマの権限 (ADR 0022、ADR 0025)", () => {
  let fixture: AuthFixture;

  beforeAll(async () => {
    fixture = await createAuthFixture();
  });

  afterAll(async () => {
    await fixture.close();
  });

  const tables = [
    "user",
    "session",
    "account",
    "verification",
    "organization",
    "member",
    "invitation",
  ];

  it("Better Auth の表がすべて auth スキーマにあり、public にはないこと", async () => {
    const found = await fixture.db.owner.query<{ table_schema: string }>(
      `SELECT table_schema FROM information_schema.tables
       WHERE table_name = ANY($1) AND table_type = 'BASE TABLE'`,
      [tables],
    );

    expect(found.rowCount).toBe(tables.length);
    expect(new Set(found.rows.map((row) => row.table_schema))).toEqual(new Set(["auth"]));
  });

  it("auth スキーマと表の所有者が migrator であること", async () => {
    const owners = await fixture.db.owner.query<{ owner: string }>(
      `SELECT DISTINCT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'auth'
       UNION
       SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'auth'`,
    );

    expect(owners.rows).toEqual([{ owner: "migrator" }]);
  });

  it.each(tables)("auth 用ロールが auth.%s を読み書きできること", async (table) => {
    await expect(
      fixture.db.authService.query(`SELECT 1 FROM auth."${table}"`),
    ).resolves.toBeDefined();
    await expect(
      fixture.db.authService.query(`DELETE FROM auth."${table}" WHERE false`),
    ).resolves.toBeDefined();
  });

  it.each(tables)("アプリ用ロールが auth.%s を読めないこと", async (table) => {
    await expect(fixture.db.appUser.query(`SELECT 1 FROM auth."${table}"`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("migrator が後から作る表も、auth 用ロールだけが読み、アプリ用ロールが読めないこと", async () => {
    await fixture.db.migrator.query(`CREATE TABLE auth.later (id text)`);

    await expect(fixture.db.authService.query(`SELECT id FROM auth.later`)).resolves.toBeDefined();
    await expect(fixture.db.appUser.query(`SELECT id FROM auth.later`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it.each([
    `ALTER TABLE auth."user" ADD COLUMN extra text`,
    `DROP TABLE auth."session"`,
    `TRUNCATE auth."account"`,
    `CREATE TABLE auth.mine (id text)`,
  ])("auth 用ロールが DDL を実行できないこと: %s", async (ddl) => {
    await expect(fixture.db.authService.query(ddl)).rejects.toThrow(
      /must be owner|permission denied/,
    );
  });
});
