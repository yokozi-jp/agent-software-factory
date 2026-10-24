import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

// セキュリティヘッダーの値は docs/web-api/security.md に従う。
// Hono の既定値のうち、規約が非推奨とする X-XSS-Protection と X-Frame-Options は付けない。
//
// CORS の middleware は入れない。この API は同一オリジンで配信する構成を前提にしていて、
// ブラウザは CORS の preflight を送らないため (docs/web-api/security.md「CORS」)。
// `Access-Control-*` を返さなければ、別のオリジンのページはレスポンスを読めない。
// 別のオリジンから呼ぶ構成にするときは、許可するオリジンを環境変数で明示した
// hono/cors を入れ、ワイルドカードは使わない。
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
