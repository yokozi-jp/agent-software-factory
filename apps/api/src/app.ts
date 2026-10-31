// サンプル機能のモジュール (docs/adr/0026)。app.ts は各モジュールの公開 API (index.ts) を import して
// route を組み立てるだけにする。モジュールはまだ route を持たないので、今は import だけ。
import "@agent-software-factory/approval";
import "@agent-software-factory/claim";
import "@agent-software-factory/closing";
import { urlWithoutQuery } from "@agent-software-factory/telemetry";
import { httpInstrumentationMiddleware } from "@hono/otel";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { secureHeaders } from "hono/secure-headers";

import type { Auth } from "./auth/auth.ts";
import { requireSession, sessionGuard, type SessionVariables } from "./auth/session.ts";
import type { ModuleDatabases } from "./db/databases.ts";
import { validationHook } from "./http/validation-hook.ts";
import { csrfProtection } from "./security/csrf.ts";

// セキュリティヘッダーの値は docs/web-api/security.md に従う。
// Hono の既定値のうち、規約が非推奨とする X-XSS-Protection と X-Frame-Options は付けない。
//
// CORS の middleware は入れない。web と API は同じオリジンで配信する (理由と構成は
// docs/web-api/security.md「CORS」、ADR 0013、ADR 0022)。
// 別のオリジンから呼ぶ構成にするときは、許可するオリジンを環境変数で明示した hono/cors を入れ、
// ワイルドカードは使わない (docs/web-api/security.md「CORS」)。
export interface AppDependencies {
  /** 認証。渡さないと認証の経路 (`/api/auth/*`、`/api/me`) は付かない。 */
  readonly auth?: Auth;
  /**
   * モジュールの DB。各モジュールの route には、そのモジュールの DB だけを渡す (docs/adr/0025、docs/adr/0029)。
   * モジュールはまだ route を持たないので、今は受け取るだけ。
   */
  readonly databases?: ModuleDatabases;
}

// route は createRoute で書く。ここから OpenAPI 3.1 の spec (apps/api/openapi.json) を生成し、web が hc で同じ型を使う
// (docs/adr/0047)。応答のステータスは route に明示する。
const healthRoute = createRoute({
  method: "get",
  path: "/health",
  summary: "Health check",
  tags: ["health"],
  responses: {
    200: {
      description: "The API is running.",
      content: { "application/json": { schema: z.object({ status: z.literal("ok") }) } },
    },
  },
});

// 受信のトレースが取る属性 (docs/adr/0048)。ヘッダーは取らない (captureRequestHeaders を書かない)。
// url.full の既定はクエリ文字列を含み、OIDC の callback の code や state が載るので、クエリを落とす。
// SDK が起動していなければ、この middleware は何もしない。
const tracingMiddleware = httpInstrumentationMiddleware({
  getUrlFull: (c) => urlWithoutQuery(c.req.url),
});

export function createApp({ auth }: AppDependencies = {}) {
  const withoutRoutes = new OpenAPIHono<{ Variables: SessionVariables }>({
    defaultHook: validationHook,
  });
  // `use` は OpenAPIHono ではなく Hono を返し、そのあとでは `openapi` を呼べない。`use` を先に呼び、route の型は
  // `openapi` の戻り値で受ける (同じ object なので、このあとの `app.use` は全 route に効く)。
  withoutRoutes.use(tracingMiddleware);
  withoutRoutes.use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"] },
      strictTransportSecurity: "max-age=63072000; includeSubDomains",
      xContentTypeOptions: "nosniff",
      xXssProtection: false,
      xFrameOptions: false,
    }),
  );
  const app = withoutRoutes.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

  if (auth !== undefined) {
    app.use("/api/*", csrfProtection(auth.origin));
    app.use("/api/*", sessionGuard(auth));
    // ログアウトのあと、ブラウザに HTTP cache と Cookie を捨てさせる (OWASP Session Management)。
    app.use("/api/auth/sign-out", async (c, next) => {
      await next();
      if (c.res.ok) c.header("Clear-Site-Data", '"cache", "cookies"');
    });
    app.on(["GET", "POST"], "/api/auth/*", (c) => auth.betterAuth.handler(c.req.raw));
    app.get("/api/me", requireSession(), (c) => {
      const user = c.get("session")?.user;
      return c.json({ id: user?.id, email: user?.email, name: user?.name });
    });
  }

  return app;
}

export const app = createApp();
