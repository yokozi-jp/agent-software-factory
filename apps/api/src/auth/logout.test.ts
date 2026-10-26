import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { appOrigin, createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";
import { readUrl } from "../../test/browser.ts";
import { users } from "../../test/credentials.ts";

describe("ログアウト (ADR 0022)", () => {
  let fixture: AuthFixture;

  beforeAll(async () => {
    fixture = await createAuthFixture();
  });

  afterAll(async () => {
    await fixture.close();
  });

  async function signOut(browser: ReturnType<AuthFixture["newBrowser"]>) {
    return browser.request("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json", origin: appOrigin },
      body: JSON.stringify({ callbackURL: "/", disableRedirect: true }),
    });
  }

  it("セッションの行と Cookie を消し、ブラウザにデータを捨てさせること", async () => {
    const browser = fixture.newBrowser();
    await browser.login(users.yamada);
    expect((await fixture.db.owner.query("SELECT 1 FROM auth.session")).rowCount).toBe(1);

    const res = await signOut(browser);

    expect(res.status).toBe(200);
    expect(res.headers.get("clear-site-data")).toBe('"cache", "cookies"');
    expect(
      browser.appSetCookies.some(
        (line) => line.startsWith("__Host-session_token=;") && /max-age=0/i.test(line),
      ),
    ).toBe(true);
    expect((await fixture.db.owner.query("SELECT 1 FROM auth.session")).rowCount).toBe(0);
    expect((await browser.request("/api/me")).status).toBe(401);
  });

  it("リクエストが拒否されたときは、ブラウザにデータを捨てさせないこと", async () => {
    const res = await fixture.app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: "{}",
    });

    expect(res.status).toBe(403);
    expect(res.headers.has("clear-site-data")).toBe(false);
  });

  it("IdP のセッションも終わらせ、次のログインでパスワードを聞き直すこと", async () => {
    const browser = fixture.newBrowser();
    await browser.login(users.sato);

    const res = await signOut(browser);
    const url = await readUrl(res);
    expect(new URL(url).searchParams.get("id_token_hint")).not.toBeNull();
    await browser.follow(url);

    // IdP のセッションが残っていると、ログイン画面を出さずにログインが済み、login() が失敗する。
    await expect(browser.login(users.sato)).resolves.toBeDefined();
    expect((await browser.request("/api/me")).status).toBe(200);
  });
});
