import { MailSender, MailSendFailed } from "@agent-software-factory/approval";
import { createTestDatabase, type TestDatabase } from "@agent-software-factory/db/testing";
import { Effect, Layer } from "effect";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, inject } from "vite-plus/test";

import { createNotificationHandler, type NotificationRuntime } from "../src/notification-worker.ts";
import { createDatabase, createNotificationRuntime } from "../src/runtime.ts";
import { SmtpMailSenderLayer } from "../src/mail/smtp.ts";

export const tenantId = "00000000-0000-4000-8000-00000000000a";

/** 本物の Mailpit に SMTP で送る Layer (テスト用の宛先は newRecipient()、From は固定)。 */
export const mailpitLayer = (): Layer.Layer<MailSender> =>
  SmtpMailSenderLayer({
    host: inject("smtpHost"),
    port: inject("smtpPort"),
    from: "noreply@example.test",
  });

/**
 * 最初の `times` 回の送信を失敗させ、その後は `inner` で送る Layer。SES が落ちたり、SMTP が断ったりした状況の再現で、
 * 送信の失敗だけを差し替える。SES の呼び出しの代わりではない (SES のモックは作らない、docs/adr/0041)。
 */
export const failFirst = (times: number, inner: Layer.Layer<MailSender>): Layer.Layer<MailSender> =>
  Layer.effect(
    MailSender,
    Effect.gen(function* () {
      const real = yield* MailSender;
      let remaining = times;
      return MailSender.of({
        send: (mail) => {
          if (remaining <= 0) return real.send(mail);
          remaining -= 1;
          return Effect.fail(new MailSendFailed({ cause: "injected failure" }));
        },
      });
    }),
  ).pipe(Layer.provide(inner));

/**
 * テストごとに DB を作り、その DB に `app_user` で 1 本だけつなぐ runtime を作る。runtime は、入口が作るものと同じ
 * `createNotificationRuntime` で作る。後始末は afterEach がする。
 */
export function useWorker() {
  let db: TestDatabase | undefined;
  const runtimes: NotificationRuntime[] = [];
  const pools: Kysely<never>[] = [];
  const opened = () => {
    if (db === undefined) throw new Error("The database is not open: use it inside a test.");
    return db;
  };

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
    await Promise.all(pools.splice(0).map((pool) => pool.destroy()));
    await db?.close();
    db = undefined;
  });

  return {
    get db() {
      return opened();
    },
    /** `mail` で送る runtime と、それが使う handler (キューのメッセージ 1 件の処理)。 */
    worker(mail: Layer.Layer<MailSender> = mailpitLayer()) {
      // 入口と同じ作り方: pool は入口 (ここではテスト) が作って閉じ、Layer は包むだけ。
      const pool = createDatabase({ connectionString: opened().url("app_user"), max: 1 });
      const runtime = createNotificationRuntime({ mail, db: pool });
      pools.push(pool);
      runtimes.push(runtime);
      return { runtime, handle: createNotificationHandler(runtime) };
    },
    /** `approval.processed_message` の行の数。 */
    async processedCount(): Promise<number> {
      const { rows } = await opened().superuser.query<{ n: string }>(
        "SELECT count(*) AS n FROM approval.processed_message",
      );
      return Number(rows[0]?.n);
    },
  };
}

/** 通知メールのメッセージ (キューの本文の JSON になる値)。 */
export function notificationMessage(overrides: {
  readonly id?: string;
  readonly tenantId?: string;
  readonly to: string;
  readonly template?: "review_requested" | "sent_back";
  readonly values?: Record<string, string>;
}) {
  const template = overrides.template ?? "review_requested";
  return {
    id: overrides.id ?? crypto.randomUUID(),
    tenantId: overrides.tenantId ?? tenantId,
    kind: "approval.notification_requested",
    version: 1,
    occurredAt: "2026-10-30T01:02:03.000Z",
    to: overrides.to,
    template,
    values:
      overrides.values ??
      (template === "review_requested"
        ? { applicantName: "山田 太郎", claimTitle: "10月の交通費" }
        : { claimTitle: "10月の交通費", reason: "領収書がありません" }),
  };
}

/** `Temporal.Instant` の固定の現在時刻。入口が `Clock` から読む `now` の代わりに、application の関数へ渡す。 */
export const fixedNow = Temporal.Instant.from("2026-10-30T03:04:05.000Z");
