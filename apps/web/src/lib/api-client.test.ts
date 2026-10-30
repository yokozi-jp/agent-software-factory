import { describe, expect, it, vi } from "vite-plus/test";

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
});
