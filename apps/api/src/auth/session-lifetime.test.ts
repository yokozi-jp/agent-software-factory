import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";
import { users } from "../../test/credentials.ts";

const minute = 60_000;
const hour = 60 * minute;

describe("セッションの期間 (ADR 0022、OWASP Session Management)", () => {
  let fixture: AuthFixture;

  beforeAll(async () => {
    fixture = await createAuthFixture();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await fixture.close();
  });

  // 期限の検査は認証が目的ではないので、IdP を通さない browser を使う (docs/adr/0022)。
  // Set-Cookie で Cookie の期限が延びることだけは、本物のログインを通した browser で確かめる。
  async function signedInAt(start: Date) {
    const browser = await fixture.signedIn();
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    return browser;
  }

  async function loggedInAt(start: Date) {
    const browser = fixture.newBrowser();
    await browser.login(users.yamada);
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    return browser;
  }

  it("無操作が30分続くとセッションが切れること", async () => {
    const browser = await signedInAt(new Date());
    vi.setSystemTime(Date.now() + 31 * minute);

    const res = await browser.request("/api/me");

    expect(res.status).toBe(401);
  });

  /** 20 分ごとに使い続けて、指定の時間が経つまで進める。 */
  async function useEvery20Minutes(
    browser: ReturnType<AuthFixture["newBrowser"]>,
    duration: number,
  ): Promise<void> {
    for (let elapsed = 0; elapsed < duration; elapsed += 20 * minute) {
      vi.setSystemTime(Date.now() + 20 * minute);
      await browser.request("/api/me");
    }
  }

  it("使われている間は Cookie が切れないこと", async () => {
    const browser = await loggedInAt(new Date());

    await useEvery20Minutes(browser, 3 * hour);

    expect((await browser.request("/api/me")).status).toBe(200);
  });

  // /api/me は業務の API の例、/api/auth/get-session は Better Auth 自身の経路。どちらにも効く。
  it.each(["/api/me", "/api/auth/get-session"])(
    "使われ続けても8時間でセッションが切れること (%s)",
    async (path) => {
      const browser = await signedInAt(new Date());
      await useEvery20Minutes(browser, 8 * hour);

      vi.setSystemTime(Date.now() + 20 * minute);

      expect((await browser.request(path)).status).toBe(401);
    },
  );

  it("最長の期限を過ぎたときの 401 は session-expired の Problem Details にすること", async () => {
    const browser = await signedInAt(new Date());
    await useEvery20Minutes(browser, 8 * hour);
    vi.setSystemTime(Date.now() + 20 * minute);

    const res = await browser.request("/api/me");

    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ type: "/problems/session-expired", status: 401 });
  });

  it("8時間を超えたことが分かった時点で、セッションの行を消すこと", async () => {
    const alone = await createAuthFixture();
    try {
      const browser = await alone.signedIn();
      vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
      expect((await alone.db.superuser.query("SELECT 1 FROM auth.session")).rowCount).toBe(1);

      // 使われ続けた session が 8 時間を超えた最初の要求で、行が消える。
      await useEvery20Minutes(browser, 8 * hour + 20 * minute);

      expect((await alone.db.superuser.query("SELECT 1 FROM auth.session")).rowCount).toBe(0);
    } finally {
      vi.useRealTimers();
      await alone.close();
    }
  });
});
