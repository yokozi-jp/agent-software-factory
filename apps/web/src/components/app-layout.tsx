import { AppShell, type NavItem } from "@agent-software-factory/ui/components/app-shell";
import { Link, useLocation, useMatches } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { UserMenu } from "@/components/user-menu.tsx";
import { visibleNavItems } from "@/lib/nav-items.ts";
import type { SignedInUser } from "@/lib/session.ts";

interface AppLayoutProps {
  readonly user: SignedInUser;
  readonly onSignOut: () => Promise<void>;
  readonly children: ReactNode;
}

/** 保護された route の外枠。グローバルメニューは、ここだけに出す (/login と未ログインの 404 には出さない)。 */
export function AppLayout({ user, onSignOut, children }: AppLayoutProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  // 上部バーの画面の名前は、いちばん深い route が staticData.title で渡す。
  const title = useMatches({
    select: (matches) => {
      let title: ((t: TFunction) => string) | undefined;
      for (const match of matches) title = match.staticData.title ?? title;
      return title;
    },
  });

  const items: NavItem[] = visibleNavItems(user.roles).map((item) => ({
    label: item.label(t),
    href: item.href,
    group: item.group(t),
  }));

  return (
    <AppShell
      items={items}
      currentHref={pathname}
      renderLink={(item) => <Link to={item.href} />}
      title={title?.(t) ?? ""}
      navLabel={t("nav.label")}
      triggerLabel={t("nav.toggle")}
      skipLinkLabel={t("nav.skipToContent")}
      footer={<UserMenu name={user.name} onSignOut={onSignOut} />}
    >
      {children}
    </AppShell>
  );
}
