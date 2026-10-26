import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

// セキュリティヘッダーの値は docs/web-api/security.md に従う。
// Hono の既定値のうち、規約が非推奨とする X-XSS-Protection と X-Frame-Options は付けない。
//
// CORS の middleware は入れない。web と API は同じオリジンで配信する。本番は CloudFront が
// web と /api/* をまとめ (ADR 0013, ADR 0022)、開発は apps/web の Vite の proxy が /api を
// この API へ転送する。ブラウザから見て同一オリジンなので、`Access-Control-*` は要らない。
// 別のオリジンから呼ぶ構成にするときは、許可するオリジンを環境変数で明示した hono/cors を入れ、
// ワイルドカードは使わない (docs/web-api/security.md「CORS」)。
export const app = new Hono()
  .use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"] },
      strictTransportSecurity: "max-age=63072000; includeSubDomains",
      xContentTypeOptions: "nosniff",
      xXssProtection: false,
      xFrameOptions: false,
    }),
  )
  .get("/health", (c) => c.json({ status: "ok" }));
