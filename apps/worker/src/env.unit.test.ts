import { describe, expect, it } from "vite-plus/test";

import { ecsEnvSchema, loadEnv, workerEnvSchema } from "./env.ts";

const base = {
  APP_DATABASE_URL: "postgres://app_user@db/app",
  MAIL_FROM: "noreply@example.com",
};

describe("ワーカーの環境変数", () => {
  it("SES で送る設定を読むこと", () => {
    const env = loadEnv(workerEnvSchema, { ...base, MAIL_TRANSPORT: "ses" });

    expect(env.MAIL_TRANSPORT).toBe("ses");
  });

  it("SMTP で送る設定は、ホストとポートを数値で読むこと", () => {
    const env = loadEnv(workerEnvSchema, {
      ...base,
      MAIL_TRANSPORT: "smtp",
      SMTP_HOST: "localhost",
      SMTP_PORT: "1025",
    });

    expect(env).toMatchObject({ MAIL_TRANSPORT: "smtp", SMTP_HOST: "localhost", SMTP_PORT: 1025 });
  });

  it("ECS のワーカーはキューの URL を要り、endpoint の上書きは省けること", () => {
    const env = loadEnv(ecsEnvSchema, {
      ...base,
      MAIL_TRANSPORT: "ses",
      NOTIFICATION_QUEUE_URL:
        "https://sqs.ap-northeast-1.amazonaws.com/123456789012/notification-mail",
      DATABASE_POOL_MAX: "3",
    });

    expect(env).toMatchObject({ DATABASE_POOL_MAX: 3 });
    expect(env).not.toHaveProperty("SQS_ENDPOINT");
  });

  it("送り方がないか、SMTP のホストがなければ、変数名だけを書いた例外にすること", () => {
    expect(() => loadEnv(workerEnvSchema, base)).toThrow(/MAIL_TRANSPORT/);
    expect(() => loadEnv(workerEnvSchema, { ...base, MAIL_TRANSPORT: "smtp" })).toThrow(
      /SMTP_HOST/,
    );
  });

  it("エラーには変数名だけを書き、無効だった値は入れないこと", () => {
    const invalid = "hidden-value-not-an-address";
    const load = () =>
      loadEnv(workerEnvSchema, { ...base, MAIL_FROM: invalid, MAIL_TRANSPORT: "ses" });

    expect(load).toThrow(/MAIL_FROM/);
    expect(load).not.toThrow(/hidden-value/);
  });
});
