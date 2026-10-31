import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";

describe("IdP を通さない認証済みの browser (ADR 0022)", () => {
  let fixture: AuthFixture;

  beforeAll(async () => {
    fixture = await createAuthFixture();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("アプリがログイン済みの利用者として受け取ること", async () => {
    const browser = await fixture.signedIn({ email: "tanaka@example.com" });

    const res = await browser.request("/api/me");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "tanaka@example.com" });
  });

  it("役割を渡さなければ、/api/me の roles は空であること", async () => {
    const browser = await fixture.signedIn();

    expect(await (await browser.request("/api/me")).json()).toMatchObject({ roles: [] });
  });

  it("渡した役割が、/api/me の roles に入ること", async () => {
    const browser = await fixture.signedIn({ roles: ["accounting"] });

    expect(await (await browser.request("/api/me")).json()).toMatchObject({
      roles: ["accounting"],
    });
  });

  it("active organization のメンバーでなくなった利用者は、roles が空であること", async () => {
    const browser = await fixture.signedIn({ roles: ["accounting"] });
    // 退職などで member の行がなくなっても、セッションには active organization が残る。
    await fixture.db.authService.query('DELETE FROM auth."member"');

    const res = await browser.request("/api/me");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ roles: [] });
  });

  it("本物のログインと同じ検査を通ること (ログアウトが効く)", async () => {
    const browser = await fixture.signedIn();
    await browser.request("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.example.test" },
      body: "{}",
    });

    expect((await browser.request("/api/me")).status).toBe(401);
  });
});
