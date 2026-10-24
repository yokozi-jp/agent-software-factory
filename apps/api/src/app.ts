import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

// セキュリティヘッダーの値は docs/web-api/security.md に従う。
// Hono の既定値のうち、規約が非推奨とする X-XSS-Protection と X-Frame-Options は付けない。
//
// CORS の middleware は今は入れない。この API を呼ぶブラウザのコード (apps/web) がまだなく、
// 許可する相手がいないため。`Access-Control-*` を返さなければ、別のオリジンのページは
// レスポンスを読めない。web が API を呼ぶ構成 (同一オリジンか CORS か) は
// https://github.com/yokozi-jp/agent-software-factory/issues/114 で決める。
// 別のオリジンから呼ぶ構成にするときは、許可するオリジンを環境変数で明示した
// hono/cors を入れ、ワイルドカードは使わない (docs/web-api/security.md「CORS」)。
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
