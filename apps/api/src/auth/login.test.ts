import { z } from "@hono/zod-openapi";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";
import { users } from "../../test/credentials.ts";

describe("OIDC でのログイン (ADR 0022)", () => {
  let fixture: AuthFixture;

  beforeAll(async () => {
    fixture = await createAuthFixture();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("セッションがないリクエストを 401 で拒否すること", async () => {
    const res = await fixture.app.request("/api/me");

    expect(res.status).toBe(401);
  });

  it("IdP でログインするとセッションが始まること", async () => {
    const browser = fixture.newBrowser();

    await browser.login(users.yamada);
    const res = await browser.request("/api/me");

    expect(res.status).toBe(200);
    // 200 の本文は route の応答 schema (`{ id, email, name }`) の形であること (ADR 0047)。
    const body = z
      .strictObject({ id: z.string(), email: z.email(), name: z.string() })
      .parse(await res.json());
    expect(body.email).toBe(users.yamada.email);
  });

  it("利用者の ID が UUID であること (テナント ID に使うため。ADR 0011)", async () => {
    const browser = fixture.newBrowser();
    await browser.login(users.yamada);

    const body: unknown = await (await browser.request("/api/me")).json();

    const id = typeof body === "object" && body !== null && "id" in body ? body.id : undefined;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("ログイン済みの利用者が、テナントである organization を作れないこと", async () => {
    const browser = await fixture.signedIn();

    const res = await browser.request("/api/auth/organization/create", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.example.test" },
      body: JSON.stringify({ name: "Evil Corp", slug: "evil-corp" }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await fixture.db.superuser.query("SELECT 1 FROM auth.organization")).rowCount).toBe(0);
  });

  it("2人の利用者のセッションが混ざらないこと", async () => {
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
