import { z } from "zod";

// 環境変数の schema (ADR 0032)。入口 (server.ts、lambda.ts) が `process.env` を渡して検査する。この schema と loadEnv は
// `process` を読まない。ECS のワーカーと Lambda のワーカーは同じ設定で、ECS のワーカーだけがキューの URL を持つ。
// 数値に `z.coerce.number()` を使うと空文字が 0 になるので、数字だけの文字列かを先に確かめる。
const digits = z.string().regex(/^\d+$/).transform(Number);
const port = digits.pipe(z.number().int().min(1).max(65535));

const baseSettings = z.object({
  /** 業務の処理は app_user で接続する。RLS を迂回しない (docs/adr/0011)。 */
  APP_DATABASE_URL: z.string().min(1),
  /** 接続の pool の上限。Lambda のワーカーは 1 にする (docs/adr/0013)。 */
  DATABASE_POOL_MAX: digits.pipe(z.number().int().min(1)).optional(),
  /** メールの From。SES は検証済みのドメインか、アドレスだけを許す。 */
  MAIL_FROM: z.email(),
});

// メールの送り方。本番は SES。ローカルと CI は Mailpit に SMTP で送る。SES のモックは作らない (docs/adr/0041)。
const mailTransport = z.discriminatedUnion("MAIL_TRANSPORT", [
  z.object({ MAIL_TRANSPORT: z.literal("ses") }),
  z.object({
    MAIL_TRANSPORT: z.literal("smtp"),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: port,
  }),
]);

const queueSettings = z.object({
  NOTIFICATION_QUEUE_URL: z.url(),
  /** ElasticMQ など、SQS の代わりの endpoint。本番では設定しない。 */
  SQS_ENDPOINT: z.url().optional(),
});

export const workerEnvSchema = z.intersection(baseSettings, mailTransport);
export const ecsEnvSchema = z.intersection(workerEnvSchema, queueSettings);

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/**
 * 環境変数を検査して、設定を返す。足りない・形が違うときは例外にする (fail closed)。
 * エラーには変数名と理由だけを入れ、値は入れない (秘密をログに出さない)。
 */
export function loadEnv<S extends z.ZodType>(
  schema: S,
  env: Readonly<Record<string, string | undefined>>,
): z.output<S> {
  const parsed = schema.safeParse(env);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(["環境変数が正しくない:", ...lines].join("\n"));
}

// 期限切れの冪等キーを消すバッチの環境変数 (Issue #325)。Step Functions の RunTask が、タスク定義の環境変数の上書きで渡す
// (docs/adr/0042 と同じ形)。メールとキューは使わないので、ワーカーの schema とは別にする。
export const purgeEnvSchema = z.object({
  /** 業務の処理は app_user で接続する。RLS を迂回しない (docs/adr/0011)。 */
  APP_DATABASE_URL: z.string().min(1),
  /** 接続は 1 本で足りる。トランザクションを順に開くだけ。 */
  DATABASE_POOL_MAX: digits.pipe(z.number().int().min(1)).optional(),
  /** 掃除するテナント。Map の 1 回の実行が 1 つのテナントを受け持つ。 */
  TENANT_ID: z.uuid(),
  /** Step Functions の実行名。共通カラムの tx_id に入る。 */
  TX_ID: z.string().min(1).max(64),
  /** 1 つのトランザクションで消す件数の上限。省くと shared-kernel の既定 (1000)。 */
  PURGE_BATCH_SIZE: digits.pipe(z.number().int().min(1)).optional(),
});
