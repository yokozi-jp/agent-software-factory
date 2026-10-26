import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { appOrigin, createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";

const json = { "content-type": "application/json" };
const form = { "content-type": "application/x-www-form-urlencoded" };

// 状態を変える API の入口。業務の API はまだ無いので、テストが足す。
const stateChangingPath = "/api/orders";

describe("CSRF protection (docs/adr/0022, RFC 10017 6.1.3.3)", () => {
  let fixture: AuthFixture;
  let app: AuthFixture["app"];

  beforeAll(async () => {
    fixture = await createAuthFixture();
    app = fixture.app.post(stateChangingPath, (c) => c.json({ created: true }));
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("lets a same-origin JSON request through", async () => {
    const res = await app.request(stateChangingPath, {
      method: "POST",
      headers: { ...json, origin: appOrigin },
      body: "{}",
    });

    expect(res.status).toBe(200);
  });

  it("rejects a form post from another origin", async () => {
    const res = await app.request(stateChangingPath, {
      method: "POST",
      headers: { ...form, origin: "https://evil.example" },
      body: "a=1",
    });

    expect(res.status).toBe(403);
  });

  it("rejects a JSON post from another origin", async () => {
    const res = await app.request(stateChangingPath, {
      method: "POST",
      headers: { ...json, origin: "https://evil.example" },
      body: "{}",
    });

    expect(res.status).toBe(403);
  });

  it("rejects a cross-site request that the browser marks with Sec-Fetch-Site", async () => {
    const res = await app.request(stateChangingPath, {
      method: "POST",
      headers: { ...json, "sec-fetch-site": "cross-site" },
      body: "{}",
    });

    expect(res.status).toBe(403);
  });

  it.each([
    ["a form body", form],
    ["a plain text body", { "content-type": "text/plain" }],
    ["no content type", {}],
  ])(
    "rejects a state-changing request with %s even from the same origin",
    async (_name, headers) => {
      const res = await app.request(stateChangingPath, {
        method: "POST",
        headers: { ...headers, origin: appOrigin },
        body: "a=1",
      });

      expect(res.status).toBe(415);
    },
  );

  it("does not check safe methods", async () => {
    const res = await app.request("/health", {
      headers: { origin: "https://evil.example" },
    });

    expect(res.status).toBe(200);
  });
});
