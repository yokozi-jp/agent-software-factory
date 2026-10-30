// The public API of the 申請 (claim) module. Other packages import only this file, by the package name.
// claim imports no other module: modules depend one way, closing → approval → claim (docs/adr/0026).
// The layers are domain/, application/, infrastructure/ and http/. This file wires them together and exports
// what apps/api assembles. The module has no code yet, only the
// type of its database.
export type { ClaimDatabase } from "./infrastructure/database.ts";
export { ClaimTx } from "./infrastructure/transaction.ts";
