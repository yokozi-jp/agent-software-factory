import { describe, expect, it } from "vite-plus/test";

import { ecsEnvSchema, loadEnv, purgeEnvSchema, workerEnvSchema } from "./env.ts";

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

describe("冪等キーの掃除の環境変数", () => {
  const purge = {
    APP_DATABASE_URL: "postgres://app_user@db/app",
    TENANT_ID: "00000000-0000-4000-8000-00000000000a",
    TX_ID: "exec-1",
  };

  it("テナントと実行名を読み、上限と接続の数は省けること", () => {
    const env = loadEnv(purgeEnvSchema, purge);

    expect(env).toMatchObject({ TENANT_ID: purge.TENANT_ID, TX_ID: "exec-1" });
    expect(env).not.toHaveProperty("PURGE_BATCH_SIZE");
  });

  it("上限は数字だけの 1 以上の文字列を数値で読むこと", () => {
    expect(loadEnv(purgeEnvSchema, { ...purge, PURGE_BATCH_SIZE: "500" })).toMatchObject({
      PURGE_BATCH_SIZE: 500,
    });
    expect(() => loadEnv(purgeEnvSchema, { ...purge, PURGE_BATCH_SIZE: "0" })).toThrow(
      /PURGE_BATCH_SIZE/,
    );
    expect(() => loadEnv(purgeEnvSchema, { ...purge, PURGE_BATCH_SIZE: "" })).toThrow(
      /PURGE_BATCH_SIZE/,
    );
  });

  it("テナントが UUID でない、実行名がないときは例外にすること", () => {
    expect(() => loadEnv(purgeEnvSchema, { ...purge, TENANT_ID: "tenant-a" })).toThrow(/TENANT_ID/);
    expect(() => loadEnv(purgeEnvSchema, { ...purge, TX_ID: undefined })).toThrow(/TX_ID/);
  });
});
