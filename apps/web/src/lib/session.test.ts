import { describe, expect, it, vi } from "vite-plus/test";

import { fetchSession, withSessionExpiry } from "./session.ts";

describe("セッションの確認 (fetchSession)", () => {
  it("200 ならログイン済み", async () => {
    const fetchApi = vi.fn<(input: string) => Promise<Response>>(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );
    await expect(fetchSession(fetchApi)).resolves.toBe("authenticated");
    expect(fetchApi).toHaveBeenCalledWith("/api/me");
  });

  it("401 なら未ログイン", async () => {
    await expect(
      fetchSession(() => Promise.resolve(new Response(null, { status: 401 }))),
    ).resolves.toBe("unauthenticated");
  });

  it.each([403, 500, 502])("%i は判断できないので投げる", async (status) => {
    await expect(
      fetchSession(() => Promise.resolve(new Response(null, { status }))),
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
