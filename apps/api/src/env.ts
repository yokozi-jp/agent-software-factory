import { logLevels } from "@agent-software-factory/logging";
import { z } from "zod";

// 環境変数の schema (ADR 0032)。入口 (server.ts) が `process.env` を渡して検査する。
// この schema と loadEnv は `process` を読まない。
// 数値に `z.coerce.number()` を使うと空文字が 0 になるので、PORT のように文字列の形を先に確かめる。
export const envSchema = z.object({
  PORT: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535))
    .default(3000),
  AUTH_DATABASE_URL: z.string().min(1),
  APP_DATABASE_URL: z.string().min(1),
  PUBLIC_ORIGIN: z.url(),
  AUTH_SECRET: z.string().min(1),
  OIDC_DISCOVERY_URL: z.url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  // ログ (docs/adr/0049)。レベルは入口が読んで Logger に渡し、実行中は変えない。ローカルと開発は debug、検証と本番は info。
  LOG_LEVEL: z.enum(logLevels).default("info"),
  // 毎行の service.version と deployment.environment (docs/logging/keys.md)。
  SERVICE_VERSION: z.string().min(1).default("unknown"),
  DEPLOYMENT_ENVIRONMENT: z.string().min(1).default("local"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * 環境変数を検査して、設定を返す。足りない・形が違うときは例外にする (fail closed)。
 * エラーには変数名と理由だけを入れ、値は入れない (秘密をログに出さない)。
 */
export function loadEnv(env: Readonly<Record<string, string | undefined>>): Env {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`環境変数が正しくない:\n${problems}`);
  }
  return result.data;
}

/**
 * ロガーの設定だけを読む。ロガーは環境変数全体の検査 (`loadEnv`) より前に要り、検査の失敗を `fatal` で出すのに使うので、
 * 例外にしない。値が正しくなければ既定にする (レベルは info)。
 */
export function loadLoggerSettings(
  env: Readonly<Record<string, string | undefined>>,
): Pick<Env, "LOG_LEVEL" | "SERVICE_VERSION" | "DEPLOYMENT_ENVIRONMENT"> {
  const shape = envSchema.shape;
  return {
    LOG_LEVEL: shape.LOG_LEVEL.catch("info").parse(env["LOG_LEVEL"]),
    SERVICE_VERSION: shape.SERVICE_VERSION.catch("unknown").parse(env["SERVICE_VERSION"]),
    DEPLOYMENT_ENVIRONMENT: shape.DEPLOYMENT_ENVIRONMENT.catch("local").parse(
      env["DEPLOYMENT_ENVIRONMENT"],
    ),
  };
}
