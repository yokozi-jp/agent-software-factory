import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createTestDatabase, type TestDatabase } from "../../test/database.ts";

describe("auth schema (docs/adr/0022)", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.authService.query(`CREATE TABLE "user" (id text PRIMARY KEY)`);
  });

  afterAll(async () => {
    await db.close();
  });

  it("lets the auth service role create and read its own tables", async () => {
    await db.authService.query(`INSERT INTO "user" (id) VALUES ('u1')`);
    const result = await db.authService.query(`SELECT id FROM "user"`);

    expect(result.rows).toEqual([{ id: "u1" }]);
  });

  it("keeps the app role out of the auth schema", async () => {
    await expect(db.appUser.query(`SELECT id FROM auth."user"`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("keeps the app role out of tables the auth role creates later", async () => {
    await db.authService.query(`CREATE TABLE later (id text)`);

    await expect(db.appUser.query(`SELECT id FROM auth.later`)).rejects.toThrow(
      /permission denied/,
    );
  });
});
