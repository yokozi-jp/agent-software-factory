import { validationProblemSchema } from "@agent-software-factory/shared-kernel/problem";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { describe, expect, it } from "vite-plus/test";

import { validationHook } from "./validation-hook.ts";

const route = createRoute({
  method: "get",
  path: "/items/{id}",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ limit: z.coerce.number().int().min(1) }),
  },
  responses: {
    200: { description: "ok", content: { "application/json": { schema: z.object({}) } } },
  },
});

const app = new OpenAPIHono({ defaultHook: validationHook }).openapi(route, (c) => c.json({}, 200));

describe("検証エラーの応答 (defaultHook)", () => {
  it("Problem Details の 400 を、pointer と code つきで返すこと", async () => {
    const res = await app.request("/items/a?limit=0");

    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await res.json()).toEqual({
      type: "/problems/validation",
      title: "Request validation failed.",
      status: 400,
      errors: [{ pointer: "/limit", code: "too_small" }],
    });
  });

  it("結果を validationProblemSchema で parse できること", async () => {
    const res = await app.request("/items/a?limit=0");

    expect(validationProblemSchema.parse(await res.json()).errors).toHaveLength(1);
  });

  it("入力が正しければ route の handler に渡すこと", async () => {
    const res = await app.request("/items/a?limit=1");

    expect(res.status).toBe(200);
  });
});
