import { defineConfig } from "vite-plus";
import { ownFilesMinimum, recordCoverage } from "../../vitest-coverage.ts";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // __fixtures__/ は lint の検出力を確かめるファイルで、実行するテストではない。
    exclude: ["**/node_modules/**", "**/__fixtures__/**"],
    // テストの強さの基準 (#30、docs/tooling/ci.md ("coverage の下限"))。
    coverage: {
      // src/__fixtures__/start-failure.ts は子プロセスで動く入口で、src/start-or-fail.test.ts が実際の標準出力と終了コードで確かめる。
      ...recordCoverage(),
      thresholds: ownFilesMinimum,
    },
  },
});
