// apps/api の route から OpenAPI 3.1 の spec を生成し、apps/api/openapi.json に書く (docs/adr/0047)。
// apps/api のコードは `node:fs` を使わない (docs/adr/0007) ので、ファイルへの書き込みはここに閉じる。
// 実行: `pnpm exec nx openapi api`。CI は実行したあとで差分がないことを確かめる。
import { writeFileSync } from "node:fs";

import { app, openApiDocument } from "../../../../apps/api/src/app.ts";

export const OPENAPI_PATH = new URL("../../../../apps/api/openapi.json", import.meta.url);

export function renderOpenApi(): string {
  return `${JSON.stringify(app.getOpenAPI31Document(openApiDocument), null, 2)}\n`;
}

writeFileSync(OPENAPI_PATH, renderOpenApi());
