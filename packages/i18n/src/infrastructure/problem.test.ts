import { describe, expect, it } from "vite-plus/test";

import { createI18n } from "./i18n.ts";
import { problemMessage } from "./problem.ts";

describe("API のエラーの type から文面を引く (ADR 0035)", () => {
  it.each([
    ["/problems/validation", "入力内容に誤りがあります。内容を確認してください。"],
    ["/problems/unauthenticated", "ログインしていません。ログインしてください。"],
    ["/problems/session-expired", "ログインの有効期限が切れました。もう一度ログインしてください。"],
    ["/problems/forbidden-origin", "この操作は許可されていません。"],
    ["/problems/rate-limited", "操作が多すぎます。しばらくしてからもう一度お試しください。"],
  ])("%s は、その type の文面を返すこと", async (type, expected) => {
    const { t } = await createI18n("ja");
    expect(problemMessage(t, type)).toBe(expected);
  });

  it("言語ごとの文面を返すこと", async () => {
    const { t } = await createI18n("en");
    expect(problemMessage(t, "/problems/session-expired")).toBe(
      "Your session has expired. Please sign in again.",
    );
  });

  it.each(["/problems/expense/not-written-yet", "about:blank", ""])(
    "知らない type %j では、汎用の文面を返すこと",
    async (type) => {
      const { t } = await createI18n("ja");
      expect(problemMessage(t, type)).toBe(
        "エラーが発生しました。時間をおいてもう一度お試しください。",
      );
    },
  );
});
