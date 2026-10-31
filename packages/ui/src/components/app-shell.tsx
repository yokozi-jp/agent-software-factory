import type { ReactElement, ReactNode } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "#components/sidebar";

// ログイン済みの画面の外枠。左にメニュー、上に開閉の trigger と今の画面の名前を置く (画面案 B、Issue #407)。
// 経費精算の語は持たない。項目は { label, href, group } で受け、行き先の link は呼び出し側の router が作る。

export interface NavItem {
  readonly label: string;
  readonly href: string;
  /** グループの見出し。同じ値の項目が 1 つのグループになり、並びは最初に出た順。 */
  readonly group: string;
}

export interface AppShellProps {
  readonly items: readonly NavItem[];
  /** 今の画面の path。一致する項目に `aria-current="page"` を付ける。 */
  readonly currentHref: string;
  /** 項目の link。router の Link を返す (`<Link to={item.href} />`)。label は子として入る。 */
  readonly renderLink: (item: NavItem) => ReactElement;
  /** 上部バーに出す、今の画面の名前。空なら出さない (画面が自分で見出しを持つとき)。 */
  readonly title: string;
  /** `<nav>` の名前。 */
  readonly navLabel: string;
  /** `SidebarTrigger` の名前。 */
  readonly triggerLabel: string;
  readonly skipLinkLabel: string;
  /** メニューの下に置くもの (ユーザーメニュー)。 */
  readonly footer: ReactNode;
  readonly children: ReactNode;
}

/** 項目をグループにまとめる。項目のないグループは作らない。 */
export function groupItems(items: readonly NavItem[]): { group: string; items: NavItem[] }[] {
  const groups = new Map<string, NavItem[]>();
  for (const item of items) {
    const members = groups.get(item.group);
    if (members === undefined) groups.set(item.group, [item]);
    else members.push(item);
  }
  return [...groups].map(([group, members]) => ({ group, items: members }));
}

const mainId = "main-content";

export function AppShell({
  items,
  currentHref,
  renderLink,
  title,
  navLabel,
  triggerLabel,
  skipLinkLabel,
  footer,
  children,
}: AppShellProps) {
  return (
    <SidebarProvider>
      <a
        href={`#${mainId}`}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        {skipLinkLabel}
      </a>
      <Sidebar variant="sidebar" collapsible="offcanvas">
        <SidebarContent>
          <nav aria-label={navLabel}>
            {groupItems(items).map(({ group, items: members }) => (
              <SidebarGroup key={group}>
                <SidebarGroupLabel>{group}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {members.map((item) => {
                      const active = item.href === currentHref;
                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            isActive={active}
                            aria-current={active ? "page" : undefined}
                            render={renderLink(item)}
                          >
                            {item.label}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </nav>
        </SidebarContent>
        <SidebarFooter>{footer}</SidebarFooter>
      </Sidebar>
      <SidebarInset id={mainId} tabIndex={-1}>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger aria-label={triggerLabel} />
          {title !== "" && <h1 className="text-lg font-semibold">{title}</h1>}
        </header>
        <div className="p-4">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
