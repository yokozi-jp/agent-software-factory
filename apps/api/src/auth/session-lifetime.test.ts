import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";
import { users } from "../../test/credentials.ts";

const minute = 60_000;
const hour = 60 * minute;

describe("session lifetime (docs/adr/0022, OWASP Session Management)", () => {
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

  async function loginAt(start: Date) {
    const browser = fixture.newBrowser();
    await browser.login(users.yamada);
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    return browser;
  }

  it("ends the session after 30 minutes without activity", async () => {
    const browser = await loginAt(new Date());
    vi.setSystemTime(Date.now() + 31 * minute);

    const res = await browser.request("/api/me");

    expect(res.status).toBe(401);
  });

  it("keeps the session alive while the user is active", async () => {
    const browser = await loginAt(new Date());

    for (let elapsed = 0; elapsed < 3 * hour; elapsed += 20 * minute) {
      vi.setSystemTime(Date.now() + 20 * minute);
      expect((await browser.request("/api/me")).status).toBe(200);
    }
  });

  it("ends the session after 8 hours even when the user stays active", async () => {
    const browser = await loginAt(new Date());

    for (let elapsed = 0; elapsed < 8 * hour; elapsed += 20 * minute) {
      vi.setSystemTime(Date.now() + 20 * minute);
      await browser.request("/api/me");
    }
    vi.setSystemTime(Date.now() + 20 * minute);

    expect((await browser.request("/api/me")).status).toBe(401);
  });
});
