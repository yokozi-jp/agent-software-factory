import { createFileRoute } from "@tanstack/react-router";

import { AppLayout } from "@/components/app-layout.tsx";
import { NotFoundScreen } from "@/components/error-screens.tsx";

// どの route にも当たらない URL。URL は変えず、404 を出す。
// ログイン済みならグローバルメニューの中に、未ログインならメニューなしで出す (Issue #407)。
// /api/me が答えないときは、未ログインの画面にする (404 の画面まで失敗にしない)。
export const Route = createFileRoute("/$")({
  beforeLoad: async ({ context }) => {
    const session = await context.getSession().catch(() => "unauthenticated" as const);
    return { user: session === "unauthenticated" ? undefined : session };
  },
  component: UnknownUrl,
});

function UnknownUrl() {
  const { user, signOut } = Route.useRouteContext();
  if (user === undefined) return <NotFoundScreen />;
  return (
    <AppLayout user={user} onSignOut={signOut}>
      <NotFoundScreen embedded />
    </AppLayout>
  );
}
