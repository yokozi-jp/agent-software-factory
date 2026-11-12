import "temporal-polyfill/global";
import type { RequestContext } from "@agent-software-factory/shared-kernel";
import { Database } from "@agent-software-factory/shared-kernel/tenant-db";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { unusedDatabase } from "../../test/unused-database.ts";
import { isClaimId, type Draft, type NewDraft } from "../domain/claim.ts";
import { authorize } from "./authorize.ts";
import { ClaimStore } from "./claim-store.ts";
import { createClaim, draftBody } from "./create-claim.ts";

const context: RequestContext = {
  tenantId: "00000000-0000-4000-8000-00000000000a",
  actor: { userId: "11111111-1111-4111-8111-111111111111" },
  requestId: "request-1",
};
const now = Temporal.Instant.from("2026-11-01T00:00:00Z");
const idempotency = {
  key: "33333333-3333-4333-8333-333333333333",
  request: { method: "POST", path: "/api/claims", query: "", body: "" },
};

describe("申請の許可 (authorize)", () => {
  it("下書きを作る操作に、操作する人を持つ許可の証を返すこと", () => {
    expect(authorize({ actor: context.actor, operation: { _tag: "CreateClaim" } })).toEqual({
      __brand: "Permit",
      operation: "CreateClaim",
      actorId: context.actor.userId,
    });
  });
});

describe("下書きを作る (createClaim)", () => {
  const saved = (draft: NewDraft): Draft => {
    const id = "42";
    if (!isClaimId(id)) throw new Error("the test id is not a claim id");
    return { _tag: "Draft", id, applicantId: draft.applicantId };
  };

  it("申請者を操作する人にした下書きを、リクエストの値を渡して保存し、201 の応答を返すこと", async () => {
    const seen: unknown[] = [];
    const store = ClaimStore.of({
      createDraftOnce: (args) => {
        seen.push({ tenantId: args.tenantId, write: args.write, draft: args.draft });
        return Effect.succeed(args.respond(saved(args.draft)));
      },
    });

    const response = await Effect.runPromise(
      createClaim({ context, now, idempotency }).pipe(
        Effect.provideService(ClaimStore, store),
        Effect.provideService(Database, unusedDatabase),
      ),
    );

    expect(response).toEqual({ status: 201, body: { id: "42", status: "draft" } });
    expect(seen).toEqual([
      {
        tenantId: context.tenantId,
        write: {
          now,
          actor: context.actor.userId,
          pgmCd: "claim.create-claim",
          txId: "request-1",
        },
        draft: { _tag: "NewDraft", applicantId: context.actor.userId },
      },
    ]);
  });

  it("応答の本文が、id と状態 draft だけであること", () => {
    const id = "7";
    if (!isClaimId(id)) throw new Error("the test id is not a claim id");

    expect(draftBody({ _tag: "Draft", id, applicantId: "u" })).toEqual({
      id: "7",
      status: "draft",
    });
  });
});
