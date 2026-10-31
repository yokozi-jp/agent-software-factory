import { describe, expect, it, vi } from "vite-plus/test";

import { createApiClient } from "./api-client.ts";
import { fetchSession, withSessionExpiry } from "./session.ts";

const clientOf = (fetchApi: typeof fetch) => createApiClient("https://web.example", fetchApi);

describe("セッションの確認 (fetchSession)", () => {
  it("200 ならログイン済み", async () => {
    const fetchApi = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ id: "1", email: "a@example.com", name: "A" })),
    );
    await expect(fetchSession(clientOf(fetchApi))).resolves.toBe("authenticated");
    const [input] = vi.mocked(fetchApi).mock.calls[0] ?? [];
    expect(new Request(input ?? "").url).toBe("https://web.example/api/me");
  });

  it("401 なら未ログイン", async () => {
    await expect(
      fetchSession(
        clientOf(() =>
          Promise.resolve(
            Response.json(
              {
                type: "/problems/unauthenticated",
                title: "Authentication is required.",
                status: 401,
              },
              { status: 401 },
            ),
          ),
        ),
      ),
    ).resolves.toBe("unauthenticated");
  });

  it.each([403, 500, 502])("%i は判断できないので投げる", async (status) => {
    await expect(
      fetchSession(clientOf(() => Promise.resolve(new Response(null, { status })))),
    ).rejects.toThrow(String(status));
  });
});

describe("操作の途中のセッション切れ (withSessionExpiry)", () => {
  it("401 なら通知し、応答はそのまま返す", async () => {
    const onUnauthorized = vi.fn<() => void>();
    const response = new Response(null, { status: 401 });
    const guarded = withSessionExpiry(() => Promise.resolve(response), onUnauthorized);
    await expect(guarded("/api/claims")).resolves.toBe(response);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("401 以外は通知しない", async () => {
    const onUnauthorized = vi.fn<() => void>();
    const guarded = withSessionExpiry(
      () => Promise.resolve(new Response(null, { status: 403 })),
      onUnauthorized,
    );
    await guarded("/api/claims");
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
