import { recordOnlyConfig } from "../../vitest-coverage.ts";

// この package のコードは `src/index.ts` の `export {}` だけで、あとは lint の検出力を確かめる fixture (`__fixtures__/`、テストの対象外)。
// 下限はなく、記録だけを出す (vitest-coverage.ts、docs/adr/0053)。
export default recordOnlyConfig();
