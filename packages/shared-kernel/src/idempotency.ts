import { Data, Effect } from "effect";
import { sql } from "kysely";

import { createdColumns, CurrentWrite } from "./common-columns.ts";
import { dbCall } from "./db-call.ts";
import { insertRow } from "./insert-row.ts";
import type { ModuleTx } from "./tenant-transaction.ts";

// Idempotency-Key (docs/adr/0040): the key goes into the module's own table `idempotency_key`, in the transaction of the
// business write, so the result and the record of the key commit or roll back together.

/** How long a key is kept (docs/adr/0040). The cleanup of expired rows is Issue #325. */
const RETENTION_HOURS = 24;

/** How long the second request waits for the first one on the same key, before it answers 409. */
const LOCK_WAIT_SECONDS = 5;
/** What `Retry-After` says when the wait ran out: the length of the wait. */
export const IDEMPOTENCY_RETRY_AFTER_SECONDS = LOCK_WAIT_SECONDS;

/** What the hash covers: method, path, query string and the body, exactly as they came. */
export interface IdempotencyRequest {
  readonly method: string;
  readonly path: string;
  /** The query string without the `?`, as sent; empty when there is none. */
  readonly query: string;
  /** The body as text (`c.req.text()`), so the handler and the validator can still read it. */
  readonly body: string;
}

/** Who sent the key: the tenant and the user come from the session (docs/adr/0011), the key from the header. */
export interface IdempotencyScope {
  readonly tenantId: string;
  readonly userId: string;
  /** The UUID of the header, already checked (`parseIdempotencyKey`). */
  readonly key: string;
}

/** An answer that the key keeps: the status code and the JSON body (`undefined` or `null` for none). */
export interface IdempotentResponse {
  readonly status: number;
  readonly body?: unknown;
}

/** The key was used before with another method, path, query string or body: 400. */
export class IdempotencyPayloadMismatch extends Data.TaggedError("IdempotencyPayloadMismatch") {}

/** The first request with the key did not finish within the wait: 409 with `Retry-After`. */
export class IdempotencyInProgress extends Data.TaggedError("IdempotencyInProgress")<{
  readonly retryAfterSeconds: number;
}> {}

/**
 * The work answered with something other than 2xx. Only 2xx is kept, so this fails (the transaction rolls back, the
 * row of the key goes too) and carries the answer for the caller to send.
 */
export class NonSuccessResponse extends Data.TaggedError("NonSuccessResponse")<{
  readonly response: IdempotentResponse;
}> {}

const encoder = new TextEncoder();

/**
 * The SHA-256 of the request, in hex: method, path, query string and the bytes of the body. Each part is
 * length-prefixed, so a boundary cannot move from one part to the next. The method is upper-cased (HTTP methods are
 * case-sensitive, but a proxy that changes the case must not change the key's meaning); the rest is taken as it came.
 * The JSON is not normalised.
 */
