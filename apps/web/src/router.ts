import type { TFunction } from "i18next";
import { createRouter, type RouterHistory } from "@tanstack/react-router";

import { loginSearchFor } from "./lib/login-redirect.ts";
import type { AppContext } from "./lib/session.ts";
import { routeTree } from "./routeTree.gen.ts";

/** main.tsx と story が、同じ route の木から router を作る。story はメモリ履歴と mock の context を渡す。 */
export function createAppRouter(context: AppContext, history: RouterHistory) {
  return createRouter({ routeTree, context, history });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

/** 操作の途中でセッションが切れたとき、今の画面を戻り先にして、理由つきで /login に移す (Issue #397)。 */
export function goToSessionExpired(router: AppRouter): void {
  // /login にいるなら、もう移した後 (同時の複数の 401 や、ログイン画面の API の 401)。/login を戻り先にしない。
  if (router.state.location.pathname === "/login") return;
  void router.navigate({
    to: "/login",
    search: loginSearchFor(router.state.location.href, "session-expired"),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
  interface StaticDataRouteOption {
    /** 上部バーに出す画面の名前。各 route が渡す (`t` のキーは文字列のリテラルで書く規則のため、関数にする)。 */
    title?: (t: TFunction) => string;
  }
}
