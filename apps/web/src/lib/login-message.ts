// `/login` に出すメッセージの種類を、URL の識別子から選ぶ (Issue #415、#399 の決定)。
// 識別子は URL に残るので、人事の情報 (社員でない、退職) を載せない。API が `account_unavailable` に 1 つにまとめる。
// 文言は packages/i18n が持ち、種類を選ぶ判断はここに 1 か所だけ置く。

import type { LoginReason } from "./login-redirect.ts";

export type LoginMessageKind =
  | "failed"
  | "accountUnavailable"
  | "temporarilyUnavailable"
  | "sessionExpired"
  | "loggedOut";

/** `error` の識別子のうち、「ログインできなかった」以外の種類に当たるもの。 */
const errorKinds: Readonly<Record<string, LoginMessageKind>> = {
  account_unavailable: "accountUnavailable",
};

/** `reason` (`parseLoginReason` が検査済み) の種類。 */
const reasonKinds = {
  "session-expired": "sessionExpired",
  "logged-out": "loggedOut",
} as const satisfies Record<LoginReason, LoginMessageKind>;

/**
 * `error` (認証の失敗) と `reason` (セッション切れ、ログアウト直後) から種類を選ぶ。
 * `error` があれば先に使い、知らない識別子 (IdP の取り消し、`state_*` など) は「ログインできなかった」にする。
 * どちらもなければ、メッセージは出さない。
 */
export function selectLoginMessage(
  error: string | undefined,
  reason: LoginReason | undefined,
): LoginMessageKind | undefined {
  if (error !== undefined && error !== "") {
    return Object.hasOwn(errorKinds, error) ? errorKinds[error] : "failed";
  }
  return reason === undefined ? undefined : reasonKinds[reason];
}
