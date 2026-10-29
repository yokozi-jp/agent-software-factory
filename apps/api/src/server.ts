// Node.js 24 には Temporal がないので、polyfill の global を入れる。Node.js 26 以降は何もしない。
import "temporal-polyfill/global";
import { serve } from "@hono/node-server";
import { Pool } from "pg";

import { createApp } from "./app.ts";
import { createAuth } from "./auth/auth.ts";
import { createModuleDatabases } from "./db/databases.ts";
import { loadEnv } from "./env.ts";

// 入口だけが process.env を読む。検査に通らなければここで例外になり、起動しない (ADR 0032)。
const env = loadEnv(process.env);

// 認証は必須にする。環境変数が足りないまま、認証も CSRF の検査もない API を起動しない (fail closed)。
// Better Auth の表は auth スキーマにあり、auth_service のロールで接続する (packages/db/migrations、docs/adr/0022、docs/adr/0025)。
// 認証なしでの開発は、vp dev (src/index.ts) を使う。
const auth = createAuth({
  database: new Pool({
    connectionString: env.AUTH_DATABASE_URL,
    options: "-c search_path=auth",
  }),
  baseURL: env.PUBLIC_ORIGIN,
  secret: env.AUTH_SECRET,
  oidc: {
    discoveryUrl: env.OIDC_DISCOVERY_URL,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
  },
});

const app = createApp({
  auth,
  // 業務の処理は app_user で接続する。auth スキーマの権限を持たず、RLS を迂回しない (docs/adr/0011)。
  databases: createModuleDatabases(new Pool({ connectionString: env.APP_DATABASE_URL })),
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
