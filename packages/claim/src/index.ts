// The public API of the 申請 (claim) module. Other packages import only this file, by the package name.
// claim imports no other module: modules depend one way, closing → approval → claim (docs/adr/0026).
// The layers are domain/, application/, infrastructure/ and http/. This file wires them together and exports
// what apps/api assembles: `claimRouter`, the routes of the module (docs/adr/0026 "モジュールの route"), and the types of
// its database. The module has one route, POST /api/claims.
import type { DatabaseRuntime } from "@agent-software-factory/shared-kernel/tenant-db";

import { buildClaimsRouter } from "./http/route/claims.ts";
import { claimStore } from "./infrastructure/claim-store.ts";

/**
 * The routes of the module, as a sub-app with the full paths: apps/api mounts it with `.route("/", claimRouter(...))`, which
 * adds the routes to its spec and to `AppType`. The only thing it takes at construction is the runtime of the entry; the
 * tenant, the user, the idempotency key and the time of a request are read by the route (docs/adr/0026).
 */
export function claimRouter(dependencies: { readonly runtime: DatabaseRuntime }) {
  return buildClaimsRouter({ ...dependencies, claimStore });
}

export type { ClaimDatabase } from "./infrastructure/database.ts";
export { ClaimTx } from "./infrastructure/transaction.ts";
