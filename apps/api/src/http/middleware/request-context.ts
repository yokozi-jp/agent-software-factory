import type { RequestContextSourceEnv } from "@agent-software-factory/shared-kernel";
import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import type { SessionVariables } from "./session.ts";

type RequestContextMiddlewareEnv = {
  Variables: SessionVariables &
    RequestIdVariables &
    RequestContextSourceEnv["Variables"] & { tenantId?: string };
};

/**
 * `/api/*` の全部に付ける。`sessionGuard` のあとに置き、セッションからリクエストの文脈 (テナントと操作する人) を作って
 * `requestContextSource` に入れる。文脈がなければ、その理由 (`requestRefusal`) を入れる。ここでは断らない:
 * テナントを要る route が `requireRequestContext` (shared-kernel) で断り、`/api/me` のように要らない route は読まない。
 *
 * テナントは active organization の id で、セッションからだけ取る。クライアントが送る値 (ヘッダー、パス、本文) は使わない
 * (docs/adr/0011、docs/adr/0022)。ログの `tenant_id` も、ここで入れる値を読む (`requestLogContext`)。
 */
export function requestContextFromSession(): MiddlewareHandler<RequestContextMiddlewareEnv> {
  return async (c, next) => {
    const session = c.get("session");
    if (session === null || session === undefined) {
      c.set("requestRefusal", "unauthenticated");
      return next();
    }
    const tenantId = session.session.activeOrganizationId;
    if (typeof tenantId !== "string" || tenantId === "") {
      c.set("requestRefusal", "no-tenant");
      return next();
    }
    c.set("requestContextSource", {
      tenantId,
      actor: { userId: session.user.id },
      requestId: c.get("requestId"),
    });
    c.set("tenantId", tenantId);
    return next();
  };
}
