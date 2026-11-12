import type { RequestContext } from "@agent-software-factory/shared-kernel";
import { Effect } from "effect";

import { createDraft, type Draft } from "../domain/claim.ts";
import { authorize } from "./authorize.ts";
import { ClaimStore, type ClaimIdempotency } from "./claim-store.ts";

/** What the API says about a saved draft: the body of the 201, and of the replay of it. */
export const draftBody = (draft: Draft) => ({ id: draft.id, status: "draft" }) as const;

/** The program code of the common columns (`*_pgm_cd`, docs/db/postgresql-keys.md). */
const PGM_CD = "claim.create-claim";

/**
 * Makes a draft claim for the user of the request: allowed by `authorize`, made by `createDraft` from the permit, and saved
 * once per `Idempotency-Key`. The entry (the route) reads the request and the clock once and passes them in; this does
 * not read either (docs/domain-model/application-effect.md). The answer is 201 with the id of the draft.
 */
export const createClaim = Effect.fn("createClaim")(function* (args: {
  readonly context: RequestContext;
  readonly now: Temporal.Instant;
  readonly idempotency: ClaimIdempotency;
}) {
  const store = yield* ClaimStore;
  const permit = authorize({ actor: args.context.actor, operation: { _tag: "CreateClaim" } });
  const draft = createDraft({ permit });
  return yield* store.createDraftOnce({
    tenantId: args.context.tenantId,
    write: {
      now: args.now,
      actor: args.context.actor.userId,
      pgmCd: PGM_CD,
      txId: args.context.requestId,
    },
    idempotency: args.idempotency,
    draft,
    respond: (saved) => ({ status: 201, body: draftBody(saved) }),
  });
});
