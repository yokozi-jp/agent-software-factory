import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";
import { users } from "../../test/credentials.ts";

describe("login with OIDC (docs/adr/0022)", () => {
  let fixture: AuthFixture;

  beforeAll(async () => {
    fixture = await createAuthFixture();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("keeps Better Auth's tables in the auth schema, out of reach of the app role", async () => {
    const tables = await fixture.db.owner.query(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_name IN ('user', 'session', 'account', 'organization', 'member')`,
    );

    expect(new Set(tables.rows.map((row: { table_schema: string }) => row.table_schema))).toEqual(
      new Set(["auth"]),
    );
    await expect(fixture.db.appUser.query(`SELECT id FROM auth."user"`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("rejects a request without a session", async () => {
    const res = await fixture.app.request("/api/me");

    expect(res.status).toBe(401);
  });

  it("starts a session after the user signs in at the IdP", async () => {
    const browser = fixture.newBrowser();

    await browser.login(users.yamada);
    const res = await browser.request("/api/me");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: users.yamada.email });
  });

  it("keeps two users' sessions apart", async () => {
    const yamada = fixture.newBrowser();
    const sato = fixture.newBrowser();

    await yamada.login(users.yamada);
    await sato.login(users.sato);

    expect(await (await yamada.request("/api/me")).json()).toMatchObject({
      email: users.yamada.email,
    });
    expect(await (await sato.request("/api/me")).json()).toMatchObject({
      email: users.sato.email,
    });
  });
});
