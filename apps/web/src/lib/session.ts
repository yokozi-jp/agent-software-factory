// セッションの有無を API (`GET /api/me`) で確かめる (docs/adr/0022)。route の guard は UI の都合で、
// データの認可の境界は API にある。

import type { createApiClient } from "./api-client.ts";

/** ログイン済みの利用者。`roles` は画面の出し分けに使う (経理は "accounting")。認可の正は API。 */
export interface SignedInUser {
  readonly name: string;
  readonly roles: readonly string[];
}

export type SessionState = SignedInUser | "unauthenticated";

/** 経理の役割。`GET /api/me` の `roles` に入る。 */
export const accountingRole = "accounting";

/** 200 はログイン済み、401 は未ログイン。ほかの応答は判断できないので投げる (未ログインとして扱わない)。 */
export async function fetchSession(
  client: ReturnType<typeof createApiClient>,
): Promise<SessionState> {
  const response = await client.api.me.$get();
  if (response.status === 200) {
    const { name, roles } = await response.json();
    return { name, roles };
  }
  // 型は 200 と 401 だけだが、実行時はほかの status も来る。広げた型で比べて、契約の外の応答は投げる。
  const status: number = response.status;
  if (status === 401) return "unauthenticated";
  throw new Error(`GET /api/me returned ${status}`);
}

/**
 * 操作の途中の API 呼び出し。どの API でも 401 なら `onUnauthorized` を呼ぶ (セッション切れ)。
 * 応答はそのまま返すので、呼び出し側は 401 の後始末を気にしなくてよい。
 */
export function withSessionExpiry(
  fetchApi: typeof fetch,
  onUnauthorized: () => void,
): typeof fetch {
  return async (input, init) => {
    const response = await fetchApi(input, init);
    if (response.status === 401) onUnauthorized();
    return response;
  };
}

/** route の `beforeLoad` が使う、実行環境ごとの部品。本物は main.tsx が、story は mock を渡す。 */
export interface AppContext {
  /** 業務の API を呼ぶ fetch。401 (セッション切れ) なら `/login` に移す。 */
  readonly apiFetch: typeof fetch;
  getSession(): Promise<SessionState>;
  /** IdP のログインを始める。ログインしたら `callbackURL` (検証済みの相対パス) に戻る。 */
  signIn(callbackURL: string): Promise<void>;
  /**
   * ログアウトして、IdP のログアウト画面か `/login` に移る (確認はしない)。移り先へはページごと遷移するので、
   * 戻る操作で保護された画面が見えないよう、Cookie と HTTP cache はサーバーが `Clear-Site-Data` で捨てる。
   */
  signOut(): Promise<void>;
}
