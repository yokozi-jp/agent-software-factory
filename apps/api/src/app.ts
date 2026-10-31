// サンプル機能のモジュール (docs/adr/0026)。app.ts は各モジュールの公開 API (index.ts) を import して
// route を組み立てるだけにする。モジュールはまだ route を持たないので、今は import だけ。
import "@agent-software-factory/approval";
import "@agent-software-factory/claim";
import "@agent-software-factory/closing";
import {
  commonProblemResponses,
  commonProblemTypes,
  problemErrorHandler,
  problemNotFoundHandler,
  problemResponse,
} from "@agent-software-factory/shared-kernel/problem";
import { noopLogger, type Logger } from "@agent-software-factory/logging";
import { urlWithoutQuery } from "@agent-software-factory/telemetry";
import { httpInstrumentationMiddleware } from "@hono/otel";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { contextStorage } from "hono/context-storage";
import { secureHeaders } from "hono/secure-headers";

import type { Auth } from "./auth/auth.ts";
import { sessionGuard } from "./auth/session.ts";
import {
  accessLog,
  logUnexpectedError,
  requestContext,
  type ApiVariables,
} from "./http/logging.ts";
import { validationHook } from "./http/validation-hook.ts";
import { unusedRuntime, type ApiRuntime } from "./runtime.ts";
import { csrfProtection } from "./security/csrf.ts";

// セキュリティヘッダーの値は docs/web-api/security.md に従う。
// Hono の既定値のうち、規約が非推奨とする X-XSS-Protection と X-Frame-Options は付けない。
//
// CORS の middleware は入れない。web と API は同じオリジンで配信する (理由と構成は
// docs/web-api/security.md「CORS」、ADR 0013、ADR 0022)。
// 別のオリジンから呼ぶ構成にするときは、許可するオリジンを環境変数で明示した hono/cors を入れ、
// ワイルドカードは使わない (docs/web-api/security.md「CORS」)。
export interface AppDependencies {
  /** 認証。渡さないと認証の経路 (`/api/auth/*`) と session の guard は付かず、`/api/me` は常に 401 を返す。 */
  readonly auth?: Auth;
  /**
   * Effect の実行の環境 (docs/adr/0028)。入口が `createApiRuntime` で 1 つ作って渡す。モジュールの DB は、この runtime の
   * `Database` と各モジュールの `Tx` から得る (docs/adr/0029)。必ず渡す: 渡し忘れを型の検査で止める。spec の生成と DB を使わない
   * テストは `unusedRuntime()` を渡す。route は runtime によって変えない (spec と AppType は変わらない)。
   * モジュールはまだ route を持たないので、今は受け取るだけ。
   */
  readonly runtime: ApiRuntime;
  /** ロガー (docs/adr/0049)。入口が作って渡す。渡さないと何も出さない。 */
  readonly logger?: Logger;
}

// route は createRoute で書く。ここから OpenAPI 3.1 の spec (apps/api/openapi.json) を生成し、web が hc で同じ型を使う
// (docs/adr/0047)。応答のステータスは route に明示する。
const healthRoute = createRoute({
  method: "get",
  path: "/health",
  operationId: "getHealth",
  summary: "Health check",
  description: "Reports that the API process is running. It does not check the database.",
  tags: ["health"],
  responses: {
    200: {
      description: "The API is running.",
      content: { "application/json": { schema: z.object({ status: z.literal("ok") }) } },
    },
  },
});

// `/api/me` は auth の有無で route の型を変えない (spec と AppType に常に入る)。auth がなければ session が入らないので 401。
// `/api/auth/*` は Better Auth が扱う経路で、契約の外に置く (docs/adr/0035)。
const meRoute = createRoute({
  method: "get",
  path: "/api/me",
  operationId: "getCurrentUser",
  summary: "Current user",
  description:
    "Returns the user of the current session. Responds 401 when there is no valid session.",
  tags: ["auth"],
  responses: {
    200: {
      description: "The signed-in user.",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string(),
            email: z.email(),
            name: z.string(),
            roles: z
              .array(z.string())
              .describe(
                "Roles of the user in the active tenant, such as accounting. Empty when there is none.",
              ),
          }),
        },
      },
    },
    401: commonProblemResponses[401],
  },
});

