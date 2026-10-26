import devServer from "@hono/vite-dev-server";
import { defineConfig } from "vite-plus";

// テストは 2 つの project に分ける。
//   lint         Oxlint の自作 plugin の規則のテスト。コンテナを使わないので速い。
//   integration  src/ のテスト。PostgreSQL と Keycloak のコンテナを、全テストで共有して一度だけ起動する。
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
      { extends: true, test: { name: "lint", include: ["lint/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.test.ts"],
          // __fixtures__/ は lint の検出力を確かめるファイルで、実行するテストではない (docs/adr/0026)。
          exclude: ["**/node_modules/**", "**/__fixtures__/**"],
          // Keycloak の起動に時間がかかる。
          globalSetup: ["./test/global-setup.ts"],
          hookTimeout: 240_000,
          testTimeout: 60_000,
        },
      },
    ],
  },
});
