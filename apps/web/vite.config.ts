import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

export default defineConfig({
  // The router plugin must come before the React plugin.
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  // `@/*` is resolved from the `paths` of tsconfig.json (docs/adr/0033).
  resolve: { tsconfigPaths: true },
  server: {
    port: 5173,
    // /api を API (apps/api の既定は 3000 番) へ転送し、ブラウザからは同一オリジンに見せる。
    // 理由は docs/web-api/security.md「CORS」。パスは書き換えない。認証の Issue (#155) が
    // API を /api/* に置くため。今の API は /health だけで、/api 以下の経路はまだない。
    proxy: { "/api": "http://localhost:3000" },
  },
  test: {
    setupFiles: ["./test/temporal.ts"],
    // 表示が実行環境のタイムゾーンに頼っていれば、東京とも本番 (UTC) とも違う夏時間のあるタイムゾーンで見つかる。
    // 効いていることは src/lib/date-time.test.ts が確かめる (docs/adr/0043)。
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ contextOptions: { timezoneId: "America/New_York" } }),
      instances: [{ browser: "chromium" }],
    },
    // __fixtures__/ は lint の検出力を確かめるファイルで、実行するテストではない (docs/adr/0026)。
    exclude: ["**/node_modules/**", "**/__fixtures__/**"],
  },
});
