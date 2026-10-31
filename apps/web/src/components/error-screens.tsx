import { useRouteContext, Link, rootRouteId } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// 文言は Issue #399、#415 の決定。必要な役割や、他人の画面が存在するかどうかは書かない。

function ErrorScreen({
  title,
  link,
}: {
  readonly title: string;
  readonly link: { readonly to: "/" | "/login"; readonly label: string } | undefined;
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-lg font-semibold">{title}</h1>
      {link === undefined ? null : <Link to={link.to}>{link.label}</Link>}
    </main>
  );
}

/**
 * 存在しない URL (他人の申請も同じ)。URL は変えない。
 * ログイン済みは「トップへ戻る」、未ログインは「ログインへ」。確かめるまではリンクを出さない。
 */
export function NotFoundScreen() {
  const { t } = useTranslation();
  const { getSession } = useRouteContext({ from: rootRouteId });
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    // 確かめられない (障害) ときは未ログインとして扱う。ログイン画面には誰でも入れる。
    getSession().then(
      (state) => {
        setSignedIn(state === "authenticated");
      },
      () => {
        setSignedIn(false);
      },
    );
  }, [getSession]);
  const link =
    signedIn === undefined
      ? undefined
      : signedIn
        ? ({ to: "/", label: t("errorScreen.toHome") } as const)
        : ({ to: "/login", label: t("errorScreen.toLogin") } as const);
  return <ErrorScreen title={t("notFound.title")} link={link} />;
}

/** 権限のない画面。URL は変えず、権限のない route の中に出す。ログイン済みの利用者だけが来る。 */
export function ForbiddenScreen() {
  const { t } = useTranslation();
  return (
    <ErrorScreen title={t("forbidden.title")} link={{ to: "/", label: t("errorScreen.toHome") }} />
  );
}
