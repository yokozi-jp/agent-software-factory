import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import { NotFoundScreen } from "@/components/error-screens.tsx";
import type { AppContext } from "@/lib/session.ts";

// 404 は 2 か所で出す。どの route にも当たらない URL は `routes/$.tsx` (ログイン済みならメニューの中)、
// route の中で notFound() を投げた場合は、`_authenticated` の中ならメニューの中、そうでなければここ (Issue #397、#407)。
export const Route = createRootRouteWithContext<AppContext>()({
  component: Outlet,
  notFoundComponent: NotFoundScreen,
});
