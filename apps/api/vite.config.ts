import devServer from "@hono/vite-dev-server";
import { defineConfig } from "vite-plus";

// テストの project は 2 つ。integration は src/ のテストで、PostgreSQL と Keycloak のコンテナを、全テストで共有して
// 一度だけ起動する。unit (`*.unit.test.ts`) はコンテナを起動しない。入力を渡して結果を見るだけのテストは unit にする。
// コンテナが起動しない環境でも、`vp test run --project unit` で動く (vitest は global setup の失敗を
// `code.charCodeAt is not a function` で隠すので、integration が起動で落ちた原因はコンテナを疑う)。
// Oxlint の自作 plugin の規則のテストは tools/lint-plugins にある (docs/adr/0030)。
export default defineConfig({
  plugins: [devServer({ entry: "./src/index.ts" })],
  server: { port: 3000 },
  build: {
    // Node server bundle. Dependencies stay external and are resolved from node_modules at runtime.
    ssr: "src/server.ts",
    target: "node24",
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.unit.test.ts"],
          exclude: ["**/node_modules/**", "**/__fixtures__/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.test.ts"],
          // __fixtures__/ は lint の検出力を確かめるファイルで、実行するテストではない (docs/adr/0026)。
          exclude: ["**/node_modules/**", "**/__fixtures__/**", "src/**/*.unit.test.ts"],
          // Keycloak の起動に時間がかかる。
          globalSetup: ["./test/global-setup.ts"],
          hookTimeout: 240_000,
          testTimeout: 60_000,
        },
      },
    ],
    // テストの強さの基準 (#30、docs/tooling/ci.md ("coverage の下限"))。下限を割ったら、そのファイルのテストを足す。
    coverage: {
      provider: "v8",
      // テストのない新しいファイルも数え、ファイルごとの下限で止める。
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        // lint の検出力を確かめる fixture (docs/adr/0007、0026)。わざと規則に違反する文を持ち、どこからも import されない。
        "src/__fixtures__/**",
        // 実行環境ごとの入口。環境変数を読んで起動するだけで、テストは src/app.ts の createApp を通す。
        "src/server.ts",
        // vp dev (@hono/vite-dev-server) の入口。src/app.ts の app を export するだけ。
        "src/index.ts",
      ],
      thresholds: {
        // ファイルごとの固定の下限。
        perFile: { lines: 90, branches: 90 },
        // 全体の値は上がる方向にだけ動く。上回った実行が、切り捨てた新しい値をここに書く。書き換わったら commit する。
        autoUpdate: (newThreshold: number) => Math.floor(newThreshold),
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
