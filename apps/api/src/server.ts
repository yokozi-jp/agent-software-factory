import { serve } from "@hono/node-server";
import { Pool } from "pg";

import { createApp } from "./app.ts";
import { createAuth } from "./auth/auth.ts";

const port = Number(process.env.PORT ?? 3000);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`環境変数 ${name} が必要`);
  return value;
}

// 認証は、AUTH_DATABASE_URL を渡したときだけ付ける。Better Auth の表は auth スキーマにあり、
// auth_service のロールで接続する (db/auth-schema.sql、docs/adr/0022)。
const auth =
  process.env.AUTH_DATABASE_URL === undefined
    ? undefined
    : createAuth({
        database: new Pool({
          connectionString: process.env.AUTH_DATABASE_URL,
          options: "-c search_path=auth",
        }),
        baseURL: requireEnv("PUBLIC_ORIGIN"),
        secret: requireEnv("AUTH_SECRET"),
        oidc: {
          discoveryUrl: requireEnv("OIDC_DISCOVERY_URL"),
          clientId: requireEnv("OIDC_CLIENT_ID"),
          clientSecret: requireEnv("OIDC_CLIENT_SECRET"),
        },
      });

const app = createApp(auth === undefined ? {} : { auth });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
