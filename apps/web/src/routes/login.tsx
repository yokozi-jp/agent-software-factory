import { createFileRoute, redirect } from "@tanstack/react-router";

import { LoginScreen } from "@/components/login-screen.tsx";
import { parseLoginReason, safeRedirect, type LoginSearch } from "@/lib/login-redirect.ts";

// URL の search は利用者が書き換えられるので、読むときに検査する。redirect は相対パスだけ、reason は知っている識別子だけ。
export const Route = createFileRoute("/login")({
  validateSearch: (search): LoginSearch => ({
    redirect: typeof search["redirect"] === "string" ? safeRedirect(search["redirect"]) : undefined,
    reason: parseLoginReason(search["reason"]),
  }),
  // ログイン済みで来たら、戻り先 (なければ /) に移す。
  beforeLoad: async ({ context, search }) => {
    if ((await context.getSession()) === "authenticated") {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router の redirect は throw する値で、Error ではない
      throw redirect({ href: safeRedirect(search.redirect) });
    }
  },
  component: LoginRoute,
});

function LoginRoute() {
  const { signIn } = Route.useRouteContext();
  const { redirect: returnTo, reason } = Route.useSearch();
  return (
    <LoginScreen
      reason={reason}
      onSignIn={() => {
        void signIn(safeRedirect(returnTo));
      }}
    />
  );
}
