import type { TFunction } from "i18next";

import { accountingRole } from "./session.ts";

// メニューの項目の定義。画面 (route) の追加と項目の追加を、同じ場所の変更にする (Issue #400)。
// web は module の package に依存しないので、module から組み立てず静的に書く。
// 見せる条件は画面の出し分けで、操作の認可は API が行う (docs/web-frontend/authorization.md)。
// 文言は、キーを文字列のリテラルで渡す規則 (docs/adr/0044) のため、`t` を受ける関数にする。

export interface NavItemDefinition {
  readonly id: "approvals" | "review" | "closing";
  readonly groupId: "approval" | "closing";
  readonly href: "/approvals" | "/review" | "/closing";
  readonly label: (t: TFunction) => string;
  readonly group: (t: TFunction) => string;
  /** 見せる条件。 */
  readonly visibleFor: (roles: readonly string[]) => boolean;
}

const everyone = () => true;
const accountingOnly = (roles: readonly string[]) => roles.includes(accountingRole);

const approvalGroup = (t: TFunction) => t("nav.group.approval");
const closingGroup = (t: TFunction) => t("nav.group.closing");

const navItems: readonly NavItemDefinition[] = [
  // 上長は役割ではなく申請ごとの関係なので、「承認」は全社員に出す。部下がいなければ空の一覧 (Issue #400)。
  {
    id: "approvals",
    groupId: "approval",
    href: "/approvals",
    label: (t) => t("nav.approvals"),
    group: approvalGroup,
    visibleFor: everyone,
  },
  {
    id: "review",
    groupId: "approval",
    href: "/review",
    label: (t) => t("nav.review"),
    group: approvalGroup,
    visibleFor: accountingOnly,
  },
  {
    id: "closing",
    groupId: "closing",
    href: "/closing",
    label: (t) => t("nav.closing"),
    group: closingGroup,
    visibleFor: accountingOnly,
  },
];

/** 役割から見える項目を返す。グループは項目から作るので、見える項目が 0 のグループは出ない。 */
export function visibleNavItems(roles: readonly string[]): NavItemDefinition[] {
  return navItems.filter((item) => item.visibleFor(roles));
}
