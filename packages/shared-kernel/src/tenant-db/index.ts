// The entry `@agent-software-factory/shared-kernel/tenant-db` (docs/adr/0051). The transaction of a tenant and the helpers of Kysely that write the common columns (docs/adr/0025).
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
