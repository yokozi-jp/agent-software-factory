import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

// 文言は Issue #399、#415 で決める。ここでは、画面の置き場所と「トップへ戻る」だけを置く。
// 「トップへ戻る」は `/` へ向かう。未ログインの利用者は、`/` の guard で `/login` に移る。

interface ErrorScreenProps {
  readonly title: string;
  /** グローバルメニューの外枠の中に出すとき。外枠が `<main>` を持つので、全画面の `<main>` は作らない。 */
  readonly embedded: boolean;
}

function ErrorScreen({ title, embedded }: ErrorScreenProps) {
  const { t } = useTranslation();
  const content = (
    <>
      <h1 className="text-lg font-semibold">{title}</h1>
      <Link to="/">{t("errorScreen.toHome")}</Link>
    </>
  );
  return embedded ? (
    <div className="flex flex-col items-start gap-4">{content}</div>
  ) : (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">{content}</main>
  );
}

/** 存在しない URL。URL は変えない。 */
export function NotFoundScreen({ embedded = false }: { readonly embedded?: boolean }) {
  const { t } = useTranslation();
  return <ErrorScreen title={t("notFound.title")} embedded={embedded} />;
}

/** 権限のない画面。URL は変えず、権限のない route の中に出す。 */
export function ForbiddenScreen({ embedded = false }: { readonly embedded?: boolean }) {
  const { t } = useTranslation();
  return <ErrorScreen title={t("forbidden.title")} embedded={embedded} />;
}
