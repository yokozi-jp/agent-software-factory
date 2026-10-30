// API を Hono RPC の `hc` で呼ぶクライアント (docs/adr/0047)。
// apps/web が apps/api の型を import してよいのはここだけで、`import type` に限る (vite.config.ts の no-restricted-imports)。
// API の route の入力や応答を変えると、このクライアントを使う web のコードの型検査が落ちる。
import type { AppType } from "@agent-software-factory/api";
import { hc } from "hono/client";

// web と API は同じオリジンで配信するので、基準の URL には現在のオリジン (`location.origin`) を渡す (docs/adr/0022)。
export function createApiClient(baseUrl: string, fetchApi: typeof fetch) {
  return hc<AppType>(baseUrl, { fetch: fetchApi });
}
