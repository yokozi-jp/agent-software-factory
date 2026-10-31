import { z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";

import type { IdempotencyInProgress, IdempotencyPayloadMismatch } from "./idempotency.ts";
import { commonProblemTypes, problemResponse, statusTitle } from "./problem.ts";

// The HTTP side of Idempotency-Key (docs/adr/0040): the header is checked in the Hono layer, before anything runs.

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/**
 * The header is a Structured Field String (RFC 9651 3.3.3): the UUID in double quotes, `"<UUID>"`. The value is limited
 * to a UUID, and the only escapes of a String (`\"` and `\\`) are not UUID characters, so this pattern accepts exactly
 * the Strings whose value is a UUID, and no parser library is needed. Parameters (`;a=1`) are not accepted.
 */
const quotedUuid = /^"([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"$/i;

export type ParsedIdempotencyKey =
  | { readonly _tag: "Valid"; readonly key: string }
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Malformed" };

/** Reads the header value. The UUID is returned in lower case, so one key has one spelling. */
export function parseIdempotencyKey(value: string | null | undefined): ParsedIdempotencyKey {
  if (value === null || value === undefined) return { _tag: "Missing" };
  const match = quotedUuid.exec(value);
  return match?.[1] === undefined
    ? { _tag: "Malformed" }
    : { _tag: "Valid", key: match[1].toLowerCase() };
}

/**
 * The header for the contract (`request.headers` of `createRoute`): it documents the header and its format in the
 * OpenAPI. The value is checked by `requireIdempotencyKey` first, which answers with the `type` of the problem.
 */
export const idempotencyKeyHeaderSchema = z.object({
  [IDEMPOTENCY_KEY_HEADER]: z.string().openapi({
    description: 'A UUID in double quotes, new for each user operation: `"<UUID>"`.',
    example: '"9f1c1f6e-2f0e-4c3a-9c53-2a5c3e0d6b11"',
  }),
});

/** The Hono variables that `requireIdempotencyKey` sets. */
export interface IdempotencyEnv {
  Variables: { idempotencyKey: string };
}

/**
 * The middleware of every POST and PATCH route (not `/api/auth/*`). It answers 400 with the `type` for a missing or
 * malformed header, and otherwise sets the key as `c.var.idempotencyKey` for the handler to pass to
 * `withIdempotencyKey`.
 */
export const requireIdempotencyKey: MiddlewareHandler<IdempotencyEnv> = async (c, next) => {
  const parsed = parseIdempotencyKey(c.req.header(IDEMPOTENCY_KEY_HEADER));
  if (parsed._tag === "Missing") {
    return problemResponse(c, {
      type: commonProblemTypes.idempotencyKeyMissing,
      title: statusTitle(400),
      status: 400,
      detail: "The Idempotency-Key header is required.",
    });
  }
  if (parsed._tag === "Malformed") {
    return problemResponse(c, {
      type: commonProblemTypes.idempotencyKeyMalformed,
      title: statusTitle(400),
      status: 400,
      detail: 'The Idempotency-Key header must be a UUID in double quotes: "<UUID>".',
    });
  }
  c.set("idempotencyKey", parsed.key);
  return next();
};

/** The 400 for a key used before with another request. */
export function idempotencyPayloadMismatchResponse(
  c: Context,
  _failure: IdempotencyPayloadMismatch,
) {
  return problemResponse(c, {
    type: commonProblemTypes.idempotencyPayloadMismatch,
    title: statusTitle(400),
    status: 400,
    detail: "The Idempotency-Key was used with a different request.",
  });
}

/** The 409 for a key whose first request is still running, with `Retry-After`. */
export function idempotencyInProgressResponse(c: Context, failure: IdempotencyInProgress) {
  c.header("Retry-After", String(failure.retryAfterSeconds));
  return problemResponse(c, {
    type: commonProblemTypes.idempotencyInProgress,
    title: statusTitle(409),
    status: 409,
    detail: "A request with the same Idempotency-Key is still being processed.",
  });
}
