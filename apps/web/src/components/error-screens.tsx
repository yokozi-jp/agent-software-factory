import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

// 文言は Issue #399、#415 で決める。ここでは、画面の置き場所と「トップへ戻る」だけを置く。
// 「トップへ戻る」は `/` へ向かう。未ログインの利用者は、`/` の guard で `/login` に移る。

function ErrorScreen({ title }: { readonly title: string }) {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-lg font-semibold">{title}</h1>
      <Link to="/">{t("errorScreen.toHome")}</Link>
    </main>
  );
}

/** 存在しない URL。URL は変えない。 */
export function NotFoundScreen() {
  const { t } = useTranslation();
  return <ErrorScreen title={t("notFound.title")} />;
}

/** 権限のない画面。URL は変えず、権限のない route の中に出す。 */
export function ForbiddenScreen() {
  const { t } = useTranslation();
  return <ErrorScreen title={t("forbidden.title")} />;
}
