import { Button } from "@agent-software-factory/ui/components/button";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { LoginReason } from "@/lib/login-redirect.ts";

export interface LoginScreenProps {
  readonly reason?: LoginReason | undefined;
  /** IdP のログインを始める。失敗したら投げる (画面が「ログインできなかった」を出す)。 */
  readonly onSignIn: () => Promise<void>;
}

// 中央のカードに「IdP でログイン」の 1 ボタン (画面案 B、Issue #402)。理由があれば、ボタンの上に alert で 1 枚出す。
export function LoginScreen({ reason, onSignIn }: LoginScreenProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const reasonMessages = {
    "session-expired": t("login.reason.sessionExpired"),
    "logged-out": t("login.reason.loggedOut"),
  } satisfies Record<LoginReason, string>;
  // 失敗は、URL の理由より新しい出来事なので、先に出す。
  const message = failed
    ? t("login.failed")
    : reason === undefined
      ? undefined
      : reasonMessages[reason];

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <section className="flex w-full max-w-sm flex-col gap-4 rounded-lg border p-6">
        <h1 className="text-lg font-semibold">{t("login.title")}</h1>
        {message === undefined ? null : <p role="alert">{message}</p>}
        <Button
          onClick={() => {
            setFailed(false);
            onSignIn().catch(() => {
              setFailed(true);
            });
          }}
        >
          {t("login.signIn")}
        </Button>
      </section>
    </main>
  );
}
