import { readFileSync } from "node:fs";

/** ロールを作る SQL。本番の入口 `migrate` と同じファイルを、master user で流す (docs/adr/0025)。 */
export const bootstrapSql = readFileSync(new URL("../db/bootstrap.sql", import.meta.url), "utf8");
