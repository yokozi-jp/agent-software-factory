# Hono と React で OpenTelemetry を使う方法を調べる

## 問い

[Issue #38](https://github.com/yokozi-jp/hono-nx-vite-plus/issues/38)。Node.js 26 上の Hono と React の SPA で、OpenTelemetry の SDK (`@hono/otel` など)、Collector、ブラウザのテレメトリ (RUM、Web Vitals) を使う方法を調べる。あわせて、ローカルでエージェントがログ、メトリクス、トレースを照会できる構成 (Grafana の LGTM、VictoriaMetrics など) を調べる。

## 要約

- OpenTelemetry JS は Node.js v26 を公式にサポートする。パッケージは「安定版 (2.x、例 `@opentelemetry/api` 1.10.0)」と「実験版 (0.3xx、例 `@opentelemetry/sdk-node` 0.300.0)」の 2 系統に分かれ、`latest` 同士は組み合わせて動く前提になっている (opentelemetry-js README, 2026-10-20)。
- API 側は `@hono/otel` 1.2.0 (2026-09-26) の `httpInstrumentationMiddleware` で HTTP のトレースを取る。SDK の初期化は `@opentelemetry/sdk-node` の `NodeSDK` で行い、アプリより先に起動する必要がある。
- `@opentelemetry/sdk-node` は Node.js 専用で、Cloudflare Workers では使えない (`@hono/otel` README)。これは ADR 0007 の「`apps/api/src` は Web 標準の API だけ、ランタイム固有は入口のファイル」と衝突しうる。SDK 起動は `server.ts` 側に置く判断が要る。
- ブラウザのクライアント計測 (RUM) は OpenTelemetry では **実験的かつ大部分が未仕様** と明記されている (opentelemetry.io / opentelemetry-js README)。本番の RUM として今すぐ採用できる成熟度ではない。
- Core Web Vitals (CLS, INP, LCP) と FCP, TTFB は Google の `web-vitals` 6.2.3 (2026-10-05) で取るのが標準。これは OpenTelemetry とは別系統のライブラリ。
- フロントエンドのログ規約 (`docs/logging/frontend.md`) は「原則ログを出さない。収集するなら Sentry などの基盤」。RUM/Web Vitals をどう収集・送信するかは、この規約と突き合わせる判断が要る。
- ログの規約 (`docs/logging/format.md`) は JSON Lines を採用し、OTLP/JSON は視認性と分析性の理由で不採用と明記。これは「アプリのログ形式」の話で、OTel の計装 (トレース/メトリクス) の採否とは別の軸。
- ローカルの観測基盤は `grafana/otel-lgtm` (Collector + Prometheus + Tempo + Loki + Pyroscope + Grafana を 1 イメージ、OTLP の既定 `http://127.0.0.1:4318`) か、VictoriaMetrics 系 (metrics/logs/traces を別コンポーネントで native OTLP ingest) が候補。

## 比較

### API とブラウザの計測ライブラリ

| 用途                    | ライブラリ                                                        | 版 (公開日)          | ランタイム                 | 成熟度             | 出典             |
| ----------------------- | ----------------------------------------------------------------- | -------------------- | -------------------------- | ------------------ | ---------------- |
| API の HTTP トレース    | `@hono/otel`                                                      | 1.2.0 (2026-09-26)   | Node.js / Workers (別 SDK) | 安定 (1.x)         | npm, README      |
| API の SDK 初期化       | `@opentelemetry/sdk-node`                                         | 0.300.0 (2026-10-20) | Node.js 専用               | 実験版 (0.3xx)     | npm, README      |
| API のトレース API      | `@opentelemetry/api`                                              | 1.10.0 (2026-10-20)  | 共通                       | 安定 (1.x)         | npm              |
| 自動計装 (Node)         | `@opentelemetry/auto-instrumentations-node`                       | 0.82.0               | Node.js 専用               | 実験版             | npm              |
| ブラウザ RUM (トレース) | `@opentelemetry/sdk-trace` + `instrumentation-document-load` ほか | 実験版               | ブラウザ                   | **実験的・未仕様** | opentelemetry.io |
| Web Vitals              | `web-vitals` (Google)                                             | 6.2.3 (2026-10-05)   | ブラウザ                   | 安定               | npm, README      |

### ローカルの観測基盤

| 項目               | grafana/otel-lgtm                                                        | VictoriaMetrics 系                                                                         |
| ------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 構成               | 1 イメージに Collector + Prometheus + Tempo + Loki + Pyroscope + Grafana | metrics (VictoriaMetrics)、logs (VictoriaLogs)、traces (VictoriaTraces) を別コンポーネント |
| 用途の位置づけ     | 「開発・デモ・テスト用」と明記。本番は Grafana Cloud を案内              | 各コンポーネントは本番でも使う製品                                                         |
| OTLP 受信          | 既定で待受。`http://127.0.0.1:4318` (http/protobuf)                      | metrics は `/opentelemetry/v1/metrics` (protobuf) で native ingest。Collector 経由も可     |
| 可視化             | Grafana 同梱                                                             | 別途 Grafana などを立てる                                                                  |
| エージェントの照会 | `gcx` をローカル LGTM につなぐ経路あり (README)                          | クエリ API (PromQL/MetricsQL など) 経由                                                    |

## 候補ごとの詳細

### API (Hono) の計装

`@hono/otel` の README (honojs/middleware) の最小構成:

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { httpInstrumentationMiddleware } from "@hono/otel";
import { Hono } from "hono";

const openTelemetrySDK = new NodeSDK({ traceExporter: new OTLPTraceExporter() });
openTelemetrySDK.start();

const app = new Hono();
app.use(httpInstrumentationMiddleware({ serviceName: "my-service", serviceVersion: "1.0.0" }));
export default app;
```

- `httpInstrumentationMiddleware` はリクエストとレスポンスのライフサイクル全体を計装する。個々の middleware 単位の細かい計装はしない (README の Limitation)。
- `captureRequestHeaders` / `captureResponseHeaders` で取るヘッダを明示する。既定ではヘッダは取らない。span 属性は `http.request.header.<name>` になる (README)。
- Node.js の getting-started (opentelemetry.io) では、SDK は `--import ./instrumentation.ts` でアプリより前に読み込む。`@opentelemetry/auto-instrumentations-node` の `getNodeAutoInstrumentations()` で http などを自動計装でき、`PeriodicExportingMetricReader` でメトリクスも取れる。

ADR 0007 との関係:

- `@opentelemetry/sdk-node` は Node.js 専用で Cloudflare Workers では動かない。Workers では `@microlabs/otel-cf-workers` を使うと README にある (二次情報ではなく `@hono/otel` の README に記載)。
- ADR 0007 は `apps/api/src` から Node.js 組み込みや adapter の import を禁じ、ランタイム固有は入口のファイル (`server.ts`) に閉じ込める。`NodeSDK` の起動と `OTLPTraceExporter` は Node.js 固有なので、入口側に置く構成が自然。ミドルウェアの登録 (`httpInstrumentationMiddleware`) はアプリ側に置けるかの切り分けが要る。
- 判断: OTel の SDK 初期化は `server.ts` などの入口に置くのが、ADR 0007 の標準の形 (出典: ADR 0007、`@hono/otel` README)。避けるアンチパターンは、`apps/api/src` に `@opentelemetry/sdk-node` を import して Workers 向けの入口をビルド不能にすること。

### ブラウザのテレメトリ (RUM)

- OpenTelemetry のブラウザ計装は、公式 docs と opentelemetry-js README の両方で「experimental and mostly unspecified」と警告されている (出典: opentelemetry.io の browser-instrumentation-warning、opentelemetry-js README)。
- getting-started (browser) の構成は `@opentelemetry/sdk-trace` + `@opentelemetry/context-zone` + `@opentelemetry/instrumentation-document-load` などで、document load や XHR、ユーザー操作の span を取る。最小サポートは ES2022 (opentelemetry-js README)。
- React Native / Expo はブラウザ実装を使う。Metro 0.81.3+ が必要 (README)。本件は React の SPA なので通常のブラウザ実装が対象。

### Web Vitals

- Google の `web-vitals` は Core Web Vitals (CLS, INP, LCP) に加え FCP, TTFB を測る、約 3KB の小さなライブラリ。Chrome が実測する値と一致する形で測る (README)。
- `onCLS`, `onINP`, `onLCP` などのコールバック API。`attribution` ビルドで原因の詳細も取れる。収集先への送信 (analytics endpoint、GA など) は利用側が実装する (README)。
- 判断: ブラウザ性能の RUM は、未成熟な OTel ブラウザ計装よりまず `web-vitals` を使うのが Web 標準に沿った慣行 (出典: web-vitals README、OTel の experimental 警告)。避けるアンチパターンは、experimental な OTel ブラウザ SDK に本番の性能監視を依存させること。

### フロントエンドのログ規約との関係

- `docs/logging/frontend.md`: フロントエンドでは原則ログを出さない。収集するなら Sentry などの基盤を使う。`console` は lint で警告される。
- RUM / Web Vitals の送信は「ログ」ではなく計測データの送信だが、ブラウザから外部へデータを出す点は共通。どのエンドポイントへ、どんな属性で送るか (個人情報を含めないか) は、この規約と security.md、field-list.md の非正規化の考え方と突き合わせる判断が要る。

### ログ形式の規約との関係

- `docs/logging/format.md`: ログは JSON Lines。OTLP/JSON は「深くネストされ視認性と分析性が下がる」ため不採用と明記。これはアプリが出すログ行の形式の話。
- OTel の計装が出すトレース/メトリクスは OTLP で Collector へ送るのが前提で、ログ行の JSON Lines 規約とは別の経路。ログ (Loki など) に OTel のログ signal を使うかは別の判断軸になる。OTel JS のログ SDK は実験版の系統に属する。

### ローカルの観測基盤

- `grafana/otel-lgtm` は Collector + Prometheus (metrics) + Tempo (traces) + Loki (logs) + Pyroscope (profiles) + Grafana を 1 イメージにまとめた、開発・デモ・テスト用の backend (README)。OTLP の既定 `http://127.0.0.1:4318` (http/protobuf) をそのまま受ける。`mise run lgtm` で起動でき、`gcx` でローカルの LGTM に対して照会できる経路が README にある。本番は Grafana Cloud を案内している。
- VictoriaMetrics 系は metrics/logs/traces を別コンポーネント (VictoriaMetrics / VictoriaLogs / VictoriaTraces) で native に OTLP ingest する。metrics は `/opentelemetry/v1/metrics` に protobuf で push する (docs.victoriametrics.com)。可視化は別途 Grafana などを立てる。
- 判断: 「ローカルでエージェントがログ・メトリクス・トレースを一括で照会する」用途なら、1 イメージで Grafana まで入る `grafana/otel-lgtm` が立ち上げの手数が少ない開発用の標準 (出典: grafana/docker-otel-lgtm README)。避けるアンチパターンは、開発用の otel-lgtm を本番監視に転用すること (README が明確に非推奨)。VictoriaMetrics は本番でも使う構成を最初からローカルで再現したいときの候補。

## 未確認のこと

- `@hono/otel` と `@opentelemetry/sdk-node` の、Node.js 26 + Vite+ のビルド (ESM、`node26` target) での動作確認はしていない。ESM では loader hook が要る場合がある (OTel docs)。
- Lambda / Cloudflare Workers の入口ごとに OTel をどう初期化するか (Workers は `@microlabs/otel-cf-workers`、Lambda は Node SDK) の具体手順は未確認。
- `gcx` がこのリポジトリのエージェント環境で使えるか、認証の要否は未確認 (README はローカル LGTM で Grafana Cloud 不要と記載)。
- OTel JS のログ signal (logs SDK) の安定度の最新状況は、getting-started に「まだ開発中」とあるが、experimental パッケージ系統の現行の詳細までは追えていない。
- web-vitals の値を OTel の属性/メトリクスへどうマッピングするか (標準の semantic conventions があるか) は未確認。

## 出典

- `@hono/otel` README: <https://raw.githubusercontent.com/honojs/middleware/main/packages/otel/README.md>
- OpenTelemetry JS getting-started (Node.js): <https://raw.githubusercontent.com/open-telemetry/opentelemetry.io/main/content/en/docs/languages/js/getting-started/nodejs.md>
- OpenTelemetry JS getting-started (Browser): <https://raw.githubusercontent.com/open-telemetry/opentelemetry.io/main/content/en/docs/languages/js/getting-started/browser.md>
- ブラウザ計装の experimental 警告: <https://raw.githubusercontent.com/open-telemetry/opentelemetry.io/main/content/en/docs/languages/js/_includes/browser-instrumentation-warning.md>
- opentelemetry-js README (サポート runtime、安定/実験版の区分): <https://raw.githubusercontent.com/open-telemetry/opentelemetry-js/main/README.md>
- Google `web-vitals` README: <https://raw.githubusercontent.com/GoogleChrome/web-vitals/main/README.md>
- grafana/docker-otel-lgtm README: <https://raw.githubusercontent.com/grafana/docker-otel-lgtm/main/README.md>
- VictoriaMetrics OpenTelemetry 連携: <https://docs.victoriametrics.com/victoriametrics/integrations/opentelemetry/>
- VictoriaMetrics OpenTelemetry Collector: <https://docs.victoriametrics.com/victoriametrics/data-ingestion/opentelemetry-collector/>
- npm registry (版と公開日、2026-10-23 取得): `@hono/otel` 1.2.0、`@opentelemetry/api` 1.10.0、`@opentelemetry/sdk-node` 0.300.0、`@opentelemetry/auto-instrumentations-node` 0.82.0、`web-vitals` 6.2.3
- ADR 0007 (API のランタイムと Web 標準): `docs/adr/0007-api-on-node-web-standard-app.md`
- ログ規約: `docs/logging/format.md`、`docs/logging/field-list.md`、`docs/logging/frontend.md`
