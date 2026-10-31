import { templateUpSql } from "./template-sql.ts";

/**
 * `module` のスキーマに受信の重複除去の表 `processed_message` を作る SQL。migration の雛形
 * (packages/db/templates/processed_message.sql) の `-- migrate:up` の部分を、`{{module}}` を替えて返す。
 */
export const processedMessageTableSql = (module: string): string =>
  templateUpSql("processed_message", module);
