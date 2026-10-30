import { readFileSync } from "node:fs";

const template = readFileSync(
  new URL("../../templates/processed_message.sql", import.meta.url),
  "utf8",
);

/**
 * `module` のスキーマに受信の重複除去の表 `processed_message` を作る SQL。migration の雛形
 * (packages/db/templates/processed_message.sql) の `-- migrate:up` の部分を、`{{module}}` を替えて返す。
 * テストが、まだ表を持たないモジュールに、雛形と同じ表を migrator で作るのに使う。
 */
export function processedMessageTableSql(module: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(module)) throw new Error(`Invalid module name: ${module}`);
  const [, afterUp = ""] = template.split("-- migrate:up");
  const [up = ""] = afterUp.split("-- migrate:down");
  return up.replaceAll("{{module}}", module);
}
