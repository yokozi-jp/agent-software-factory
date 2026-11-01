import { defineConfig } from "vite-plus";
import { recordCoverage } from "../../vitest-coverage.ts";

export default defineConfig({
  test: {
    setupFiles: ["./test/temporal.ts"],
    // コードがプロセスの TZ に頼っていれば、東京とも本番 (UTC) とも違う夏時間のあるタイムゾーンで見つかる。
    // 効いていることは src/time.test.ts が確かめる (Vitest の既定の pool は forks)。
    env: { TZ: "America/New_York" },
    // テストの強さの基準 (#30、docs/tooling/ci.md ("coverage の下限"))。この project の下限はなく、記録だけを出す。
    // 呼ぶ側のテストが通した他の project のファイルも数える。CI が全 project の記録を合わせて、ファイルごとの下限を検査する
    // (coverage-policy.json)。
    coverage: recordCoverage(),
  },
});
