import { describe, expect, expectTypeOf, it, vi } from "vite-plus/test";

import { createApiClient } from "./api-client.ts";

describe("API クライアント (hc)", () => {
  it("route の応答の型で GET /health の結果を読めること", async () => {
    const fetchApi = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ status: "ok" })));
    const client = createApiClient("https://web.example", fetchApi);

    const res = await client.health.$get();
    const body: { status: "ok" } = await res.json();

    expect(body.status).toBe("ok");
    const [input] = vi.mocked(fetchApi).mock.calls[0] ?? [];
    expect(new Request(input ?? "").url).toBe("https://web.example/health");
  });

  // 契約の型 (ADR 0047): /api/me の応答の形や status を API が変えると、ここが型検査で落ちる。
  it("GET /api/me の応答が、200 の本文と 401 の本文の型を持つこと", async () => {
    const client = createApiClient("https://web.example", () => Promise.resolve(Response.json({})));
    const res = await client.api.me.$get();

    if (res.status === 200) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ id: string; email: string; name: string }>();
    } else {
      expectTypeOf(res.status).toEqualTypeOf<401>();
      expectTypeOf(await res.json()).toEqualTypeOf<{ error: string }>();
    }
  });
});
