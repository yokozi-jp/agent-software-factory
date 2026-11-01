import { defineConfig } from "vite-plus";
import { recordCoverage } from "../../vitest-coverage.ts";

export default defineConfig({
  test: {
    // __fixtures__/ は検査の検出力を確かめるファイルで、実行するテストではない (docs/adr/0026)。
    exclude: ["**/node_modules/**", "**/__fixtures__/**"],
    // テストの強さの基準 (#30、docs/tooling/ci.md ("coverage の下限"))。この project の下限はなく、記録だけを出す。
    // 呼ぶ側のテストが通した他の project のファイルも数える。CI が全 project の記録を合わせて、ファイルごとの下限を検査する
    // (coverage-policy.json)。
    coverage: recordCoverage(),
  },
});
