import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

// coverage の全体の値を、切り捨てて書き戻す (docs/tooling/ci.md ("coverage の下限"))。apps/api の vite.config.ts に同じ
// 形の記述があり、jscpd (pnpm lint:dup) が重複と数えるので、名前を付けて形を変えてある。
const floorThreshold = (newThreshold: number) => Math.floor(newThreshold);

export default defineConfig({
  // The router plugin must come before the React plugin.
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      // route の HMR の footer は、テストでは動かず、route のファイルの最後の行が未通過と数えられる。テストでは外す。
      codeSplittingOptions: { addHmr: process.env["VITEST"] === undefined },
    }),
    react(),
    tailwindcss(),
  ],
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
    // 日時の表示が実行環境のタイムゾーンに頼っていれば、東京とも本番 (UTC) とも違う夏時間のあるタイムゾーンで見つかる。
    // 効いていることは src/lib/date-time.test.ts が確かめる (docs/adr/0043)。story も同じブラウザで流す。
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ contextOptions: { timezoneId: "America/New_York" } }),
      instances: [{ browser: "chromium" }],
    },
    // project は 2 つ。unit は src/ の `*.test.ts` で、純粋な関数の確認 (ブラウザで流すのは、上の timezoneId を効かせるため)。
    // storybook は story の `play` で、画面と部品の component test (docs/adr/0033)。`*.test.tsx` は ADR 0033 で使わないが、
    // 置かれても黙って流れないことがないよう、unit の include に入れてある。
    // setupFiles は unit の中に置く。root に置くと story にも効く
    // (https://storybook.js.org/docs/writing-tests/integrations/vitest-addon の "How do I isolate Storybook tests from others?")。
    // .storybook/preview.ts は addon が自動で story に適用する。setProjectAnnotations を呼ぶ setup file を置くと、
    // addon 10.6.5 が「10.3 から自動なので不要」と実行時に知らせる。
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts"],
          setupFiles: ["./test/temporal.ts"],
          // __fixtures__/ は lint の検出力を確かめるファイルで、実行するテストではない (docs/adr/0026)。
          exclude: ["**/node_modules/**", "**/__fixtures__/**"],
        },
      },
      {
        extends: true,
        plugins: [storybookTest({ configDir: ".storybook" })],
        test: {
          name: "storybook",
        },
      },
    ],
    // a11y の違反を警告にとどめた story (preview.ts の `a11y.test: "todo"`) の違反は、Storybook の画面にだけ出て CI のログに出ない。
    // この reporter が実行ログに出す (test/a11y-warnings-reporter.ts)。
    reporters: ["default", "./test/a11y-warnings-reporter.ts"],
    // テストの強さの基準 (#30、docs/tooling/ci.md ("coverage の下限"))。unit と storybook の両方が通した行を数える。
    coverage: {
      provider: "v8",
      // テストのない新しいファイルも数え、ファイルごとの下限で止める。
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.ts",
        "**/*.stories.tsx",
        // lint の検出力を確かめる fixture (docs/adr/0026)。わざと規則に違反する文を持ち、どこからも import されない。
        "src/__fixtures__/**",
        // 実行環境ごとの入口。i18n の初期化と router を作って描画するだけで、story では通らない。
        "src/main.tsx",
        // TanStack Router の plugin が書く生成物 (commit している)。
        "src/routeTree.gen.ts",
      ],
      thresholds: {
        // ファイルごとの固定の下限。
        perFile: { lines: 90, branches: 90 },
        // 全体の値は上がる方向にだけ動く。上回った実行が、切り捨てた新しい値を下に書く。書き換わったら commit する。
        autoUpdate: floorThreshold,
        statements: 100,
        lines: 100,
        functions: 100,
        branches: 100,
      },
    },
  },
});
