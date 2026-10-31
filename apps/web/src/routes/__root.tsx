import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import type { AppContext } from "@/lib/session.ts";

// 404 は、どの route にも当たらない URL を `routes/$.tsx` が受けて出す (ログイン済みならメニューの中、未ログインならメニューなし)。
// route の中で notFound() を投げる画面 (他人の申請など) は、投げる route を足す Issue が、`_authenticated` に
// notFoundComponent を足して、メニューの中の 404 を出す (Issue #407)。
export const Route = createRootRouteWithContext<AppContext>()({
  component: Outlet,
});
