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

  it("gives users UUID ids, so they can be used as tenant ids (ADR 0011)", async () => {
    const browser = fixture.newBrowser();
    await browser.login(users.yamada);

    const body: unknown = await (await browser.request("/api/me")).json();

    const id = typeof body === "object" && body !== null && "id" in body ? body.id : undefined;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("does not let a signed-in user create an organization, which is a tenant", async () => {
    const browser = await fixture.signedIn();

    const res = await browser.request("/api/auth/organization/create", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.example.test" },
      body: JSON.stringify({ name: "Evil Corp", slug: "evil-corp" }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await fixture.db.owner.query("SELECT 1 FROM auth.organization")).rowCount).toBe(0);
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
