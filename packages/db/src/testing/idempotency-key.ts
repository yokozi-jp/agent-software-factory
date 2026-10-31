import { templateUpSql } from "./template-sql.ts";

/**
 * `module` のスキーマに冪等キーの表 `idempotency_key` を作る SQL。migration の雛形
 * (packages/db/templates/idempotency_key.sql) の `-- migrate:up` の部分を、`{{module}}` を替えて返す。
 */
export const idempotencyKeyTableSql = (module: string): string =>
  templateUpSql("idempotency_key", module);
