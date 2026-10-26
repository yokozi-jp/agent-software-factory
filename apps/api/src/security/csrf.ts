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
      return c.json({ error: "forbidden origin" }, 403);
    }

    const fetchSite = c.req.header("sec-fetch-site");
    if (fetchSite !== undefined && fetchSite !== "same-origin") {
      return c.json({ error: "forbidden cross-site request" }, 403);
    }

    const contentType = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      return c.json({ error: "content type must be application/json" }, 415);
    }

    return next();
  };
}
