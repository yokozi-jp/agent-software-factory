import {
  ABOUT_BLANK,
  commonProblemTypes,
  problemResponse,
  statusTitle,
} from "@agent-software-factory/shared-kernel/problem";
import type { MiddlewareHandler } from "hono";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cookie のセッションで認証する API の CSRF 対策 (docs/adr/0022、RFC 10017 6.1.3.3)。
 * GET、HEAD、OPTIONS 以外の要求に対して、次を求める。
 * - Origin ヘッダーがあれば、公開のオリジンと同じ (403)。
 * - Sec-Fetch-Site ヘッダーがあれば、same-origin (403)。
 * - Content-Type は application/json (415)。フォームで送れる形式を受け付けない (OWASP)。
 *
 * hono/csrf は application/json を検査しないので使わない (hono.dev/docs/middleware/builtin/csrf)。
 */
export function csrfProtection(origin: string): MiddlewareHandler {
  return async (c, next) => {
    if (safeMethods.has(c.req.method)) return next();

    const requestOrigin = c.req.header("origin");
    if (requestOrigin !== undefined && requestOrigin !== origin) {
      return problemResponse(c, {
        type: commonProblemTypes.forbiddenOrigin,
        title: "The origin of the request is not allowed.",
        status: 403,
      });
    }

    const fetchSite = c.req.header("sec-fetch-site");
    if (fetchSite !== undefined && fetchSite !== "same-origin") {
      return problemResponse(c, {
        type: commonProblemTypes.forbiddenCrossSiteRequest,
        title: "Cross-site requests are not allowed.",
        status: 403,
      });
    }

    const contentType = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      return problemResponse(c, {
        type: ABOUT_BLANK,
        title: statusTitle(415),
        status: 415,
        detail: "The Content-Type must be application/json.",
      });
    }

    return next();
  };
}
