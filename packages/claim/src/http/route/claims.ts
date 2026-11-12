import {
  idempotencyFailureResponse,
  idempotencyKeyHeaderSchema,
  idempotencyRequestOf,
  requireIdempotencyKey,
  type IdempotencyEnv,
} from "@agent-software-factory/shared-kernel/idempotency-http";
import {
  commonProblemResponses,
  createRouter,
  idempotencyProblemResponses,
  requireRequestContext,
} from "@agent-software-factory/shared-kernel/problem";
import type { RequestContextEnv } from "@agent-software-factory/shared-kernel";
import { currentInstant } from "@agent-software-factory/shared-kernel/time";
import type { DatabaseRuntime } from "@agent-software-factory/shared-kernel/tenant-db";
import { createRoute, z } from "@hono/zod-openapi";
import { Effect } from "effect";

import { ClaimStore } from "../../application/claim-store.ts";
import { createClaim } from "../../application/create-claim.ts";
import { isClaimId } from "../../domain/claim.ts";

// The routes of the 申請 (claim) module. Each file is a sub-app with the full path in `createRoute`, as the routes of
// apps/api are (docs/adr/0047); `claimRouter` in index.ts gives it its dependencies and apps/api mounts it with `.route()`.

const claimDraftSchema = z.object({
  // `regex` is for the spec (it shows as `pattern`); `isClaimId` is the type predicate of the domain, which also bounds it to 64 bits.
  id: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .refine(isClaimId)
    .describe("The id of the claim, a positive integer in decimal digits."),
  // `x-extensible-enum`, as the `type` of a problem: a state added later is not a breaking change for oasdiff (docs/adr/0035).
  status: z
    .custom<"draft">((value) => value === "draft")
    .openapi({
      type: "string",
      "x-extensible-enum": ["draft"],
      description: "The state of the claim. A new claim is a draft.",
    }),
});

const createClaimRoute = createRoute({
  method: "post",
  path: "/api/claims",
  operationId: "createClaim",
  summary: "Create a draft claim",
  description:
    "Creates a claim in the state draft for the signed-in user, in the active tenant. The tenant and the applicant come from " +
    "the session. Lines are added to the draft by other operations. The same Idempotency-Key returns the answer of the first request.",
  tags: ["claims"],
  middleware: [requireRequestContext, requireIdempotencyKey],
  request: { headers: idempotencyKeyHeaderSchema },
  responses: {
    201: {
      description: "The draft was created (or it is the answer kept for the same Idempotency-Key).",
      content: { "application/json": { schema: claimDraftSchema } },
    },
    // The 400 and 409 of the key replace the common 400 and add the 409 (`idempotencyProblemResponses`).
    400: idempotencyProblemResponses[400],
    401: commonProblemResponses[401],
    403: commonProblemResponses[403],
    409: idempotencyProblemResponses[409],
    415: commonProblemResponses[415],
    500: commonProblemResponses[500],
  },
});

type ClaimsEnv = RequestContextEnv & IdempotencyEnv;

export interface ClaimsRouterDependencies {
  /** The runtime of the entry (docs/adr/0028). The route runs its use case with it. */
  readonly runtime: DatabaseRuntime;
  /** Where the claims are saved: `infrastructure` implements it, and the wiring in index.ts gives it. */
  readonly claimStore: ClaimStore["Service"];
}

/** The sub-app of the routes of this file. The module's `claimRouter` (index.ts) gives it the store and apps/api mounts it. */
export function buildClaimsRouter({ runtime, claimStore }: ClaimsRouterDependencies) {
  return createRouter<ClaimsEnv>().openapi(createClaimRoute, async (c) => {
    const context = c.get("requestContext");
    const request = await idempotencyRequestOf(c);
    const outcome = await runtime.runPromise(
      Effect.gen(function* () {
        // The one moment of this request: read here, once (docs/adr/0043).
        const now = yield* currentInstant;
        return yield* createClaim({
          context,
          now,
          idempotency: { key: c.get("idempotencyKey"), request },
        });
      }).pipe(
        Effect.provideService(ClaimStore, claimStore),
        Effect.map((response) => ({ _tag: "Done", response }) as const),
        Effect.catchTags({
          IdempotencyPayloadMismatch: (failure) =>
            Effect.succeed({ _tag: "Failed", failure } as const),
          IdempotencyInProgress: (failure) => Effect.succeed({ _tag: "Failed", failure } as const),
          // `createClaim` answers 201 only, so this cannot happen; if it does, it is a bug and a 500.
          NonSuccessResponse: Effect.die,
        }),
      ),
    );
    return outcome._tag === "Done"
      ? c.json(claimDraftSchema.parse(outcome.response.body), 201)
      : idempotencyFailureResponse(c, outcome.failure);
  });
}
