// トレースの起動 (docs/adr/0048)。pg などを import する前に有効にする。最初に import する。
import { telemetry } from "./telemetry.ts";
// Node.js 24 には Temporal がないので、polyfill の global を入れる。Node.js 26 以降は何もしない。
import "temporal-polyfill/global";
import { serve } from "@hono/node-server";
import { createDatabase, poolTimeouts } from "@agent-software-factory/db/node";
import { exceptionFields } from "@agent-software-factory/logging";
import {
  createNodeLogger,
  startOrFail,
  stdoutDestination,
} from "@agent-software-factory/logging/node";
import { Pool } from "pg";

import { createApp } from "./app.ts";
import { createAuth } from "./auth/auth.ts";
import { loadEnv, loadLoggerSettings } from "./env.ts";
import { requestLogContext } from "./http/logging.ts";
import { createApiRuntime } from "./runtime.ts";
import { stopGracefully, type StopSteps } from "./shutdown.ts";

// 入口だけが process.env を読む (ADR 0032)。ロガーは環境変数全体の検査より前に作る: 検査の失敗も fatal で出すため、
// ロガーの設定だけは、正しくなければ既定にして先に読む。出力先は標準出力への同期の書き込み (docs/adr/0049)。
const logSettings = loadLoggerSettings(process.env);
const logger = createNodeLogger({
  destination: stdoutDestination(),
  level: logSettings.LOG_LEVEL,
  service: {
    name: "api",
    version: logSettings.SERVICE_VERSION,
    environment: logSettings.DEPLOYMENT_ENVIRONMENT,
  },
  context: requestLogContext,
});

// 停止の合図で閉じるもの。起動に失敗したときは何もない (トレースの送信だけを行う)。
let started: Omit<StopSteps, "flushTelemetry"> = {
  closeServer: () => Promise.resolve(),
  closeResources: () => Promise.resolve(),
};

// 起動の失敗は、ここで fatal を出し、終了コードを非ゼロにする。
await startOrFail(logger, () => {
  // 検査に通らなければここで例外になり、起動しない (ADR 0032)。
  const env = loadEnv(process.env);

  // 認証は必須にする。環境変数が足りないまま、認証も CSRF の検査もない API を起動しない (fail closed)。
  // Better Auth の表は auth スキーマにあり、auth_service のロールで接続する (packages/db/migrations、docs/adr/0022、docs/adr/0025)。
  // 認証なしでの開発は、vp dev (src/index.ts) を使う。
  const authPool = new Pool({
    ...poolTimeouts,
    connectionString: env.AUTH_DATABASE_URL,
    options: "-c search_path=auth",
  });
  const auth = createAuth({
    database: authPool,
    baseURL: env.PUBLIC_ORIGIN,
    secret: env.AUTH_SECRET,
    oidc: {
      discoveryUrl: env.OIDC_DISCOVERY_URL,
      clientId: env.OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET,
    },
  });

  // 業務の処理は app_user で接続する。auth スキーマの権限を持たず、RLS を迂回しない (docs/adr/0011)。モジュールの DB は、
  // この 1 つの pool を runtime の Database で包み、各モジュールの Tx がロールを選ぶ (docs/adr/0028、docs/adr/0029)。
  // 日時は Temporal で読む (docs/adr/0043)。Better Auth の接続 (上) は Date のまま、既定にする (判断。docs/adr/0043 の Better Auth が Date を返す件)。
  const db = createDatabase({ connectionString: env.APP_DATABASE_URL });
  const runtime = createApiRuntime(db);

  const app = createApp({ auth, logger, runtime });

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    logger.info(`api listening on port ${info.port}`);
  });

  started = {
    // node:http の close は、新しい接続を受けず、処理中のリクエストが終わってから callback を呼ぶ。待っている keep-alive の
    // 接続は Node.js 19 から close が閉じる。
    closeServer: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
    closeResources: async () => {
      await runtime.dispose();
      await db.destroy();
      await authPool.end();
    },
  };
});

// 送り先がないと SDK は始まらない。設定し忘れに気づけるよう、起動のときに知らせる (docs/adr/0048)。
if (!telemetry.enabled)
  logger.info(
    "telemetry disabled: OTEL_EXPORTER_OTLP_ENDPOINT is not set, or OTEL_SDK_DISABLED is true",
  );

// ECS はタスクを止めるときに SIGTERM を送り、手元の Ctrl+C は SIGINT を送る。受け付けを止めて処理中のリクエストを待ち、
// runtime と pool を閉じ、送っていない span を送り切ってから終わる (src/shutdown.ts)。
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void stopGracefully({ ...started, flushTelemetry: () => telemetry.shutdown() }).then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error("API-001", exceptionFields(error));
        process.exit(1);
      },
    );
  });
