import { Context } from "effect";
import type { Transaction } from "kysely";

import type { DB } from "./db.gen.ts";

/**
 * The open transaction of the claim module, with the types of its own tables only (docs/adr/0025). `inTenantTransaction`
 * of @agent-software-factory/shared-kernel provides it and runs `SET LOCAL ROLE claim_module` (`module`). A repository
 * requires it, so it does not run outside a transaction, and inside a transaction of another module it does not
 * type-check (docs/adr/0028, docs/adr/0029).
 */
export class ClaimTx extends Context.Service<ClaimTx, Transaction<DB>>()("claim/Tx") {
  static readonly module = "claim" as const;
}
