import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { loginSearchFor } from "@/lib/login-redirect.ts";

// 保護された route の入口。未ログインなら、元の相対パスを持たせて /login に移す (Issue #397)。
// これは画面の出し分けで、データの認可の境界は API にある (docs/adr/0022)。
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    if ((await context.getSession()) === "unauthenticated") {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router の redirect は throw する値で、Error ではない
      throw redirect({ to: "/login", search: loginSearchFor(location.href) });
    }
  },
  component: Outlet,
});
