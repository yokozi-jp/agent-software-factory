import { readFileSync } from "node:fs";

/**
 * 雛形 (packages/db/templates/<name>.sql) の `-- migrate:up` の部分を、`{{module}}` を `module` に替えて返す。
 * テストが、まだ表を持たないモジュールに、雛形と同じ表を migrator で作るのに使う。
 */
export function templateUpSql(name: string, module: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(module)) throw new Error(`Invalid module name: ${module}`);
  const template = readFileSync(new URL(`../../templates/${name}.sql`, import.meta.url), "utf8");
  const [, afterUp = ""] = template.split("-- migrate:up");
  const [up = ""] = afterUp.split("-- migrate:down");
  return up.replaceAll("{{module}}", module);
}
