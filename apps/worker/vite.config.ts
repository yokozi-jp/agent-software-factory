import { defineConfig } from "vite-plus";
import { ownFilesMinimum, recordCoverage } from "../../vitest-coverage.ts";

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
      ...recordCoverage({
        exclude: [
          // 実行環境ごとの入口。環境変数を読んで起動するだけで、テストは createNotificationHandler と pollQueue と
          // createLambdaHandler を通す。
          "src/server.ts",
          "src/lambda.ts",
          // 期限切れの冪等キーを消すバッチの入口 (Issue #325)。環境変数を読んで runPurgeJob を 1 回呼ぶだけで、テストは runPurgeJob を通す。
          "src/purge-idempotency-keys.ts",
          // 手で動かすための入口 (docs/tooling/local-worker.md)。環境変数を読んで SQS を 1 回呼ぶだけ。
          "src/local/**",
          // SES を呼ぶ Layer。SES のモックは作らない (docs/adr/0041)。検証環境の試験で本物の SES を通す。
          "src/mail/ses.ts",
        ],
      }),
      thresholds: ownFilesMinimum,
    },
  },
});
