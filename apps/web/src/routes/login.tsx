import { createFileRoute, redirect } from "@tanstack/react-router";

import { LoginScreen } from "@/components/login-screen.tsx";
import { selectLoginMessage } from "@/lib/login-message.ts";
import { parseLoginReason, safeRedirect, type LoginSearch } from "@/lib/login-redirect.ts";
import type { SessionState } from "@/lib/session.ts";

// URL の search は利用者が書き換えられるので、読むときに検査する。redirect は相対パスだけ、reason は知っている識別子だけ。
export const Route = createFileRoute("/login")({
  validateSearch: (search): LoginSearch => ({
    redirect: typeof search["redirect"] === "string" ? safeRedirect(search["redirect"]) : undefined,
    reason: parseLoginReason(search["reason"]),
    error: typeof search["error"] === "string" ? search["error"] : undefined,
  }),
  // ログイン済みで来たら、戻り先 (なければ /) に移す。
  // /api/me が答えないとき (障害) も、ログイン画面は開く。画面まで失敗にすると、復旧した後に入る道もなくなる。
  beforeLoad: async ({ context, search }) => {
    const session = await context.getSession().catch((): SessionState => "unauthenticated");
    if (session === "authenticated") {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router の redirect は throw する値で、Error ではない
      throw redirect({ href: search.redirect ?? "/" });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const { signIn } = Route.useRouteContext();
  const { redirect: returnTo, reason, error } = Route.useSearch();
  return (
    <LoginScreen
      kind={selectLoginMessage(error, reason)}
      onSignIn={() => signIn(returnTo ?? "/")}
    />
  );
}
