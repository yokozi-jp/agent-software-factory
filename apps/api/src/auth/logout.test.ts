import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { appOrigin, createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";
import { readUrl } from "../../test/browser.ts";
import { users } from "../../test/credentials.ts";

describe("logout (docs/adr/0022)", () => {
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

  it("deletes the session row, clears the cookie and asks the browser to drop its data", async () => {
    const browser = fixture.newBrowser();
    await browser.login(users.yamada);
    expect((await fixture.db.owner.query("SELECT 1 FROM auth.session")).rowCount).toBe(1);

    const res = await signOut(browser);

    expect(res.status).toBe(200);
    expect(res.headers.get("clear-site-data")).toBe('"cache", "cookies"');
    expect((await fixture.db.owner.query("SELECT 1 FROM auth.session")).rowCount).toBe(0);
    expect((await browser.request("/api/me")).status).toBe(401);
  });

  it("ends the session at the IdP too, so the next login asks for the password again", async () => {
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
