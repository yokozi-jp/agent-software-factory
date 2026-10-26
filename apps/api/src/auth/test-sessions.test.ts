import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";

describe("signed-in browsers without the IdP (docs/adr/0022)", () => {
  let fixture: AuthFixture;

  beforeAll(async () => {
    fixture = await createAuthFixture();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("is accepted by the app as a signed-in user", async () => {
    const browser = await fixture.signedIn({ email: "tanaka@example.com" });

    const res = await browser.request("/api/me");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "tanaka@example.com" });
  });

  it("goes through the same guard as a real login", async () => {
    const browser = await fixture.signedIn();
    await browser.request("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.example.test" },
      body: "{}",
    });

    expect((await browser.request("/api/me")).status).toBe(401);
  });
});
