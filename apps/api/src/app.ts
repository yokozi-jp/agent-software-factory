// サンプル機能のモジュール (docs/adr/0026)。app.ts は middleware を並べ、route の sub-app (http/route/) と
// 各モジュールの公開 API (index.ts) の route を付けるだけにする。モジュールはまだ route を持たないので、今は import だけ。
import "@agent-software-factory/approval";
import "@agent-software-factory/claim";
import "@agent-software-factory/closing";
import {
  problemErrorHandler,
  problemMethodNotAllowedHandler,
  problemNotFoundHandler,
} from "@agent-software-factory/shared-kernel/problem";
import { noopLogger, type Logger } from "@agent-software-factory/logging";
import { urlWithoutQuery } from "@agent-software-factory/telemetry";
import { httpInstrumentationMiddleware } from "@hono/otel";
import { OpenAPIHono } from "@hono/zod-openapi";
import { contextStorage } from "hono/context-storage";
import { methodNotAllowed } from "hono/method-not-allowed";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import type { Auth } from "./auth/auth.ts";
import { validationHook } from "./http/hook/validation-hook.ts";
import { csrfProtection } from "./http/middleware/csrf.ts";
import { accessLog, logUnexpectedError, type ApiVariables } from "./http/middleware/logging.ts";
import { sessionGuard } from "./http/middleware/session.ts";
import { healthRouter } from "./http/route/health.ts";
import { meRouter } from "./http/route/me.ts";
import { runtimeWithoutDatabase, type ApiRuntime } from "./runtime.ts";

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
   * テストは `runtimeWithoutDatabase()` を渡す。route は runtime によって変えない (spec と AppType は変わらない)。
   * モジュールはまだ route を持たないので、今は受け取るだけ。
   */
  readonly runtime: ApiRuntime;
  /** ロガー (docs/adr/0049)。入口が作って渡す。渡さないと何も出さない。 */
  readonly logger?: Logger;
}

// 受信のトレースが取る属性 (docs/adr/0048)。ヘッダーは取らない (captureRequestHeaders を書かない)。
// url.full の既定はクエリ文字列を含み、OIDC の callback の code や state が載るので、クエリを落とす。
// SDK が起動していなければ、この middleware は何もしない。
const tracingMiddleware = httpInstrumentationMiddleware({
  getUrlFull: (c) => urlWithoutQuery(c.req.url),
});

export function createApp({ auth, logger = noopLogger }: AppDependencies) {
  // sub-app の route は、それぞれの createRouter が同じ defaultHook を持つ。ここの defaultHook は、あとから app に直に足す
  // route (テストの fixture) のためにある。
  const base = new OpenAPIHono<{ Variables: ApiVariables }>({ defaultHook: validationHook });
  // ログの順序 (docs/adr/0049): contextStorage() → @hono/otel → リクエストの文脈 → アクセスログ。logger が今のリクエストと
  // 今の span を読めるようにし、otel の後ろに置いて trace_id を付ける。
  base.use(contextStorage());
  base.use(tracingMiddleware);
  base.use(requestId());
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
  // route にある path へ route にない method で来たら、404 を `Allow` 付きの 405 に替える。位置の理由は docs/adr/0035 の 405。
  base.use(methodNotAllowed({ app: base, onMethodNotAllowed: problemMethodNotAllowedHandler }));
  // エラー応答の変換 4 か所のうちの 2 つ (docs/adr/0035)。残りは defaultHook と route の _tag の switch。
  // 5xx のログはここで書く (docs/adr/0049)。401、403、400 の検証失敗の記録は accessLog にある。
  base.onError(problemErrorHandler(logUnexpectedError(logger)));
  base.notFound(problemNotFoundHandler);
  // middleware は route より前に登録する (Hono は登録順に実行する)。
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

  // route は種類ごとの sub-app で、完全な path を持つ (http/route/)。`route()` は sub-app の OpenAPI の定義を写すので、
  // spec (apps/api/openapi.json) と AppType は、ここに route を並べたときと変わらない (docs/adr/0047)。
  const app = base.route("/", healthRouter()).route("/", meRouter(auth));

  return app;
}

// spec の生成 (openapi.ts) と vp dev の入口 (index.ts) が使う app。どちらも DB を使わないので、DB のない runtime を渡す。
export const app = createApp({ runtime: runtimeWithoutDatabase() });
