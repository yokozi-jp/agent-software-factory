import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

import type { Auth } from "./auth/auth.ts";
import { requireSession, sessionGuard, type SessionVariables } from "./auth/session.ts";
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
}

export function createApp({ auth }: AppDependencies = {}) {
  const app = new Hono<{ Variables: SessionVariables }>()
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
