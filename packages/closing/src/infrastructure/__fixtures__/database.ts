// Detection-power fixture (#43) for the module types (docs/adr/0025, docs/adr/0029). The database of closing sees only
// the tables of the closing schema, so a query on a table of claim does not compile. If the generated types start to
// include other schemas, the @ts-expect-error is unused and `vp check` fails. The control that the same query
// compiles in claim is packages/claim/src/infrastructure/__fixtures__/database.ts.
import type { ClosingDatabase } from "../database.ts";

declare const db: ClosingDatabase;

// @ts-expect-error -- fixture: claim.t_claim belongs to claim. Read it through the public functions of claim.
export const otherModuleTable = db.selectFrom("claim.t_claim").selectAll();
