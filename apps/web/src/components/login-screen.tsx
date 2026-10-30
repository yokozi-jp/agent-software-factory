import { Button } from "@agent-software-factory/ui/components/button";
import { useTranslation } from "react-i18next";

import type { LoginReason } from "@/lib/login-redirect.ts";

export interface LoginScreenProps {
  readonly reason?: LoginReason | undefined;
  readonly onSignIn: () => void;
}

// 中央のカードに「IdP でログイン」の 1 ボタン (画面案 B、Issue #402)。理由があれば、ボタンの上に alert で 1 枚出す。
export function LoginScreen({ reason, onSignIn }: LoginScreenProps) {
  const { t } = useTranslation();
  const message =
    reason === "session-expired"
      ? t("login.reason.sessionExpired")
      : reason === "logged-out"
        ? t("login.reason.loggedOut")
        : undefined;

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <section className="flex w-full max-w-sm flex-col gap-4 rounded-lg border p-6">
        <h1 className="text-lg font-semibold">{t("login.title")}</h1>
        {message === undefined ? null : <p role="alert">{message}</p>}
        <Button onClick={onSignIn}>{t("login.signIn")}</Button>
      </section>
    </main>
  );
}
