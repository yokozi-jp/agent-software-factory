import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

// 文言は Issue #399、#415 の決定。必要な役割や、他人の画面が存在するかどうかは書かない。

interface ErrorLink {
  readonly to: "/" | "/login";
  readonly label: string;
}

interface ErrorScreenProps {
  readonly title: string;
  readonly link: ErrorLink;
  /** グローバルメニューの外枠の中に出すとき。外枠が `<main>` を持つので、全画面の `<main>` は作らない。 */
  readonly embedded: boolean;
}

function ErrorScreen({ title, link, embedded }: ErrorScreenProps) {
  const content = (
    <>
      <h1 className="text-lg font-semibold">{title}</h1>
      <Link to={link.to}>{link.label}</Link>
    </>
  );
  return embedded ? (
    <div className="flex flex-col items-start gap-4">{content}</div>
  ) : (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">{content}</main>
  );
}

/**
 * 存在しない URL (他人の申請も同じ)。URL は変えない。メニューの外に出す。
 * ログイン済みの利用者には `$` route と `_authenticated` が、メニューの中の `EmbeddedNotFound` を出すので、
 * ここに来るのは未ログイン、または /api/me が答えない (障害) 利用者だけ。ログイン画面には誰でも入れるので、
 * 「ログインへ」を出す。
 */
export function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <ErrorScreen
      title={t("notFound.title")}
      link={{ to: "/login", label: t("errorScreen.toLogin") }}
      embedded={false}
    />
  );
}

/**
 * 存在しない URL を、グローバルメニューの中に出す。ログイン済みの利用者だけが来るので、確かめずに
 * 「トップへ戻る」を出す。`_authenticated` の notFoundComponent と、`$` route (ログイン済み) が使う。
 */
export function EmbeddedNotFound() {
  const { t } = useTranslation();
  return (
    <ErrorScreen
      title={t("notFound.title")}
      link={{ to: "/", label: t("errorScreen.toHome") }}
      embedded
    />
  );
}

/** 権限のない画面。URL は変えず、権限のない route の中に出す。ログイン済みの利用者だけが来る。 */
export function ForbiddenScreen({ embedded = false }: { readonly embedded?: boolean }) {
  const { t } = useTranslation();
  return (
    <ErrorScreen
      title={t("forbidden.title")}
      link={{ to: "/", label: t("errorScreen.toHome") }}
      embedded={embedded}
    />
  );
}
