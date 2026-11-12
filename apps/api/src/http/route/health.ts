import { createRoute, z } from "@hono/zod-openapi";

import { createRouter } from "./router.ts";

// route は createRoute で書く。ここから OpenAPI 3.1 の spec (apps/api/openapi.json) を生成し、web が hc で同じ型を使う
// (docs/adr/0047)。応答のステータスは route に明示する。完全な path を `path` に書く: path で検索すると、route のファイルが見つかる。
const healthRoute = createRoute({
  method: "get",
  path: "/health",
  operationId: "getHealth",
  summary: "Health check",
  description: "Reports that the API process is running. It does not check the database.",
  tags: ["health"],
  responses: {
    200: {
      description: "The API is running.",
      content: { "application/json": { schema: z.object({ status: z.literal("ok") }) } },
    },
  },
});

export function healthRouter() {
  return createRouter().openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));
}
