import { defineConfig } from "vite-plus";

// テストの project は 2 つ。integration は src/ のテストで、人事システムのフェイク (WireMock) のコンテナを全テストで共有して一度だけ起動する。
// unit (`*.unit.test.ts`) は起動しない。スタブの本文が OpenAPI に合うかを見るだけのテストは unit にする。
// コンテナが起動しない環境でも、`vp test run --project unit` で動く。
export default defineConfig({
  test: {
    environment: "node",
    // テストの強さの基準 (#30、docs/tooling/ci.md ("coverage の下限"))。
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // schema.gen.ts は openapi.yaml から作る型だけのファイル。
      exclude: ["src/**/*.test.ts", "src/schema.gen.ts"],
      thresholds: { perFile: { lines: 90, branches: 90 } },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.test.ts"],
          exclude: ["**/node_modules/**", "src/**/*.unit.test.ts"],
          globalSetup: ["./test/global-setup.ts"],
          // コンテナの起動 (イメージの取得を含む) を待つ。testcontainers の待ちの上限 (既定 60 秒) より長くする。
          hookTimeout: 180_000,
          // タイムアウトの試験は、試行ごとの 2 秒と全体の 5 秒を使い切る。
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.unit.test.ts"],
        },
      },
    ],
  },
});
