import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { EmbeddedNotFound } from "@/components/error-screens.tsx";
import { AppLayout } from "@/components/app-layout.tsx";
import { loginSearchFor } from "@/lib/login-redirect.ts";

// 保護された route の入口。未ログインなら、元の相対パスを持たせて /login に移す (Issue #397)。
// これは画面の出し分けで、データの認可の境界は API にある (docs/adr/0022)。
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const session = await context.getSession();
    if (session === "unauthenticated") {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router の redirect は throw する値で、Error ではない
      throw redirect({ to: "/login", search: loginSearchFor(location.href) });
    }
    return { user: session };
  },
  component: Layout,
  notFoundComponent: NotFoundInLayout,
});

function Layout() {
  const { user, signOut } = Route.useRouteContext();
  return (
    <AppLayout user={user} onSignOut={signOut}>
      <Outlet />
    </AppLayout>
  );
}

// 子の route が notFound() を投げると、この route の notFoundComponent が layout の component の代わりに出る
// (メニューの外枠は出ない)。メニューの中に出すため、外枠を自分で付ける。
function NotFoundInLayout() {
  const { user, signOut } = Route.useRouteContext();
  return (
    <AppLayout user={user} onSignOut={signOut}>
      <EmbeddedNotFound />
    </AppLayout>
  );
}
