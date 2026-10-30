import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import { NotFoundScreen } from "@/components/error-screens.tsx";
import type { AppContext } from "@/lib/session.ts";

// 404 は root に置く。どの route にも当たらない URL と、route の中で notFound() が投げられた場合の両方がここに来る (Issue #397)。
export const Route = createRootRouteWithContext<AppContext>()({
  component: Outlet,
  notFoundComponent: NotFoundScreen,
});
