import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { appOrigin, createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";

const json = { "content-type": "application/json" };
const form = { "content-type": "application/x-www-form-urlencoded" };

// 状態を変える API の入口。業務の API はまだ無いので、テストが足す。
const stateChangingPath = "/api/orders";

describe("CSRF 対策 (ADR 0022、RFC 10017 6.1.3.3)", () => {
  let fixture: AuthFixture;
  let app: AuthFixture["app"];

  beforeAll(async () => {
    fixture = await createAuthFixture();
    app = fixture.app.post(stateChangingPath, (c) => c.json({ created: true }));
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("同じオリジンの JSON のリクエストを通すこと", async () => {
    const res = await app.request(stateChangingPath, {
      method: "POST",
      headers: { ...json, origin: appOrigin },
      body: "{}",
    });

    expect(res.status).toBe(200);
  });

  it("別のオリジンからのフォーム送信を 403 で拒否すること", async () => {
    const res = await app.request(stateChangingPath, {
      method: "POST",
      headers: { ...form, origin: "https://evil.example" },
      body: "a=1",
    });

    expect(res.status).toBe(403);
  });

  it("別のオリジンからの JSON の送信を 403 で拒否すること", async () => {
    const res = await app.request(stateChangingPath, {
      method: "POST",
      headers: { ...json, origin: "https://evil.example" },
      body: "{}",
    });

    expect(res.status).toBe(403);
  });

  it("ブラウザが Sec-Fetch-Site で cross-site と示したリクエストを 403 で拒否すること", async () => {
    const res = await app.request(stateChangingPath, {
      method: "POST",
      headers: { ...json, "sec-fetch-site": "cross-site" },
      body: "{}",
    });

    expect(res.status).toBe(403);
  });

  it.each([
    ["フォーム (application/x-www-form-urlencoded)", form],
    ["text/plain", { "content-type": "text/plain" }],
    ["Content-Type なし", {}],
  ])(
    "同じオリジンでも、状態を変えるリクエストの形式が %s なら 415 で拒否すること",
    async (_name, headers) => {
      const res = await app.request(stateChangingPath, {
        method: "POST",
        headers: { ...headers, origin: appOrigin },
        body: "a=1",
      });

      expect(res.status).toBe(415);
    },
  );

  it("安全なメソッド (GET) は検査しないこと", async () => {
    const res = await app.request("/health", {
      headers: { origin: "https://evil.example" },
    });

    expect(res.status).toBe(200);
  });
});
