import type { Pool } from "pg";

import { templateUpSql } from "./template-sql.ts";

/**
 * `module` のスキーマに冪等キーの表 `idempotency_key` を作る SQL。migration の雛形
 * (packages/db/templates/idempotency_key.sql) の `-- migrate:up` の部分を、`{{module}}` を替えて返す。
 */
export const idempotencyKeyTableSql = (module: string): string =>
  templateUpSql("idempotency_key", module);

/**
 * `module` に冪等キーの表がなければ、雛形から作る。あれば何もしない。
 * 表を migration に写したモジュール (最初の POST の route を持つモジュール) と、まだ写していないモジュールを、
 * 同じテストが扱うために使う。migration に写したあとに `idempotencyKeyTableSql` を流すと、表がすでにあって失敗する。
 */
export async function ensureIdempotencyKeyTable(
  migrator: Pick<Pool, "query">,
  module: string,
): Promise<void> {
  // 雛形に渡す前に、モジュール名の形を確かめる (`to_regclass` に渡す文字列にも使うため)。
  const sql = idempotencyKeyTableSql(module);
  const { rows } = await migrator.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [`${module}.idempotency_key`],
  );
  if (rows[0]?.exists !== true) await migrator.query(sql);
}
