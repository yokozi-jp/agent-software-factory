import "temporal-polyfill/global";
import {
  IdempotencyInProgress,
  IdempotencyPayloadMismatch,
  NonSuccessResponse,
} from "@agent-software-factory/shared-kernel/idempotency-db";
import type {
  RequestContext,
  RequestContextSourceEnv,
} from "@agent-software-factory/shared-kernel";
import { Database } from "@agent-software-factory/shared-kernel/tenant-db";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { unusedDatabase } from "../../../test/unused-database.ts";
import { ClaimStore } from "../../application/claim-store.ts";
import { buildClaimsRouter } from "./claims.ts";

// POST /api/claims の HTTP の層だけ (docs/adr/0026)。保存先 (ClaimStore) を差し替えて、失敗の対応表を確かめる。
// DB につないだ本物の経路は apps/api の claims.test.ts が確かめる。
const context: RequestContext = {
  tenantId: "00000000-0000-4000-8000-00000000000a",
  actor: { userId: "11111111-1111-4111-8111-111111111111" },
  requestId: "request-1",
};
const key = '"33333333-3333-4333-8333-333333333333"';

// このテストの runtime が提供するのは Database だけ。ClaimStore を差し替えるので、DB には触れない。
const runtime = ManagedRuntime.make(Layer.succeed(Database, unusedDatabase));

function appWith(createDraftOnce: ClaimStore["Service"]["createDraftOnce"]) {
  const app = new OpenAPIHono<RequestContextSourceEnv>();
  app.use(async (c, next) => {
    c.set("requestContextSource", context);
    await next();
  });
  return app.route(
    "/",
    buildClaimsRouter({ runtime, claimStore: ClaimStore.of({ createDraftOnce }) }),
  );
}

const post = (app: ReturnType<typeof appWith>) =>
  app.request("/api/claims", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
  });

describe("下書きを作る route の HTTP の層 (buildClaimsRouter)", () => {
  it("保存先の応答の本文を 201 で返すこと", async () => {
    const res = await post(
      appWith(() => Effect.succeed({ status: 201, body: { id: "42", status: "draft" } })),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "42", status: "draft" });
  });

  it("保存先に、リクエストの文脈と、冪等キーと、method と path と空の本文を渡すこと", async () => {
    const seen: unknown[] = [];
    const app = appWith((args) => {
      seen.push({
        tenantId: args.tenantId,
        key: args.idempotency.key,
        request: args.idempotency.request,
        write: { actor: args.write.actor, txId: args.write.txId },
      });
      return Effect.succeed({ status: 201, body: { id: "1", status: "draft" } });
    });

    await post(app);

    expect(seen).toEqual([
      {
        tenantId: context.tenantId,
        key: "33333333-3333-4333-8333-333333333333",
        request: { method: "POST", path: "/api/claims", query: "", body: "" },
        write: { actor: context.actor.userId, txId: "request-1" },
      },
    ]);
  });

  it("同じキーで別の要求なら、400 の idempotency-payload-mismatch にすること", async () => {
    const res = await post(appWith(() => Effect.fail(new IdempotencyPayloadMismatch())));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ type: "/problems/idempotency-payload-mismatch" });
  });

  it("最初の要求が終わっていなければ、409 の idempotency-in-progress に Retry-After を付けること", async () => {
    const res = await post(
      appWith(() => Effect.fail(new IdempotencyInProgress({ retryAfterSeconds: 5 }))),
    );

    expect(res.status).toBe(409);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(await res.json()).toMatchObject({ type: "/problems/idempotency-in-progress" });
  });

  it("201 以外の応答が返ってきたら、起きないはずのことなので 500 にすること", async () => {
    const res = await post(
      appWith(() => Effect.fail(new NonSuccessResponse({ response: { status: 422 } }))),
    );

    expect(res.status).toBe(500);
  });
});
