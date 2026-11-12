import type { RequestContext, RequestRefusal } from "@agent-software-factory/shared-kernel";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { describe, expect, it } from "vite-plus/test";

import { requestContextFromSession } from "./request-context.ts";
import type { SessionVariables } from "./session.ts";

type Session = SessionVariables["session"];

/** Better Auth のセッションの代わり。この middleware が読む部分だけを持つ。 */
function sessionWith(activeOrganizationId: string | null | undefined): Session {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double with only the members the middleware reads
  return {
    user: { id: "user-1" },
    session: { activeOrganizationId },
  } as Session;
}

/** session を入れてから `requestContextFromSession` を通し、入った変数を JSON で返す app。 */
function appWith(session: Session | undefined) {
  const app = new Hono<{
    Variables: SessionVariables & {
      requestContextSource?: RequestContext;
      requestRefusal?: RequestRefusal;
      tenantId?: string;
    };
  }>();
  app.use(requestId());
  app.use(async (c, next) => {
    if (session !== undefined) c.set("session", session);
    await next();
  });
  app.use(requestContextFromSession());
  app.get("/", (c) =>
    c.json({
      source: c.get("requestContextSource"),
      refusal: c.get("requestRefusal"),
      tenantId: c.get("tenantId"),
      requestIdMatches: c.get("requestContextSource")?.requestId === c.get("requestId"),
    }),
  );
  return app;
}

describe("セッションからのリクエストの文脈 (requestContextFromSession)", () => {
  it("active organization があれば、テナントと利用者とリクエストの ID を文脈に入れ、ログ用のテナントも入れること", async () => {
    const res = await appWith(sessionWith("tenant-1")).request("/");

    expect(await res.json()).toMatchObject({
      source: { tenantId: "tenant-1", actor: { userId: "user-1" } },
      tenantId: "tenant-1",
      // リクエストの ID は hono/request-id が決める。文脈のものが、その値と同じであること。
      requestIdMatches: true,
    });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["空文字", ""],
  ])("active organization が %s なら、文脈を入れず no-tenant にすること", async (_name, id) => {
    const body = await (await appWith(sessionWith(id)).request("/")).json();

    expect(body).toMatchObject({ refusal: "no-tenant" });
    expect(body).not.toHaveProperty("source");
  });

  it("セッションが null なら、unauthenticated にすること", async () => {
    const res = await appWith(null).request("/");

    expect(await res.json()).toMatchObject({ refusal: "unauthenticated" });
  });

  it("セッションの変数がなければ (認証なしの app)、unauthenticated にすること", async () => {
    const res = await appWith(undefined).request("/");

    expect(await res.json()).toMatchObject({ refusal: "unauthenticated" });
  });

  it("どの場合も断らず、次の handler を呼ぶこと", async () => {
    expect((await appWith(null).request("/")).status).toBe(200);
  });
});
