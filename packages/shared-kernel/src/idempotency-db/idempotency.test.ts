import { describe, expect, it } from "vite-plus/test";

import { requestHash, type IdempotencyRequest } from "./idempotency.ts";

const base: IdempotencyRequest = {
  method: "POST",
  path: "/api/claims",
  query: "a=1",
  body: '{"amount":100}',
};

describe("requestHash", () => {
  it("同じ要求には同じ 64 文字の 16 進を返すこと", async () => {
    const hash = await requestHash(base);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await requestHash({ ...base })).toBe(hash);
  });

  it("method は大文字小文字を区別しないこと", async () => {
    expect(await requestHash({ ...base, method: "post" })).toBe(await requestHash(base));
  });

  it.each([
    ["method", { method: "PATCH" }],
    ["経路", { path: "/api/claims/1" }],
    ["クエリ文字列", { query: "a=2" }],
    ["本文", { body: '{"amount": 100}' }],
  ])("%s が違えば違うハッシュになること", async (_name, change) => {
    expect(await requestHash({ ...base, ...change })).not.toBe(await requestHash(base));
  });

  it("部分の境目が動いても同じハッシュにならないこと", async () => {
    const one = await requestHash({ method: "POST", path: "/a", query: "b", body: "" });
    const two = await requestHash({ method: "POST", path: "/", query: "ab", body: "" });

    expect(one).not.toBe(two);
  });

  it("本文は UTF-8 のバイト列で見ること", async () => {
    expect(await requestHash({ ...base, body: "金額" })).not.toBe(
      await requestHash({ ...base, body: "金" }),
    );
  });
});
