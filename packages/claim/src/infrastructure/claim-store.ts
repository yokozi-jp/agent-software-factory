import {
  withIdempotencyKey,
  type IdempotentResponse,
} from "@agent-software-factory/shared-kernel/idempotency-db";
import {
  createdColumns,
  CurrentWrite,
  dbCall,
  inTenantTransaction,
} from "@agent-software-factory/shared-kernel/tenant-db";
import { Effect } from "effect";

import { ClaimStore } from "../application/claim-store.ts";
import { isClaimId, type Draft, type NewDraft } from "../domain/claim.ts";
import { ClaimTx } from "./transaction.ts";

/**
 * The code of each state in `status_typ` of `claim.t_claim` (docs/db/postgresql-naming-value-domain.md: a serial code).
 * This is the one place that defines them; the database has no CHECK constraint (docs/db/postgresql-constraints.md).
 */
const statusCodes = { Draft: "00" } as const;

/** A row of `claim.t_claim` that was just written, as a `Draft`. A row that is not one is broken data, so this throws (a 500). */
export function parseDraft(row: { readonly claim_id: string }, draft: NewDraft): Draft {
  if (!isClaimId(row.claim_id)) throw new Error(`claim_id is not a claim id: ${row.claim_id}`);
  return { _tag: "Draft", id: row.claim_id, applicantId: draft.applicantId };
}

/** Writes a draft in the open transaction of the claim module, with the common columns of this call (`CurrentWrite`). */
const insertDraft = (tenantId: string, draft: NewDraft) =>
  Effect.gen(function* () {
    const write = yield* CurrentWrite;
    const row = yield* dbCall(ClaimTx, (trx) =>
      trx
        .insertInto("claim.t_claim")
        .values({
          tenant_id: tenantId,
          applicant_id: draft.applicantId,
          status_typ: statusCodes.Draft,
          ...createdColumns(write),
        })
        .returning("claim_id")
        .executeTakeFirstOrThrow(),
    );
    return parseDraft(row, draft);
  });

/**
 * `ClaimStore` on `claim.t_claim`. One transaction of the claim module with the tenant set, in which the key of the request
 * and the draft are written together (docs/adr/0040). It needs no layer: it takes the pool from `Database` when it runs,
 * so the entry gives it to the route as a value (the claim module's `claimRouter`).
 */
export const claimStore: ClaimStore["Service"] = ClaimStore.of({
  createDraftOnce: ({ tenantId, write, idempotency, draft, respond }) =>
    inTenantTransaction(
      ClaimTx,
      { tenantId, ...write },
      withIdempotencyKey(
        ClaimTx,
        { tenantId, userId: write.actor, key: idempotency.key },
        idempotency.request,
        insertDraft(tenantId, draft).pipe(
          Effect.map((saved): IdempotentResponse => respond(saved)),
        ),
      ),
    ),
});
