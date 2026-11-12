import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";

import type {
  RequestContext,
  RequestContextEnv,
  RequestContextSourceEnv,
  RequestRefusal,
} from "../request-context.ts";
import { requireRequestContext } from "./request-context-http.ts";

const context: RequestContext = {
  tenantId: "tenant-1",
  actor: { userId: "user-1" },
  requestId: "request-1",
};

/** apps/api の middleware が入れる変数を、引数のとおりに入れる app。 */
function appWith(source: RequestContext | undefined, refusal?: RequestRefusal) {
  const app = new Hono<RequestContextEnv & RequestContextSourceEnv>();
  app.use(async (c, next) => {
    if (source !== undefined) c.set("requestContextSource", source);
    if (refusal !== undefined) c.set("requestRefusal", refusal);
    await next();
  });
  app.get("/", requireRequestContext, (c) => c.json(c.get("requestContext")));
  return app;
}

describe("リクエストの文脈の必須化 (requireRequestContext)", () => {
  it("文脈があれば、handler が読む requestContext に入れて渡すこと", async () => {
    const res = await appWith(context).request("/");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(context);
  });

  it("文脈がなく理由が no-tenant なら、403 の no-tenant にすること", async () => {
    const res = await appWith(undefined, "no-tenant").request("/");

    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ type: "/problems/no-tenant", status: 403 });
  });

  it("文脈がなく理由が unauthenticated なら、401 にすること", async () => {
    const res = await appWith(undefined, "unauthenticated").request("/");

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ type: "/problems/unauthenticated", status: 401 });
  });

  it("文脈も理由もなければ (認証なしの app)、401 にすること", async () => {
    const res = await appWith(undefined).request("/");

    expect(res.status).toBe(401);
  });
});
