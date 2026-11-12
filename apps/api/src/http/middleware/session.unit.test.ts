import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";

import { requireSession, type SessionVariables } from "./session.ts";

describe("セッションの必須化 (requireSession)", () => {
  const app = new Hono<{ Variables: SessionVariables }>();
  app.use(async (c, next) => {
    c.set("session", null);
    await next();
  });
  app.get("/private", requireSession(), (c) => c.text("secret"));

  it("セッションがなければ unauthenticated の Problem Details で 401 を返すこと", async () => {
    const res = await app.request("/private");

    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ type: "/problems/unauthenticated", status: 401 });
  });
});
