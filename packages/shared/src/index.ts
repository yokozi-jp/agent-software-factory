// The public API of shared: code that the modules of the sample feature share, such as types. shared imports no
// module (docs/adr/0026). Other packages import only this file, by the package name.
export { fromResult } from "./from-result.ts";
export type { Result } from "./result.ts";
export {
  beginTenantTransaction,
  Database,
  inTenantTransaction,
  type ModuleName,
  type ModuleTx,
  type TenantScope,
} from "./tenant-transaction.ts";
export { dbCall, dbCallUnique, UniqueViolation } from "./db-call.ts";
export {
  createdColumns,
  CurrentWrite,
  patchedColumns,
  updatedColumns,
  type WriteActor,
  type WriteContext,
} from "./common-columns.ts";
export { OptimisticLockConflict, RowNotFound, updateWithLock } from "./optimistic-lock.ts";
export { apiDate, apiInstant } from "./api-time.ts";
export { BUSINESS_TIME_ZONE, currentInstant, toApiDate, toApiInstant } from "./time.ts";
export { defineEvent, eventFixtureProblems, type EventDefinition } from "./event.ts";