export async function requestHash(request: IdempotencyRequest): Promise<string> {
  const parts = [request.method.toUpperCase(), request.path, request.query, request.body].map(
    (part) => {
      const bytes = encoder.encode(part);
      return [encoder.encode(`${bytes.length}:`), bytes];
    },
  );
  const pieces = parts.flat();
  const all = new Uint8Array(pieces.reduce((total, piece) => total + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) {
    all.set(piece, offset);
    offset += piece.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", all);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const isLockTimeout = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "55P03";

/**
 * Runs `work` once per `(tenant, user, key)`, in the open transaction of the module `tx` (so call it inside
 * `inTenantTransaction`, from the application layer; docs/adr/0028).
 *
 * 0. A row of the key past its `expires_at` is deleted first, so an expired key can be used again.
 * 1. `INSERT … ON CONFLICT DO NOTHING RETURNING` writes the row of the key. `lock_timeout` is 5 seconds for this
 *    statement only and 0 right after it, so a lock wait of the business writes that follow is not cut and
 *    mistaken for a duplicate. If another transaction holds the same key, the INSERT waits for its end.
 * 2. If the row went in, `work` runs. A 2xx answer is written to the same row and returned; the caller commits.
 *    Another answer fails with `NonSuccessResponse`, and so does `work` itself: the transaction rolls back, the row
 *    with it, and a retry with the same key runs `work` again.
 * 3. If the row was there (the first request committed), the stored hash is compared. A different request fails with
 *    `IdempotencyPayloadMismatch`; the same one returns the stored status and body without calling `work`.
 * 4. If the wait for the first request ran out (`55P03`), it fails with `IdempotencyInProgress`.
 *
 * The body is stored as `jsonb`, so a replay has the same JSON but maybe not the same order of members.
 */
export const withIdempotencyKey = <K extends ModuleTx, E, R>(
  tx: K,
  scope: IdempotencyScope,
  request: IdempotencyRequest,
  work: Effect.Effect<IdempotentResponse, E, R>,
): Effect.Effect<
  IdempotentResponse,
  E | IdempotencyPayloadMismatch | IdempotencyInProgress | NonSuccessResponse,
  K["Identifier"] | CurrentWrite | R
> =>
  Effect.gen(function* () {
    const current = yield* CurrentWrite;
    const executor = yield* tx;
    const table = sql.id(tx.module, "idempotency_key");
    const hash = yield* Effect.promise(() => requestHash(request));

    // A row past `expires_at` that nobody has swept yet (Issue #325) is not a record any more: the key is new again.
    yield* dbCall(tx, (t) =>
      sql`DELETE FROM ${table} WHERE tenant_id = ${scope.tenantId} AND user_id = ${scope.userId}
          AND idempotency_key = ${scope.key} AND expires_at <= ${current.at.toString()}`.execute(t),
    );
    yield* dbCall(tx, (t) =>
      sql`SET LOCAL lock_timeout = ${sql.lit(`${LOCK_WAIT_SECONDS}s`)}`.execute(t),
    );
    // Not `dbCall`: a failure of the database is a defect there, and `55P03` has to become `IdempotencyInProgress`.
    const inserted = yield* Effect.tryPromise({
      try: () =>
        insertRow(
          executor,
          table,
          {
            tenant_id: scope.tenantId,
            user_id: scope.userId,
            idempotency_key: scope.key,
            request_hash: hash,
            expires_at: current.at.add({ hours: RETENTION_HOURS }).toString(),
            ...createdColumns(current),
          },
          sql`ON CONFLICT (tenant_id, user_id, idempotency_key) DO NOTHING RETURNING idempotency_key`,
        ),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        isLockTimeout(error)
          ? Effect.fail(
              new IdempotencyInProgress({ retryAfterSeconds: IDEMPOTENCY_RETRY_AFTER_SECONDS }),
            )
          : Effect.die(error),
      ),
    );
    yield* dbCall(tx, (t) => sql`SET LOCAL lock_timeout = 0`.execute(t));

    if (inserted.rows.length === 0) {
      const found = yield* dbCall(tx, (t) =>
        sql<{
          request_hash: string;
          status_code: number | null;
          response_body: unknown;
        }>`SELECT request_hash, status_code, response_body FROM ${table}
          WHERE tenant_id = ${scope.tenantId} AND user_id = ${scope.userId}
            AND idempotency_key = ${scope.key}`.execute(t),
      );
      const row = found.rows[0];
      // The row conflicted, so it exists; it is committed, because a row of this transaction would have been inserted.
      if (row === undefined || row.status_code === null) {
        return yield* Effect.die(new Error("The row of the idempotency key has no stored answer."));
      }
      if (row.request_hash !== hash) return yield* new IdempotencyPayloadMismatch();
      return { status: row.status_code, body: row.response_body };
    }

    const response = yield* work;
    if (response.status < 200 || response.status > 299) {
      return yield* new NonSuccessResponse({ response });
    }
    const body =
      response.body === undefined || response.body === null ? null : JSON.stringify(response.body);
    yield* dbCall(tx, (t) =>
      sql`UPDATE ${table}
          SET status_code = ${response.status}, response_body = ${body}::jsonb,
              updated_at = ${current.at.toString()}, updated_by = ${current.actor},
              updated_pgm_cd = ${current.pgmCd}, updated_tx_id = ${current.txId}, lock_no = lock_no + 1
          WHERE tenant_id = ${scope.tenantId} AND user_id = ${scope.userId}
            AND idempotency_key = ${scope.key}`.execute(t),
    );
    return response;
  });
