import { describe, expect, it } from "vite-plus/test";

import type { WorkerEnv } from "./env.ts";
import { createWorker, mailLayer } from "./runtime.ts";

const common = {
  APP_DATABASE_URL: "postgres://app_user@127.0.0.1:1/none",
  MAIL_FROM: "noreply@example.com",
};
const smtp: WorkerEnv = {
  ...common,
  MAIL_TRANSPORT: "smtp",
  SMTP_HOST: "localhost",
  SMTP_PORT: 1025,
};

describe("メールの Layer の選び方", () => {
  it("SES と SMTP のどちらの設定でも、Layer を作れること (送信はしない)", () => {
    expect(mailLayer({ ...common, MAIL_TRANSPORT: "ses" })).toBeDefined();
    expect(mailLayer(smtp)).toBeDefined();
  });
});

describe("ワーカーの組み立て", () => {
  it("handler と停止を返し、停止で runtime と pool を閉じること", async () => {
    const worker = createWorker({ ...smtp, DATABASE_POOL_MAX: 1 });

    expect(typeof worker.handle).toBe("function");
    await expect(worker.close()).resolves.toBeUndefined();
  });
});
