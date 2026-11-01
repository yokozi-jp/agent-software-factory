import { defineConfig } from "vite-plus";
import { ownFilesMinimum, recordCoverage } from "../../vitest-coverage.ts";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // __fixtures__/ は lint の検出力を確かめるファイルで、実行するテストではない。
    exclude: ["**/node_modules/**", "**/__fixtures__/**"],
    // テストの強さの基準 (#30、docs/tooling/ci.md ("coverage の下限"))。
    coverage: { ...recordCoverage(), thresholds: ownFilesMinimum },
  },
});
