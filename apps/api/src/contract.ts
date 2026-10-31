// web が Hono RPC の `hc` で API の型を使うための入口 (docs/adr/0047)。型だけを export する。
// web が import するのはここだけで、値を持たないので、API のコードが web の bundle に入らない。
import type { createApp } from "./app.ts";

export type AppType = ReturnType<typeof createApp>;