// 受信のトレースが取る属性 (docs/adr/0048)。ヘッダーは取らない (captureRequestHeaders を書かない)。
// url.full の既定はクエリ文字列を含み、OIDC の callback の code や state が載るので、クエリを落とす。
// SDK が起動していなければ、この middleware は何もしない。
const tracingMiddleware = httpInstrumentationMiddleware({
  getUrlFull: (c) => urlWithoutQuery(c.req.url),
});

// member の role は、複数の役割をコンマで区切って持つ (Better Auth の organization plugin)。
async function activeRoles(auth: Auth, headers: Headers): Promise<string[]> {
  // active organization のメンバーでなくなった (退職など) 利用者は、Better Auth が 403 を投げる。役割はなく、
  // ログインは続けられる。ほかの失敗でも、メニューが減るだけで (空の roles)、操作の認可は API の application 層が行う。
  const role = await auth.betterAuth.api
    .getActiveMemberRole({ headers })
    .then((member) => member.role)
    .catch(() => "");
  return role.split(",").filter((name) => name !== "");
}

export function createApp({ auth, logger = noopLogger }: AppDependencies) {
  const base = new OpenAPIHono<{ Variables: ApiVariables }>({
    defaultHook: validationHook,
  });
  // `use` は OpenAPIHono ではなく Hono を返し、そのあとでは `openapi` を呼べない。`use` を先に呼び、route の型は
  // `openapi` の戻り値で受ける (同じ object なので、このあとの `app.use` は全 route に効く)。
  // ログの順序 (docs/adr/0049): contextStorage() → @hono/otel → リクエストの文脈 → アクセスログ。logger が今のリクエストと
  // 今の span を読めるようにし、otel の後ろに置いて trace_id を付ける。
  base.use(contextStorage());
  base.use(tracingMiddleware);
  base.use(requestContext());
  base.use(accessLog(logger));
  base.use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"] },
      strictTransportSecurity: "max-age=63072000; includeSubDomains",
      xContentTypeOptions: "nosniff",
      xXssProtection: false,
      xFrameOptions: false,
    }),
  );
  // エラー応答の変換 4 か所のうちの 2 つ (docs/adr/0035)。残りは defaultHook と route の _tag の switch。
  // 5xx のログはここで書く (docs/adr/0049)。401、403、400 の検証失敗の記録は accessLog にある。
  base.onError(problemErrorHandler(logUnexpectedError(logger)));
  base.notFound(problemNotFoundHandler);
  // middleware は route より前に登録する (Hono は登録順に実行する)。route の型は `openapi` の chain で受ける。
  if (auth !== undefined) {
    base.use("/api/*", csrfProtection(auth.origin));
    base.use("/api/*", sessionGuard(auth));
    // ログアウトのあと、ブラウザに HTTP cache と Cookie を捨てさせる (OWASP Session Management)。
    base.use("/api/auth/sign-out", async (c, next) => {
      await next();
      if (c.res.ok) c.header("Clear-Site-Data", '"cache", "cookies"');
    });
    base.on(["GET", "POST"], "/api/auth/*", (c) => auth.betterAuth.handler(c.req.raw));
  }

  const app = base
    .openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200))
    .openapi(meRoute, async (c) => {
      const session = c.get("session");
      const user = session?.user;
      if (user === undefined) {
        return problemResponse(c, {
          type: commonProblemTypes.unauthenticated,
          title: "Authentication is required.",
          status: 401,
        });
      }
      // 役割はアプリの DB (member の行) にあり、セッションの active organization で引く (docs/adr/0022)。
      // 画面の出し分けのための値で、操作の認可は API の application 層が行う (docs/adr/0045)。
      const roles =
        auth !== undefined && session?.session.activeOrganizationId
          ? await activeRoles(auth, c.req.raw.headers)
          : [];
      return c.json({ id: user.id, email: user.email, name: user.name, roles }, 200);
    });

  return app;
}

// spec の生成 (openapi.ts) と vp dev の入口 (index.ts) が使う app。どちらも DB を使わないので、DB のない runtime を渡す。
export const app = createApp({ runtime: unusedRuntime() });
