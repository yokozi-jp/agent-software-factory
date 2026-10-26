import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";

describe("auth schema (docs/adr/0022)", () => {
  let fixture: AuthFixture;

  beforeAll(async () => {
    fixture = await createAuthFixture();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("puts every Better Auth table in the auth schema and none in public", async () => {
    const tables = await fixture.db.owner.query<{ table_schema: string }>(
      `SELECT table_schema FROM information_schema.tables
       WHERE table_name IN ('user', 'session', 'account', 'organization', 'member')`,
    );

    expect(tables.rowCount).toBe(5);
    expect(new Set(tables.rows.map((row) => row.table_schema))).toEqual(new Set(["auth"]));
  });

  it.each(["user", "session", "account", "organization", "member"])(
    "keeps the app role out of auth.%s",
    async (table) => {
      await expect(fixture.db.appUser.query(`SELECT 1 FROM auth."${table}"`)).rejects.toThrow(
        /permission denied/,
      );
    },
  );

  it("keeps the app role out of tables the auth role creates later", async () => {
    await fixture.db.authService.query(`CREATE TABLE later (id text)`);

    await expect(fixture.db.appUser.query(`SELECT id FROM auth.later`)).rejects.toThrow(
      /permission denied/,
    );
  });
});
