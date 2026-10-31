import { describe, expect, it, vi } from "vite-plus/test";

import { signOutAndLeave } from "./sign-out.ts";

const fallback = "/login?reason=logged-out";

describe("ログアウトの遷移 (signOutAndLeave)", () => {
  it("IdP のログアウト URL が返れば、そこへ移ること", async () => {
    const assign = vi.fn<(url: string) => void>();
    const signOut = vi.fn<Parameters<typeof signOutAndLeave>[0]>(() =>
      Promise.resolve({ data: { url: "https://idp.example/logout" }, error: null }),
    );

    await signOutAndLeave(signOut, assign, fallback);

    expect(signOut).toHaveBeenCalledWith({ disableRedirect: true, callbackURL: fallback });
    expect(assign).toHaveBeenCalledWith("https://idp.example/logout");
  });

  it.each([{ data: null }, { data: {} }, { data: { url: 1 } }])(
    "URL が返らなければ (%j)、/login へ移ること",
    async ({ data }) => {
      const assign = vi.fn<(url: string) => void>();

      await signOutAndLeave(() => Promise.resolve({ data, error: null }), assign, fallback);

      expect(assign).toHaveBeenCalledWith(fallback);
    },
  );

  it("失敗したら投げ、移らないこと", async () => {
    const assign = vi.fn<(url: string) => void>();

    await expect(
      signOutAndLeave(
        () => Promise.resolve({ data: null, error: { statusText: "Bad Gateway" } }),
        assign,
        fallback,
      ),
    ).rejects.toThrow("Bad Gateway");
    expect(assign).not.toHaveBeenCalled();
  });
});
