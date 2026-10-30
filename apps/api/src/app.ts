// サンプル機能のモジュール (docs/adr/0026)。app.ts は各モジュールの公開 API (index.ts) を import して
// route を組み立てるだけにする。モジュールはまだ route を持たないので、今は import だけ。
import "@agent-software-factory/approval";
import "@agent-software-factory/claim";
import "@agent-software-factory/closing";
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

export function createApp({ auth }: AppDependencies = {}) {
  const base = new OpenAPIHono<{ Variables: SessionVariables }>({ defaultHook: validationHook });
  // `use` は OpenAPIHono ではなく Hono を返し、そのあとでは `openapi` を呼べない。`use` を先に呼び、route の型は
  // `openapi` の戻り値で受ける (同じ object なので、このあとの `app.use` は全 route に効く)。
  base.use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"] },
      strictTransportSecurity: "max-age=63072000; includeSubDomains",
      xContentTypeOptions: "nosniff",
      xXssProtection: false,
      xFrameOptions: false,
    }),
  );
  const app = base.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

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

// spec のサーバー URL は相対パス。web と API は同じオリジンで配信する (docs/adr/0022、0047)。
export const openApiDocument: Parameters<OpenAPIHono["getOpenAPI31Document"]>[0] = {
  openapi: "3.1.0",
  info: { title: "agent-software-factory API", version: "0.0.0" },
  servers: [{ url: "/" }],
};
