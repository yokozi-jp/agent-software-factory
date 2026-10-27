// The public API of the 承認 (approval) module. Other packages import only this file, by the package name.
// approval may import claim, but not closing: modules depend one way, closing → approval → claim
// (docs/adr/0026). The layers are domain/, application/, infrastructure/ and http/. This file wires them
// together and exports what apps/api assembles. The module has no code yet, only the
// type of its database.
export type { ApprovalDatabase } from "./infrastructure/database.ts";
