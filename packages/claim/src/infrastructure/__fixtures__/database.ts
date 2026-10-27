// Control for the detection-power fixtures of the module types (#43, docs/adr/0025): the database of claim sees the
// tables of the claim schema. approval and closing have the fixtures that must not compile
// (packages/{approval,closing}/src/infrastructure/__fixtures__/database.ts). If this stops compiling, the types
// no longer name the tables with their schema, and those fixtures would fail for the wrong reason.
import type { ClaimDatabase } from "../database.ts";

declare const db: ClaimDatabase;

export const ownTable = db.selectFrom("claim.t_claim").select(["tenant_id", "claim_id"]);
