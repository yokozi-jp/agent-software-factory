---
type: ADR
title: "ADR 0047: OpenTelemetry はトレースだけを OTLP で送り、計装は明示して入れ、SDK は packages/telemetry の Node 専用の入口とアプリの入口に閉じる"
description: API の可観測性の決定。計装は @hono/otel、pg、fetch (undici)、AWS SDK を明示して入れ、一括パッケージは使わない。送るのはトレースだけで、ログは stdout の JSON Lines のまま trace_id と span_id で相関する。SDK と exporter は packages/telemetry の ./node とアプリの入口のファイルだけが import し、ほかは @opentelemetry/api だけを Oxlint で強制する。ヘッダー、body、SQL の値、クエリ文字列は属性に載せない。ローカルは grafana/otel-lgtm。計装やトレースの属性を足す、変えるとき、OpenTelemetry の SDK を import したくなったとき、ログを OTLP で送りたくなったとき、ブラウザに OpenTelemetry を入れたくなったときに読む。
tags: [adr, observability, opentelemetry, logging, security, lint]
---

# ADR 0047: OpenTelemetry はトレースだけを OTLP で送り、計装は明示して入れ、SDK は packages/telemetry の Node 専用の入口とアプリの入口に閉じる

`apps/api` にはロガーも OpenTelemetry もなく、リクエストの遅さや失敗の原因を、トレースとログをたどって調べられませんでした。API、ワーカー、バッチ、Lambda の入口が同じ初期化を書くと重複します。計装の範囲は [Issue #148](https://github.com/yokozi-jp/agent-software-factory/issues/148) で決め、[Issue #199](https://github.com/yokozi-jp/agent-software-factory/issues/199) で実装しました。

## 決定

- **送るのはトレースだけ**: ログは `docs/logging` の規約のまま、stdout の JSON Lines に出し、ロガーが今の span の `trace_id`、`span_id`、`trace_flags` を足して相関します。OTLP でのログの送信はしません。メトリクスも今は送りません (`NodeSDK` に `metricReaders: []` と `logRecordProcessors: []` を渡す)。`@opentelemetry/sdk-node` 0.300 は `OTEL_METRICS_EXPORTER` と `OTEL_LOGS_EXPORTER` が空だと、既定の otlp を有効にするためです (`sdk.mjs` の `getMetricReadersFromEnv` と `configureLoggerProviderFromEnv` を読んで確かめた)。
- **計装は明示して入れる**: 受信は `@hono/otel` ([README](https://github.com/honojs/middleware/blob/main/packages/otel/README.md))、DB は `@opentelemetry/instrumentation-pg`、外向きの `fetch` は `@opentelemetry/instrumentation-undici`、AWS は `@opentelemetry/instrumentation-aws-sdk`。一括パッケージ (`auto-instrumentations-node`) は使いません。標準の入口ではありますが、何が出るかを見直す責任が導入側にあるためです (判断)。受信の span は `@hono/otel` だけが作り、`instrumentation-http` は入れません。Issue #199 は「どちらかに絞る」と求めており、Hono の middleware が `traceparent` の取り出しもするので `@hono/otel` に絞りました。`apps/api/src/tracing.unit.test.ts` が、1 回の要求で SERVER の span が 1 本だけであることを確かめます。
- **SDK の置き場所**: `packages/telemetry` (module ではない package) に置きます。`./node` が `startTelemetry()` を持つ Node 専用の入口、`.` が `urlWithoutQuery()` (URL をオリジンとパスだけにする。受信と外向きの `url.full` が使う) です。今の span の `trace_id` と `span_id` は、ロガーが `@opentelemetry/api` の `trace.getActiveSpan()` で取ります (#327)。SDK、exporter、instrumentation を import してよいのは `packages/telemetry/src` の `node.ts` (と、計装に渡す設定の `policy.ts`、テスト、fixture) と、アプリの入口のファイル (`apps/api/src/server.ts`、`telemetry.ts`) だけで、ほかのコードが import してよい OpenTelemetry は `@opentelemetry/api` だけです。Oxlint の `no-restricted-imports` が止めます ([ADR 0007](0007-api-on-node-web-standard-app.md) の禁止リストに足す形)。
- **入口の順序**: `apps/api/src/server.ts` は `./telemetry.ts` を最初に import します。ES module は、依存を import の順に評価するので ([ECMAScript の InnerModuleEvaluation](https://tc39.es/ecma262/#sec-innermoduleevaluation))、`pg` を import するファイルより前に計装が有効になります。環境変数は入口が読んで `startTelemetry({ env })` に渡します ([ADR 0032](0032-env-read-at-entry-and-passed-as-argument.md))。
- **送り先**: アプリは OTLP だけを出し、送り先は標準の `OTEL_EXPORTER_OTLP_ENDPOINT` で決めます。ベンダー固有の exporter は書きません。送り先の環境変数がない、または `OTEL_SDK_DISABLED=true` のときは SDK を始めません (送り先のないまま `localhost:4318` への失敗を出し続けないため)。設定し忘れに気づけるよう、`startTelemetry()` は `enabled` を返し、`server.ts` は始まらなかったときに起動のログで知らせます。本番の送り先、Collector、サンプリングは決めません。
- **属性は最小にする**: ヘッダーと body は取りません (`captureRequestHeaders` と `headersToSpanAttributes` を書かない)。pg の `enhancedDatabaseReporting` は無効にし、SQL は `$1` のままの文だけが載ります。`pg-pool.connect` の span は `ignoreConnectSpans` で切ります。`url.full` の既定はクエリ文字列を含み、OIDC の callback の `code` や `state` が載るので、受信は `getUrlFull` で、外向きの `fetch` は `requestHook` で、`urlWithoutQuery()` を通してクエリを落とします。`tenant_id` はトレースの属性に載せてよく、メトリクスの属性には載せません。メトリクスは今は送らないので、メトリクスを足すときにこの規則を検査にします。ユーザー ID とメールアドレスは載せません。
- **保証**: 保証カタログに 2 行を足します。(a) SDK と exporter の import 禁止 (ゲートは `vp check`。検出力は `oxlint-disable-next-line` を付けた fixture と、それを確かめる repo-policy。禁止の対象は `@opentelemetry/sdk-*`、`exporter-*` に加えて、SDK を始める `instrumentation*`、`resources`、一括パッケージ)。(b) 計装が既定で危ない属性を取らない (`packages/telemetry` と `apps/api` の Vitest。ヘッダー、body、クエリ文字列、SQL の値を入れた呼び出しで、span の属性に値が出ないことを確かめる)。トレースが送り先に届くか、`trace_id` が合うかは、手元の `grafana/otel-lgtm` で確かめ、ゲートにはしません。
- **ローカル**: `compose.otel-lgtm.yaml` で `grafana/otel-lgtm` を、版とダイジェストを固定して起動します ([ローカルでトレースを見る](../tooling/local-telemetry.md))。`gcx` は前提にしません。
- **ブラウザ**: OpenTelemetry は今は採りません。`apps/web` は `packages/telemetry` に依存しないので Node 専用の入口を解決できず、`apps/web/src` では `no-restricted-imports` も `@agent-software-factory/telemetry/node` を止めます。ブラウザの OpenTelemetry が stable になったとき、またはブラウザから API までを 1 本のトレースでつなぎたくなったときに見直します。Web Vitals の送信はログではなく、`console` は引き続き禁止です ([フロントエンドのログ出力](../logging/frontend.md))。

## Considered Options

- **一括パッケージ `auto-instrumentations-node`**: 数十の計装が既定で有効になり、何を取るかを導入側が見直しにくい。ヘッダーや SQL の値の取り扱いが計装ごとに違うため、明示して 4 つに絞りました。
- **ログも OTLP で送る**: ログを Collector 経由にでき、送り先を 1 つにできます。ただし今の規約 (stdout の JSON Lines、保存先の機能でマスク) を変え、Collector を置く前提になります。ログは発生源で機密を載せないことと保存先の機能で守るので、送りません。
- **ブラウザにも OpenTelemetry を入れる**: ブラウザから API までを 1 本のトレースにできますが、ブラウザの OpenTelemetry はまだ stable ではなく ([Issue #148](https://github.com/yokozi-jp/agent-software-factory/issues/148) の決定)、送り先も決まっていません。
- **各アプリの入口に SDK の初期化を書く**: API、ワーカー、バッチ、Lambda で同じ初期化が重複し、属性の方針が入口ごとにずれます。`startTelemetry()` に集めれば、方針は `packages/telemetry/src/policy.ts` の 1 か所です。

## Consequences

- ワーカー、バッチ、Lambda の入口は `@agent-software-factory/telemetry/node` の `startTelemetry()` を最初に呼びます。入口のファイルは `vite.config.ts` の入口の override に足します。
- 計装を足す、属性の設定を変えるときは `policy.ts` を変え、`policy.test.ts` に、その値が span に出ないことを確かめる呼び出しを足します。
- `@opentelemetry/sdk-node` は実験版 (0.3xx) の系統で、minor の更新で options が変わることがあります。sdk-node 0.300 は `@opentelemetry/sdk-trace` 3.x を使い、`@opentelemetry/sdk-trace-base` は deprecated なので、テストは `sdk-trace` から `InMemorySpanExporter` を import します。
- 非同期の `traceparent` の引き継ぎ (Outbox、SQS、ワーカー) は、実装が揃ってから別の Issue で扱います。
- Collector は今は置きません。テレメトリを初めてローカルの外の本物の送り先へ送るとき (CloudWatch の OTLP は SigV4 の署名を求める。Issue #148 の決定)、またはトレースの属性をアプリの外でも絞りたくなったときに置きます。置くときは、allowlist が実際に効いていることを確かめる試験を最初から付けます。
- Better Auth は `@opentelemetry/api` が解決できると、自分の span (操作の ID、route、表の名前と操作の名前だけを属性にする。`@better-auth/core` の `instrumentation/attributes.mjs`) を作ります。`apps/api` が `@agent-software-factory/telemetry` を通して API を持つので、SDK を始めると出ます。
- `vp dev` (`apps/api/src/index.ts`) は SDK を始めません。トレースを見るには、`vp build` した `server.ts` を `pnpm start` で動かします。

## 出典

- [Issue #148](https://github.com/yokozi-jp/agent-software-factory/issues/148) の解決コメント: 計装の範囲の決定
- [Issue #199](https://github.com/yokozi-jp/agent-software-factory/issues/199): 実装
- OpenTelemetry: [Collector](https://opentelemetry.io/docs/collector/)、[Logs](https://opentelemetry.io/docs/concepts/signals/logs/)、[Handling sensitive data](https://opentelemetry.io/docs/security/handling-sensitive-data/)
- [@hono/otel](https://github.com/honojs/middleware/blob/main/packages/otel/README.md) (`getUrlFull` の説明: 既定の `url.full` はクエリ文字列を含む)、[instrumentation-pg](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/packages/instrumentation-pg/README.md)
- [grafana/docker-otel-lgtm](https://github.com/grafana/docker-otel-lgtm)
