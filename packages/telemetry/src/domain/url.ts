// 実行環境を選ばない入口。モジュールが import してよい OpenTelemetry は @opentelemetry/api だけで、SDK は
// ./node (Node 専用の入口) に閉じる (docs/adr/0048)。

/**
 * URL からクエリ文字列と userinfo とフラグメントを落とし、オリジンとパスだけにする。
 * `url.full` の既定はクエリ文字列を含み、`api_key` や OIDC の `code` のような値が載るので、
 * 受信 (apps/api の app.ts) と外向きの `fetch` (policy.ts) の属性は、これを通す。
 */
export function urlWithoutQuery(url: string, base?: string): string {
  const parsed = new URL(url, base);
  return `${parsed.origin}${parsed.pathname}`;
}
