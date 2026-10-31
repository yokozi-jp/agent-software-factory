import { Outlet, createFileRoute } from "@tanstack/react-router";

import { RouteError } from "@/components/route-error.tsx";
import { ForbiddenError } from "@/lib/forbidden.ts";
import { accountingRole } from "@/lib/session.ts";

// 経理専用の画面の入口 (pathless layout)。経理でなければ、URL を変えずに 403 を出す。
// 画面の制御のためで、本当の認可は API が行う (docs/web-frontend/authorization.md)。
export const Route = createFileRoute("/_authenticated/_accounting")({
  beforeLoad: ({ context }) => {
    if (!context.user.roles.includes(accountingRole)) throw new ForbiddenError();
  },
  component: Outlet,
  errorComponent: RouteError,
});
