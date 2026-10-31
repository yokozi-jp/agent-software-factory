import { defineConfig } from "vite-plus";

// テストの project は 2 つ。integration は src/ のテストで、PostgreSQL、ElasticMQ、Mailpit のコンテナを全テストで共有して一度だけ起動する。
// unit (`*.unit.test.ts`) はどれも起動しない。入力を渡して結果を見るだけのテストは unit にする。
// コンテナが起動しない環境でも、`vp test run --project unit` で動く (vitest は global setup の失敗を
// `code.charCodeAt is not a function` で隠すので、integration が起動で落ちた原因はコンテナを疑う)。
export default defineConfig({
  test: {
    // Node.js 24 には Temporal がないので、polyfill の global を入れる (src/server.ts と同じ import)。
    setupFiles: ["./test/temporal.ts"],
    // コードがプロセスの TZ に頼っていれば、東京とも本番 (UTC) とも違う夏時間のあるタイムゾーンで見つかる。
    // メールの日時が東京の時刻で書かれることが、その確認になる (src/handle-notification.test.ts)。
    env: { TZ: "America/New_York" },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.unit.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.test.ts"],
          exclude: ["**/node_modules/**", "src/**/*.unit.test.ts"],
          globalSetup: ["./test/global-setup.ts"],
          // コンテナの起動 (イメージの取得を含む) を待つ。testcontainers の待ちの上限 (既定 60 秒) より長くする。
          hookTimeout: 180_000,
          testTimeout: 60_000,
        },
      },
    ],
    // テストの強さの基準 (#30、docs/tooling/ci.md ("coverage の下限"))。ファイルごとの下限だけ掛ける。
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        // lint の検出力を確かめる fixture。わざと規則に違反する文を持ち、どこからも import されない。
        "src/__fixtures__/**",
        // 実行環境ごとの入口。環境変数を読んで起動するだけで、テストは createNotificationHandler と pollQueue と
        // createLambdaHandler を通す。
        "src/server.ts",
        "src/lambda.ts",
        // SES を呼ぶ Layer。SES のモックは作らない (docs/adr/0041)。検証環境の試験で本物の SES を通す。
        "src/mail/ses.ts",
      ],
      thresholds: { perFile: { lines: 90, branches: 90 } },
    },
  },
});
