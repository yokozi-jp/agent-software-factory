// ログイン画面への遷移と、ログイン後の戻り先 (docs/adr/0022、Issue #397、#406)。
// 戻り先は URL の search から読むので、利用者が書き換えられる。同一オリジンの相対パスだけを通し、
// ほかは `/` にする (open redirect を作らない)。

const home = "/";

/**
 * 戻り先として使える相対パスを返す。`/` で始まり、2 文字目が `/` や `\` でなく、`\` と制御文字を含まないものだけ通す。
 * ブラウザは `\` を `/` として読むので、`/\evil.example` は `//evil.example` と同じく別のオリジンを指す。
 * 相対パスの形を保つので、`https://…` や `javascript:` は先頭が `/` でないために落ちる。
 */
export function safeRedirect(value: unknown): string {
  if (typeof value !== "string") return home;
  if (!value.startsWith("/") || value.startsWith("//")) return home;
  // oxlint-disable-next-line no-control-regex -- 制御文字 (タブと改行を含む) は URL の解析で取り除かれ、`/\t/evil` が `//evil` になる
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return home;
  return value;
}

/** `/login` の `reason`。画面側が文言を持ち、URL には識別子だけを置く。 */
const loginReasons = ["session-expired", "logged-out"] as const;
export type LoginReason = (typeof loginReasons)[number];

/** 知らない識別子は無かったことにする (URL は利用者が書き換えられる)。 */
export function parseLoginReason(value: unknown): LoginReason | undefined {
  return loginReasons.find((reason) => reason === value);
}

export interface LoginSearch {
  readonly redirect?: string | undefined;
  readonly reason?: LoginReason | undefined;
  /** 認証の失敗の識別子 (Better Auth の `?error=`)。文字は見せず、`selectLoginMessage` が種類を選ぶ。 */
  readonly error?: string | undefined;
}

/** 未ログインの利用者を `/login` に移す search。戻り先が `/` なら省く。 */
export function loginSearchFor(path: string, reason?: LoginReason): LoginSearch {
  const redirect = safeRedirect(path);
  return {
    ...(redirect === home ? {} : { redirect }),
    ...(reason === undefined ? {} : { reason }),
  };
}
