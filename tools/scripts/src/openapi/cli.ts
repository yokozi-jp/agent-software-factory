// apps/api の route から OpenAPI 3.1 の spec を生成し、apps/api/openapi.json に書く (docs/adr/0047)。
// apps/api のコードは `node:fs` を使わない (docs/adr/0007) ので、ファイルへの書き込みはここに閉じる。
// 実行: `pnpm exec nx openapi api`。apps/api の script が `--import ./test/temporal.ts` で Temporal の polyfill を入れてから
// 起動する (Node.js 24 に Temporal がなく、apps/api のコードが import 時に必要とする。tools/scripts は polyfill を持たない)。
// 書き直すのを忘れたときは、apps/api/src/openapi.unit.test.ts が `api:test` で落ちる。
import { writeFileSync } from "node:fs";

import { generateOpenApi } from "../../../../apps/api/src/openapi.ts";

const openApiPath = new URL("../../../../apps/api/openapi.json", import.meta.url);

writeFileSync(openApiPath, `${JSON.stringify(generateOpenApi(), null, 2)}\n`);
