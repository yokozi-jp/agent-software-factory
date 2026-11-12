import type { RequestContextEnv, RequestContextSourceEnv } from "../request-context.ts";
import type { MiddlewareHandler } from "hono";

import { commonProblemTypes, problemResponse, statusTitle } from "./problem.ts";

/**
 * The middleware of every route that works on the data of a tenant. `apps/api` reads the session once for `/api/*` and
 * sets `requestContextSource`, or `requestRefusal` when there is no context. This turns the first into `requestContext`
 * for the handler, and the second into the answer: 401 without a valid session, 403 for a session without an active
 * tenant. The tenant comes from the session only, never from the client (docs/adr/0011, docs/adr/0022).
 */
export const requireRequestContext: MiddlewareHandler<
  RequestContextEnv & RequestContextSourceEnv
> = async (c, next) => {
  const source = c.get("requestContextSource");
  if (source === undefined) {
    return c.get("requestRefusal") === "no-tenant"
      ? problemResponse(c, {
          type: commonProblemTypes.noTenant,
          title: statusTitle(403),
          status: 403,
          detail: "The user has no active tenant.",
        })
      : problemResponse(c, {
          type: commonProblemTypes.unauthenticated,
          title: "Authentication is required.",
          status: 401,
        });
  }
  c.set("requestContext", source);
  return next();
};
