// What a request carries into the `http` layer of a module, and the proof that an operation is allowed. Types only, so `domain`
// can `import type` them (docs/adr/0051, docs/adr/0045). `apps/api` builds the context from the server-side session; the
// module reads it and never the cookie or the header.

/** Who sends the request. Roles are not here yet: the first operation needs none (docs/adr/0045 lists the roles of the later ones). */
export interface RequestActor {
  /** The user id of the session (docs/adr/0022). */
  readonly userId: string;
}

/**
 * The values of one request that every route of a module needs. `tenantId` is the active organization of the session and
 * is never taken from the client (docs/adr/0011, docs/adr/0022). `requestId` is the id of the call for the common columns
 * (`txId`, docs/db/postgresql-keys.md).
 */
export interface RequestContext {
  readonly tenantId: string;
  readonly actor: RequestActor;
  readonly requestId: string;
}

/** Why a request has no context: no valid session (401), or a session without an active tenant (403). */
export type RequestRefusal = "unauthenticated" | "no-tenant";

/**
 * The Hono environment of a route that reads the request context. `requireRequestContext` (the middleware of the route)
 * sets `requestContext` or answers with the refusal, so a handler after it always has the context.
 */
export interface RequestContextEnv {
  Variables: { requestContext: RequestContext };
}

/**
 * What the middleware of `apps/api` sets from the session, for every request of `/api/*`: the context if there is one,
 * and otherwise why not. A route that needs a context declares `requireRequestContext`; one that does not (`/api/me`) ignores both.
 */
export interface RequestContextSourceEnv {
  Variables: { requestContextSource?: RequestContext; requestRefusal?: RequestRefusal };
}

/**
 * The proof that `authorize` allowed an operation (docs/adr/0045): a domain function takes it as an argument, so a call
 * without `authorize` does not type-check. Only the `authorize` of a module makes one.
 */
export interface Permit<Operation extends string> {
  readonly __brand: "Permit";
  readonly operation: Operation;
  /** The user the operation was allowed for. */
  readonly actorId: string;
}
