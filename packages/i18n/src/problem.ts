import type { TFunction } from "i18next";

/**
 * API のエラー応答 (Problem Details、docs/adr/0035) の `type` から、利用者向けの文面を引く。
 * 識別子は `type` だけで、文面は web が持つ。知らない `type` (about:blank、後から足された `type`) は汎用の文面にする。
 * キーは `t("…")` に書き下す。キーを組み立てると、`i18next-cli` が未使用のキーとして報告する。
 */
export function problemMessage(t: TFunction, type: string): string {
  switch (type) {
    case "/problems/validation":
      return t("problem.validation");
    case "/problems/unauthenticated":
      return t("problem.unauthenticated");
    case "/problems/session-expired":
      return t("problem.sessionExpired");
    case "/problems/forbidden-origin":
      return t("problem.forbiddenOrigin");
    case "/problems/rate-limited":
      return t("problem.rateLimited");
    default:
      return t("problem.generic");
  }
}
