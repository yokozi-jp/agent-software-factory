import { handleNotification, MailSender } from "@agent-software-factory/approval";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { mailTo, newRecipient, waitForMail } from "../test/mailpit.ts";
import {
  failFirst,
  fixedNow,
  mailpitLayer,
  notificationMessage,
  tenantId,
  useWorker,
} from "../test/use-worker.ts";

// handleNotification (Issue #366、docs/adr/0041): 本物の PostgreSQL (testcontainers) と Mailpit に対して、重複、再配送、順序の逆転、
// 日時の書き方を確かめる。DB の設定は runtime が作る pool (app_user) で、入口と同じ。
const write = { actor: "notification-worker", pgmCd: "approval.notification", txId: "test-tx" };

describe("通知メールの処理 handleNotification", () => {
  const ctx = useWorker();

  const handle = (runtime: ReturnType<typeof ctx.worker>["runtime"], message: unknown) =>
    runtime.runPromise(handleNotification(message, { now: fixedNow, write }));

  it("同じメッセージを 2 回渡すと、Mailpit に 1 通だけ届き、2 回目は Duplicate を返すこと", async () => {
    const { runtime } = ctx.worker();
    const to = newRecipient();
    const message = notificationMessage({ to });

    const first = await handle(runtime, message);
    const second = await handle(runtime, message);

    expect(first).toEqual({ _tag: "Sent" });
    expect(second).toEqual({ _tag: "Duplicate" });
    expect(await waitForMail(to, 1)).toHaveLength(1);
    expect(await ctx.processedCount()).toBe(1);
  });

  it("1 回目の送信が失敗すると行が残らず、再配送の 2 回目で 1 通届くこと", async () => {
    const { runtime } = ctx.worker(failFirst(1, mailpitLayer()));
    const to = newRecipient();
    const message = notificationMessage({ to });

    await expect(handle(runtime, message)).rejects.toThrow(/\S/);
    expect(await ctx.processedCount()).toBe(0);
    expect(await mailTo(to)).toHaveLength(0);

    expect(await handle(runtime, message)).toEqual({ _tag: "Sent" });
    expect(await waitForMail(to, 1)).toHaveLength(1);
    expect(await ctx.processedCount()).toBe(1);
  });

  it("差戻しの通知を承認依頼より先に処理しても、両方届くこと", async () => {
    const { runtime } = ctx.worker();
    const to = newRecipient();

    await handle(runtime, notificationMessage({ to, template: "sent_back" }));
    await handle(runtime, notificationMessage({ to, template: "review_requested" }));

    const subjects = (await waitForMail(to, 2)).map((mail) => mail.subject).toSorted();
    expect(subjects).toEqual(["【差戻し】10月の交通費", "【承認依頼】10月の交通費"]);
  });

  it("プロセスの TZ が東京でなくても、メールの日時は東京の時刻で書かれること", async () => {
    // vite.config.ts が TZ=America/New_York で流す。ここが東京なら、この確認は何も確かめない。
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/New_York");
    const { runtime } = ctx.worker();
    const to = newRecipient();

    // 発生: 2026-10-30T01:02:03Z = 東京の 10:02。送信: 2026-10-30T03:04:05Z = 東京の 12:04 (ニューヨークは 23:04 と 23:02 の前日)。
    await handle(runtime, notificationMessage({ to }));

    const [mail] = await waitForMail(to, 1);
    expect(mail?.text).toContain("発生日時: 2026/10/30 10:02");
    expect(mail?.text).toContain("送信日時: 2026/10/30 12:04");
  });

  it("承認依頼と差戻しは、同じメッセージの形で、テンプレートだけが違うこと", async () => {
    const { runtime } = ctx.worker();
    const to = newRecipient();

    await handle(runtime, notificationMessage({ to, template: "review_requested" }));
    await handle(runtime, notificationMessage({ to, template: "sent_back" }));

    const mails = await waitForMail(to, 2);
    const bodyOf = (subject: string) => mails.find((mail) => mail.subject.includes(subject))?.text;
    expect(bodyOf("承認依頼")).toContain("山田 太郎 さんから");
    expect(bodyOf("差戻し")).toContain("理由: 領収書がありません");
  });

  it("同じ id でもテナントが違えば別のメッセージとして、それぞれ送ること", async () => {
    const { runtime } = ctx.worker();
    const to = newRecipient();
    const id = crypto.randomUUID();

    await handle(runtime, notificationMessage({ to, id, tenantId }));
    await handle(
      runtime,
      notificationMessage({ to, id, tenantId: "00000000-0000-4000-8000-00000000000b" }),
    );

    expect(await waitForMail(to, 2)).toHaveLength(2);
    expect(await ctx.processedCount()).toBe(2);
  });

  it("メールを送る間、DB のトランザクションを開いたままにしないこと", async () => {
    // 送信の中で PostgreSQL に問い合わせ、トランザクションを開いたまま止まっている接続の数を数える。
    const observed: number[] = [];
    const observing = Layer.effect(
      MailSender,
      Effect.gen(function* () {
        const real = yield* MailSender;
        return MailSender.of({
          send: (mail) =>
            Effect.gen(function* () {
              const { rows } = yield* Effect.promise(() =>
                ctx.db.superuser.query<{ n: string }>(
                  `SELECT count(*) AS n FROM pg_stat_activity
                   WHERE datname = current_database() AND state LIKE 'idle in transaction%'`,
                ),
              );
              observed.push(Number(rows[0]?.n));
              yield* real.send(mail);
            }),
        });
      }),
    ).pipe(Layer.provide(mailpitLayer()));
    const { runtime } = ctx.worker(observing);
    const to = newRecipient();

    await handle(runtime, notificationMessage({ to }));

    expect(observed).toEqual([0]);
  });

  it("テンプレートの値が足りないメッセージは、送らず、行も残さず、失敗として返すこと", async () => {
    const { runtime } = ctx.worker();
    const to = newRecipient();

    await expect(
      handle(
        runtime,
        notificationMessage({ to, template: "sent_back", values: { claimTitle: "x" } }),
      ),
    ).rejects.toThrow(/\S/);

    expect(await mailTo(to)).toHaveLength(0);
    expect(await ctx.processedCount()).toBe(0);
  });

  it("形の合わないメッセージは、送らず、行も残さず、失敗として返すこと", async () => {
    const { runtime } = ctx.worker();
    const to = newRecipient();

    await expect(
      handle(runtime, { ...notificationMessage({ to }), id: "not-a-uuid" }),
    ).rejects.toThrow(/\S/);

    expect(await mailTo(to)).toHaveLength(0);
    expect(await ctx.processedCount()).toBe(0);
  });
});
