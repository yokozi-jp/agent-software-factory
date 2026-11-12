import type {
  IdempotencyInProgress,
  IdempotencyPayloadMismatch,
  IdempotencyRequest,
  IdempotentResponse,
  NonSuccessResponse,
} from "@agent-software-factory/shared-kernel/idempotency-db";
import type { Database, WriteContext } from "@agent-software-factory/shared-kernel/tenant-db";
import { Context, type Effect } from "effect";

import type { Draft, NewDraft } from "../domain/claim.ts";

/** The key of the request and the request itself: what `withIdempotencyKey` needs to keep one answer per key (docs/adr/0040). */
export interface ClaimIdempotency {
  readonly key: string;
  readonly request: IdempotencyRequest;
}

/**
 * Where the claims are saved (the port that `infrastructure` implements). The methods open the transaction themselves
 * (`inTenantTransaction`) and write the key of the request in it (`withIdempotencyKey`, docs/adr/0040), so the use case
 * holds no `Tx` of the module and the write and the key commit or roll back together. A failure of the database is a defect.
 */
export class ClaimStore extends Context.Service<
  ClaimStore,
  {
    /**
     * Saves `draft` once for the key of `idempotency`. `respond` makes the answer from the saved claim; it is called only
     * when the key is new. A key that was used before returns the answer kept for it, and `draft` is not saved again.
     */
    readonly createDraftOnce: (args: {
      readonly tenantId: string;
      readonly write: WriteContext;
      readonly idempotency: ClaimIdempotency;
      readonly draft: NewDraft;
      readonly respond: (saved: Draft) => IdempotentResponse;
    }) => Effect.Effect<
      IdempotentResponse,
      IdempotencyPayloadMismatch | IdempotencyInProgress | NonSuccessResponse,
      Database
    >;
  }
>()("claim/ClaimStore") {}
