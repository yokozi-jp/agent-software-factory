import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { appOrigin, createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";

const json = "application/json";

// 405 の middleware は csrfProtection と sessionGuard の外側にある (app.ts)。csrfProtection の 403 と 415 が先に返る。
// sessionGuard はセッションを読むだけで 401 を返さない (401 は route の requireSession) ので、未認証でも 405 になる。
describe("route にない method (405) と認証の順序", () => {
  let fixture: AuthFixture;

  beforeAll(async () => {
    fixture = await createAuthFixture();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("未認証の要求にも、csrfProtection を通ったあとは 405 を返すこと (401 は route の requireSession が返す)", async () => {
    const res = await fixture.app.request("/api/me", {
      method: "PUT",
      headers: { Origin: appOrigin, "Content-Type": json },
    });

    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
  });

  it("csrfProtection に止められる要求は、405 より先に 415 にすること", async () => {
    const res = await fixture.app.request("/api/me", {
      method: "PUT",
      headers: { Origin: appOrigin },
    });

    expect(res.status).toBe(415);
  });

  it("認証済みなら、/api/me への PUT は Allow 付きの 405 にすること", async () => {
    const browser = await fixture.signedIn();

    const res = await browser.request("/api/me", {
      method: "PUT",
      headers: { "Content-Type": json },
    });

    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
  });

  it("/api/auth/* は GET と POST だけを許し、PUT は 405 にすること", async () => {
    const browser = await fixture.signedIn();

    const res = await browser.request("/api/auth/anything", {
      method: "PUT",
      headers: { "Content-Type": json },
    });

    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD, POST");
  });
});
