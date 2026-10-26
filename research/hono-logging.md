# Hono のロギングのロガーと組み込み方を、pino、LogTape、hono/logger、自作で比べる

## 問い

[Issue #228](https://github.com/yokozi-jp/agent-software-factory/issues/228) の調査。Hono の API、ワーカー、バッチで、規約 `docs/logging` を満たすロガーと、その組み込み方の選択肢を、一次情報で比べる。結果は [Hono のロギングの規則を決める (#229)](https://github.com/yokozi-jp/agent-software-factory/issues/229) の材料になる。この文書は決定を下さない。

調べること（#228 の本文）は 7 つ。(1) ロガーの候補と ADR 0007、ECS と Lambda、(2) リクエストごとのロガー、(3) アクセスログ、(4) マスク、(5) 例外とエラー、(6) 守らせる検査、(7) 性能と flush。

調べた日は 2026-10-26。AWS アカウントはまだないので、AWS の上ではなにも実行していない。Lambda と CloudWatch Logs の挙動は、文書の記述だけである。コードを動かした結果は「確かめた」と書き、読んだ文書の内容は「文書による」、私の判断は「判断」と書く。

## 要約

- 候補はどれも、`docs/logging/keys.md` の共通スキーマのキー名で JSON Lines を出せた。pino 10.4.0、LogTape 2.4.2、自作（約 30 行）で、同じシナリオ（6 リクエスト、17 行）を流し、全行に `timestamp`、`severity.text`、`message`、`service.name`、`service.version`、`deployment.environment`、`trace_id`、`span_id` が揃った。ただし、キー名に合わせるための設定は、どれも要る。LogTape の組み込みの JSON Lines formatter は `@timestamp`、`level`、`logger`、`properties` を出すので、そのままは合わない。pino の既定は `level`（数値）、`time`（epoch）、`msg`、`pid`、`hostname` である。
- `trace_id` と `span_id` は、候補によらず `@opentelemetry/api` の `trace.getActiveSpan()` で取れた。`@hono/otel` の span の中で、子 span に入ると `span_id` が子 span の値に変わり、`traceparent` を持つ要求では、親の `trace_id` が引き継がれた。ただし、アクセスログの middleware を `@hono/otel` より前に置くと span がなく、`trace_id` が付かない。
- `hono/logger` は、文字列を 1 つ `console.log` に渡すだけで、JSON Lines にならない。キー名も、リクエスト ID も、`OPTIONS` の扱いも選べない。ANSI の色も付く。規約には合わない。
- リクエストごとの項目（リクエスト ID、`tenant_id`、`user_id`）は、`hono/context-storage` の `tryGetContext()` から取る書き方で、3 候補とも全行に付いた。LogTape は、さらに独自の `withContext` と `AsyncLocalStorage` を持つ。非ブロッキングの sink では、formatter が後で動くので、formatter の中で今の span を読むと取れない（確かめた）。
- マスクは、キー名による redact が 3 候補とも効いた。ただし、どれも「キー名の一致」だけで、メッセージの文字列、例外のメッセージ、キーの綴りの違いは守れない（確かめた）。pino は大文字小文字を区別し、`*.password` は最上位の `password` に効かない。LogTape の `fieldPatterns` は、ドットを含むキー全体に対して照合する。
- flush: `process.exit()` の直前に、pipe が詰まっていると、`process.stdout.write` と `console.log` は行を失った（5000 行のうち 544 行だけ届いた）。pino の `pino.destination({ sync: true })` と既定の宛先は、5000 行すべてが届いた。Node の文書も、pipe の書き込みは POSIX では非同期とする。LogTape の非ブロッキング sink は、バッファが溢れると古い行を捨てる（`bufferSize: 100` で 5000 行を一気に出すと 300 行だけ届いた）。
- Lambda との関係に、規約と食い違うところがある。Web Functions は、`console` に渡したオブジェクトを `message` の下に入れて、`timestamp`、`level`、`requestId` などを足す。JSON.stringify した文字列を渡すと、エスケープされた文字列になり、項目を検索できない。Event Functions の JSON ログ形式では、すでに JSON の行は二重に符号化しないが、レベルの絞り込みは `level` と `timestamp` のキーを見る。`keys.md` は `severity.text` を既定にしている。どちらも AWS の上では確かめていない。
- 検査: Oxlint の `no-console` は `console.log(...)` を止めたが、`globalThis.console.warn(...)` と、別名に入れた `c.info(...)` は止めなかった。キー名は、ログの引数を型（リテラル型のキーの集まり）にすると、オブジェクトリテラルの綴りの誤りと値の型の誤りを `tsc` が止めた。スプレッドや変数を通すと止まらない。

## 前提（このリポジトリの決定と制約）

- ログは stdout の JSON Lines のままにし、OTLP では送らない。ロガーが今の span から `trace_id` と `span_id` を足す（[#148 の解決コメント](https://github.com/yokozi-jp/agent-software-factory/issues/148)）。ロガーの選定と `trace_flags` の扱いは、#199 で決めるとしていた。この地図で先に決める。
- `apps/api/src` は Web 標準の API だけで書き、Node 固有のコードは入口のファイルに置く。`import/no-nodejs-modules` と `no-restricted-imports`、`no-restricted-globals`（`process` など）が `vp check` で止める。入口のファイルとテストは対象外（[ADR 0007](../docs/adr/0007-api-on-node-web-standard-app.md)、ルートの `vite.config.ts`）。
- API は ECS（1 つのコンテナイメージ）と Lambda（API は Web Functions、ワーカーは Event Functions、`nodejs24.x`）の両方に置ける（[ADR 0013](../docs/adr/0013-api-on-ecs-and-lambda-web-functions.md)）。リポジトリは Node.js 24（`.node-version` は 24.22.1）。
- 規約: `docs/logging/` の `keys.md`（共通スキーマ）、`web-api.md`（アクセスログ）、`security.md`、`levels-and-notification.md`、`performance.md`、`messages.md`、`message-codes.md`、`format.md`、`batch.md`、`startup.md`。
- 今の `apps/api` にロガーはない。`server.ts` に `console.log` が 1 行ある。`vite.config.ts` に `no-console` の設定は、`apps/web/src` にだけある。
- [#199](https://github.com/yokozi-jp/agent-software-factory/issues/199) の実施の方針: 計装は `@hono/otel`、`pg`、`instrumentation-undici`、AWS SDK。`@opentelemetry/api` 以外の OTel の import は入口と `packages/telemetry` に閉じる。「`@opentelemetry/api` の `trace.getActiveSpan()` で ID を取れば、どのロガーでも相関できる」とある。
- ログのマスクは、発生源で載せないことと、CloudWatch Logs のデータ保護で担う（#148 の決定の 7）。

## 調べた方法

`/tmp/hono-log-exp`（リポジトリの外）に小さなプロジェクトを作り、同じ Hono の app を 3 つのロガーで動かした。リポジトリ内に `node_modules` は増やしていない。

| 項目                                                | 版                                              |
| :-------------------------------------------------- | :---------------------------------------------- |
| Node.js                                             | 24.22.1（リポジトリの `.node-version` と同じ）  |
| hono                                                | 4.13.14（リポジトリの catalog は `^4.13.13`）   |
| @hono/otel                                          | 1.2.0                                           |
| @opentelemetry/api                                  | 1.9.1（1.10.0 は下の注記の理由で使えなかった）  |
| @opentelemetry/sdk-trace-node                       | 2.12.0（`InMemorySpanExporter` で span を保持） |
| pino                                                | 10.4.0                                          |
| @logtape/logtape、@logtape/redaction、@logtape/hono | 2.4.2                                           |

Hono の app の構成: `contextStorage()` → `@hono/otel` → リクエスト ID、`tenant_id`、`user_id` を `c.set` する middleware → アクセスログ（要求時と応答時の 2 行。`/health` は出さない。`OPTIONS` は出す）→ ルート。ルートは `/health`、`/items`（子 span の中でログを出す）、`OPTIONS /items`、`POST /secret`（秘匿するキーとメッセージを出す）、`GET /boom`（例外）。`onError` で `exception.*` と `message.code` を出し、`application/problem+json` を返す。ログの引数は `log.info(message, fields)` に統一し、各行に付く項目（リクエスト ID、`tenant_id`、`user_id`、`trace_id`、`span_id`、`trace_flags`）は `hono/context-storage` の `tryGetContext()` と `trace.getActiveSpan()` から集めた。

注記（確かめた）: `npm i` は、`@opentelemetry/sdk-trace-base@2.12.0`（peer の `@opentelemetry/api` は `>=1.3.0 <1.10.0`）と、`@opentelemetry/instrumentation-pino@0.70.0`（peer は `^1.10.0`）の組み合わせで `ERESOLVE` になった。`@opentelemetry/api` の最新は 1.10.0（2026-10-26）。`sdk-node@0.300.0` の peer は `>=1.10.0 <1.11.0`。#199 で SDK を入れるときの注意点になる（出典: `npm view` の出力）。

## 1. ロガーの候補

### 候補の一覧（文書とソースで確かめた事実）

| 候補                                                       | 何か                                                                                                                                           | 依存                                                                        | Node 固有の部分                                                                                                             | 出典                                                                                                                                           |
| :--------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| pino 10.4.0                                                | JSON を出す Node 向けのロガー。MIT                                                                                                             | 直接の依存 11 個（`sonic-boom`、`thread-stream`、`@pinojs/redact` など）    | 宛先 `pino.destination`（`sonic-boom`、`fs`）と、transport（worker thread）。`pino()` の既定の宛先も stdout の `sonic-boom` | [pino の API](https://github.com/pinojs/pino/blob/main/docs/api.md)、[transports](https://github.com/pinojs/pino/blob/main/docs/transports.md) |
| LogTape 2.4.2                                              | 依存なしのロガー。Deno、Node.js、Bun、ブラウザ、edge functions に対応と明記。MIT                                                               | 0 個。`@logtape/redaction`、`@logtape/hono`、`@logtape/otel` は別パッケージ | 暗黙の context に `AsyncLocalStorage` を渡す（`contextLocalStorage`）。stdout に書く sink を自分で用意する                  | [LogTape intro](https://logtape.org/intro)、[contexts](https://logtape.org/manual/contexts)、[sinks](https://logtape.org/manual/sinks)         |
| `hono/logger`                                              | Hono 組み込みの middleware                                                                                                                     | なし                                                                        | なし（`console.log`）                                                                                                       | [ソース](https://github.com/honojs/hono/blob/main/src/middleware/logger/index.ts)                                                              |
| 自作（`console` か `process.stdout.write` に JSON を書く） | `JSON.stringify` して行を書く関数                                                                                                              | なし                                                                        | 書き込み先の関数を入口から渡せば、アプリのコードは Node 固有でなくなる                                                      | 確かめた（`/tmp/hono-log-exp/src/custom.mjs`、約 30 行）                                                                                       |
| `@logtape/hono` の `honoLogger`                            | LogTape を使うアクセスログの middleware                                                                                                        | LogTape                                                                     | LogTape と同じ                                                                                                              | [@logtape/hono の型定義](https://www.npmjs.com/package/@logtape/hono)                                                                          |
| `hono-pino`（第三者）                                      | pino を使うアクセスログの middleware                                                                                                           | pino                                                                        | pino と同じ                                                                                                                 | `npm view`: 0.10.3、最終更新 2025-10-05。今回は動かしていない                                                                                  |
| `@opentelemetry/instrumentation-pino`                      | pino の各行に `trace_id`、`span_id`、`trace_flags` を足す。ログ送信（log sending）は既定で有効だが、SDK に LoggerProvider がなければ何もしない | `@opentelemetry/api`（peer `^1.10.0`）                                      | pino の対応は `>=5.14.0 <11`                                                                                                | [README](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/packages/instrumentation-pino/README.md)。今回は動かしていない   |

### ADR 0007（Web 標準の API だけ）との関係

- ADR 0007 の検査は、`apps/api/src` のファイルの `import` と、グローバルの名前を見る。`pino` と `@logtape/logtape` は Node の組み込みモジュールではないので、`import/no-nodejs-modules` では止まらない（`vite.config.ts` のルールの定義による判断）。パッケージの内部が Node の API を使うかは、検査の対象外である。
- 確かめた: `hono/context-storage` の実体（`node_modules/hono/dist/middleware/context-storage/index.js`）は `node:async_hooks` を import する。`apps/api/src` から `hono/context-storage` を import しても ADR 0007 の検査は通る。Hono の文書は、Cloudflare Workers では `nodejs_compat` か `nodejs_als` のフラグが要ると書く（[Context Storage Middleware](https://hono.dev/docs/middleware/builtin/context-storage)）。ECS と Lambda（Node.js）では問題がない。
- 判断: どの候補を選んでも、アプリのコードが `pino` や `@logtape/logtape` を直接 import せず、`apps/api/src` に小さな `Logger` のインターフェース（型）を置き、実体は入口のファイル（`server.ts` と Lambda の入口）が組み立てて `createApp({ log })` に渡す形にすると、候補を後から替えられ、ADR 0007 の「入口に閉じ込める」と同じ形になる。今回の実験の `buildApp(log)` がその形で、3 候補とも同じ app のコードで動いた。
- pino の transport（worker thread）は Node 固有なので、入口にだけ置く。pino の文書は、transport を使うと `process.exit()` の前に transport が起動していないとログが失われると書く（[transports の Asynchronous startup](https://github.com/pinojs/pino/blob/main/docs/transports.md)）。stdout へ出すだけなら、transport は要らない（後の「7. 性能」）。
- Workers での動作は、pino も LogTape も今回は動かしていない（ADR 0007 の動機の 1 つ）。LogTape は文書が edge functions 対応をうたう。pino の公式の文書は Node 向けを主とする（判断）。

### ECS と Lambda で動くか

- ECS（Fargate）: `awslogs` ドライバーは、コンテナの STDOUT と STDERR をそのまま CloudWatch Logs に渡す（[Send Amazon ECS logs to CloudWatch](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_awslogs.html)）。stdout の JSON Lines は、そのまま届く。
- Lambda Event Functions（ワーカー）: `console` のメソッドと、stdout か stderr に書くロガーのログは、CloudWatch Logs に送られる。既定のログ形式は plain text。JSON 形式（`LoggingConfig` の `LogFormat=JSON`）を選ぶと、`console` の出力は `timestamp`、`level`、`message`、`requestId` を持つ JSON になる。「すでに JSON の行は二重に符号化しない」と書く（[Log and monitor Node.js Lambda Event Functions](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html)、[Configuring JSON and plain text log formats](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-logformat.html)）。
- Lambda のレベルの絞り込み（文書による）: JSON ログ形式で、Lambda が `applicationLogLevel` で絞り込むには、行に `level` のキーと RFC 3339 の `timestamp` のキーが要る。`timestamp` が正しくないと、Lambda は INFO として扱い、`timestamp` を足す（[Using log-level filtering with Node.js](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html)）。`keys.md` の既定は `severity.text` で、「ライブラリによっては `level` のままでも許容」とする。`severity.text` を出す構成では、Lambda の `applicationLogLevel` の絞り込みが効かない可能性がある（AWS の上では未確認）。
- Lambda Web Functions（API）: 標準出力と標準エラー出力を取り込む。Node.js の `console` の出力は JSON のログ事象として書かれ、`requestId`、`endpointName`、`region` が足される。オブジェクトを `console` のメソッドに渡すと `message` の下に入る。「`JSON.stringify` で作った文字列を渡さない。文字列はエスケープされた文字列の値になり、項目を検索できない」とある（[Web Function logs in Amazon CloudWatch Logs](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging.html)）。
  - 文書は、「ロガーが stdout に書いた JSON の 1 行」が Web Functions でどう取り込まれるか（トップレベルの項目として残るか、`message` の文字列になるか）を書いていない。未確認。
  - `keys.md` はキーをトップレベルに置く規約である（`messages.md`: 「可変値は、トップレベルでフラットにもたせる」）。Web Functions で `message` の下に入ると、Logs Insights の検索は `message.trace_id` のようになる。
- 判断: 同じキー名のログを ECS、Event Functions、Web Functions の 3 つで同じ形にするには、検証環境で 3 つの実機の出力を比べる必要がある。ADR 0013 の「最初の検証環境で確かめる」一覧に、ログの形を足す価値がある。

## 2. リクエストごとのロガー

### 確かめた事実

- `@hono/otel` 1.2.0 のソース（`node_modules/@hono/otel/dist/index.mjs`）は、`tracer.startActiveSpan(...)` の中で `await next()` を呼ぶ。そのため、span が有効なのは `@hono/otel` の middleware より後ろの処理だけである。
  - 実験: `@logtape/hono` の `honoLogger` を `@hono/otel` の前に置くと、ログに書いた今の span の `trace_id` は `null`。後ろに置くと `86da9e63...` のような値が入った。
- 3 候補とも、`hono/context-storage` の `contextStorage()` を一番前に置き、`tryGetContext()?.var` から `requestId`、`tenantId`、`userId` を読むと、全 17 行にリクエスト ID、`tenant_id`、`user_id` が付いた（`check.mjs` の出力）。
- 子 span（`db.query`）の中のログは、`span_id` が子 span の値になり、`trace_id` は同じだった。外に出ると親（サーバー span）の `span_id` に戻った。
- `traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01` を付けた要求では、そのリクエストの 4 行の `trace_id` が `0af7651916cd43dd8448eb211c80319c`、`trace_flags` が `01` になった（`@hono/otel` が `propagation.extract` で親を取る）。
- `onError` の中のログにも、そのリクエストのサーバー span の `trace_id` と `span_id` が付いた。`onError` は span の有効な範囲で動いた。
- `trace_flags` は `spanContext().traceFlags` を 16 進 2 桁にして出した（`"01"`）。OTel の仕様は、`trace_id`（小文字の 16 進）、`span_id`、`trace_flags`（W3C の traceflags 形式）をトップレベルに置くよう定める。3 つとも省略できる（[Trace Context in non-OTLP Log Formats](https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/)）。`keys.md` の共通スキーマは `trace_id` と `span_id` だけで、`trace_flags` は載せていない。
- pino: `mixin` に `() => ambient()` を渡すと、毎回の呼び出しで取れる。`logger.child()` を使うと、子ロガーの束縛は作った時点で 1 回だけ評価される（[pino の `serializers` の説明](https://github.com/pinojs/pino/blob/main/docs/api.md)）ので、span は毎回変わる項目には向かない（リクエストごとの子ロガーを作る書き方は、リクエスト ID だけならよい）。
- LogTape:
  - 暗黙の context は `configure({ contextLocalStorage: new AsyncLocalStorage() })` と `withContext({...}, fn)` で、非同期の呼び出しにも引き継がれる（[contexts](https://logtape.org/manual/contexts)）。`contextLocalStorage` を渡さないと、黙って無視され、メタロガーに警告が出る。
  - 確かめた: 非ブロッキングの stream sink（`getStreamSink(..., { nonBlocking })`）では、formatter が後で動く。formatter の中で `trace.getActiveSpan()` を読むと空だった（出力は `"ambient":{}`）。`withContext({ trace_id: lazy(() => trace.getActiveSpan()?.spanContext().traceId) }, ...)` のように `lazy()` を使うと、ログを呼んだ時点で評価され、`trace_id` が残った。同期の sink では formatter の中で読んでも取れた。
  - 確かめた: メタロガー（`["logtape", "meta"]`）を設定しないと、`configure` のたびに、JSON ではない 1 行（`LogTape loggers are configured...`）が標準出力に出る。stdout を JSON Lines だけにするには、メタロガーを設定する必要がある。
- `@logtape/hono` の `honoLogger({ context: { requestId: { property: "request.id" }, enrich } })` で、リクエスト ID の項目名と任意の項目（`tenant_id`）を暗黙の context に足せた（確かめた）。

### ワーカーとバッチで同じ形にできるか

- 判断（動かしていない）: ワーカー（SQS を読む繰り返し、Event Functions の `handler(event)`）とバッチは、Hono の context を持たない。`hono/context-storage` の `tryGetContext()` は使えず、`AsyncLocalStorage` を自分で持つか（LogTape の `withContext`）、リクエスト ID に相当するもの（メッセージ ID、バッチの実行 ID）を呼び出しごとに引数か子ロガーで渡すことになる。`ambient()` のように「今の context から項目を集める関数」を差し替え可能にすると、API とワーカーで同じロガーを共有できる。
- `batch.md` が求める項目（`batch.job_id`、`batch.params`、`batch.result`、`batch.stats`、`duration_ms`）は、ロガーの機能ではなくキー名の設計の話で、どの候補でも出せる（フラットなキーとして渡すだけ）。ただし、`batch.params` と `batch.stats` は `batch.params: {...}` のようにオブジェクトのネストを例にしている。`messages.md` は「details 配下にまとめる」を悪い例とするので、`batch.md` と `messages.md` の例が食い違う（規約の側の論点）。

## 3. アクセスログ

### 規約（`web-api.md`）

要求時と応答時の 2 行を推奨（ログ量は倍になる）。ヘルスチェックのアクセスログは出さない。`OPTIONS` は、アプリで実装するなら絞らずに出す。項目は `timestamp`、`severity.text`（要求時は debug、応答時は info でもよい）、`request.id`、`url.path`、`http.request.method`、`client.address`（任意）、`user_id`（任意）、`http.response.status_code`（応答時）、`http.server.request.duration`（秒）、`user_agent.original`。

### 確かめた事実

- 自作の middleware（約 20 行）で、要求時と応答時の 2 行、`/health` の除外、`OPTIONS` の出力が、3 候補とも同じコードで動いた。6 リクエストのうち `/health` は 0 行、`OPTIONS /items` は 2 行、そのほかは 2 行ずつ（計 17 行、`debug` の行を除く）。
- 応答時の `http.response.status_code` は、`await next()` の後に `c.res.status` から読む。`onError` が 500 を返したリクエストでも `500` が入った。`http.server.request.duration` は `performance.now()` の差を 1000 で割って秒にした。
- `hono/logger`（ソースを読み、動かした）:
  - 出力は `<-- GET /items` と `--> GET /items 200 3ms` の 2 行（要求時と応答時）。文字列だけで、キー名がない。リクエスト ID も `trace_id` も入らない。
  - `/health` の除外と `OPTIONS` の扱いを選ぶ引数がない（middleware を `app.use` する範囲を分けるしかない）。
  - ステータスは ANSI の色が付く。`NO_COLOR` が設定されていないと、TTY でなくても付いた（`cat -v` で `^[[32m200^[[0m` を確認）。`format.md` は ANSI を原則使わないとする。
  - 引数 `fn` で出力関数を替えられるが、渡されるのは組み立て済みの文字列だけで、項目は取れない。
- `@logtape/hono` の `honoLogger`（型定義を読み、動かした）:
  - 既定の `structured-combined` のキーは `method`、`url`、`path`、`status`、`responseTime`（ミリ秒）、`contentLength`、`userAgent`、`referrer`。`keys.md` のキーとは違う。`format` に関数を渡すと、任意のキーのオブジェクトを返せる。`keys.md` のキーで返したら、そのまま出た（確かめた）。
  - `format` がオブジェクトを返すと、`message` は `"   -  ms"` というテンプレートの残りになった（確かめた）。`message` を固定の文言にするには、formatter 側で直すか、自分の middleware を使う。
  - `skip: (c) => c.req.path === "/health"` で除外できる。
  - `logRequest` は「`true` なら要求を受けた時点で書き、`false`（既定）なら応答の後に書く」と型定義にある。どちらか 1 行で、要求時と応答時の両方は出せない（型定義の記述。`logRequest: true` は動かしていない）。応答の本文の stream が終わった後に書くので、`app.request()` の戻りの本文を読まないと行が出なかった（確かめた）。
  - `completionLevel` で、ステータスや処理時間によるレベルを変えられる（型定義にある）。
- `@hono/otel` の span との重なり（確かめた、ソースを読んだ）: アクセスログの行と、`@hono/otel` の span は別のものである。span は `http.request.method`、`url.full`、`http.route`、`http.response.status_code` を持ち、`http.server.request.duration` をメトリクスとして記録する。ログの行には同名のキーがあるが、送り先が違う（ログは stdout、span と metric は OTLP）。`#148` の決定（ログは OTLP で送らない）の下では、重複ではない。ヘッダーは `captureRequestHeaders` を指定しない限り取らない（[@hono/otel の README](https://github.com/honojs/middleware/blob/main/packages/otel/README.md)）。
- ヘルスチェックを除外すると、`@hono/otel` の span は `/health` でも作られる（span の除外の設定は 1.2.0 の型定義にない: `ignoreRoutes` などは見つからなかった）。ログと span で `/health` の扱いが分かれる。除外したい場合は、`@hono/otel` を `/health` より後ろの経路にだけ付けるか、Collector かサンプリングで落とす（判断。今回は動かしていない）。

## 4. マスク

### 規約

`security.md`: 機密情報をログに出さない。ログ出力のフレームワーク側でもマスキングやオミットする。機密フィールドを除外した DTO を作っておく。#148 は、ログのマスクを「発生源で載せない」と「CloudWatch Logs のデータ保護」で担うとした。

### 確かめた事実（`POST /secret` が出す値で、漏れた文字列を数えた）

出したもの: `password`、`token`、`http.request.header.authorization`（ドット入りのキー）、`Authorization`（大文字）、`nested.password`、`headers.authorization`、`headers.cookie`、`list[0].secret`、メッセージの文字列に入れたメールアドレスと JWT 風の文字列、例外のメッセージに入れた `password=...`。

| 出したもの                                                | 自作（キー名の deny list）         | pino の `redact`                                                                                            | LogTape の `redactByField`                                                                           |
| :-------------------------------------------------------- | :--------------------------------- | :---------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| `password`、`token`（最上位）                             | 隠れた                             | 隠れた（パスを列挙）                                                                                        | 隠れた（`fieldPatterns`）                                                                            |
| `http.request.header.authorization`（ドット入りのキー）   | 隠れた（最後の `.` の後で照合）    | 隠れた（`['"http.request.header.authorization"']` のように書く）                                            | 初めは漏れた（`/^authorization$/i` はキー全体に照合する）。`/authorization$/i` に直すと隠れた        |
| `Authorization`（大文字）                                 | 隠れた（大文字小文字を区別しない） | 漏れた（パスは大文字小文字を区別する。`authorization` と書いた場合）                                        | 隠れた（`/i`）                                                                                       |
| `nested.password`、`headers.*`、`list[*].secret`          | 隠れた（再帰）                     | 列挙したパスだけ隠れた。`*.password` は最上位の `password` に効かず（漏れた）、`nested.password` には効いた | 隠れた（再帰、既定で深さ 20 まで、各オブジェクトの要素 1,000 まで）                                  |
| メッセージの文字列に入れたメールアドレスと JWT 風の文字列 | 漏れた                             | 漏れた                                                                                                      | 漏れた（`redactByField` はキー名だけ。文字列には `redactByPattern` を formatter に重ねる必要がある） |
| 例外のメッセージの `password=hunter2`                     | 漏れた                             | 漏れた                                                                                                      | 漏れた                                                                                               |
| 隠さないキー（`nested.ok`）                               | 残った                             | 残った                                                                                                      | 残った                                                                                               |

- 出典: pino の redact は、パスが大文字小文字を区別し、`*` はその位置の 1 段だけを表し、パスは起動時の設定で、利用者の入力から作ってはいけない（[pino の Redaction](https://github.com/pinojs/pino/blob/main/docs/redaction.md)）。ワイルドカードは、明示したパスより遅い（文書の記述で、50% の例がある）。`pino@10.4.0` の依存は `@pinojs/redact` だが、文書は `fast-redact` と書く（`npm view pino dependencies` と文書の食い違い。動作には影響しなかった）。
- LogTape: フィールド名による redact（`redactByField`）は、名前を知っているデータだけで、メッセージの文字列は守れない。パターンによる redact（`redactByPattern`）は、整形後の文字列に正規表現をかけ、メールアドレス、クレジットカード番号、JWT、米国の SSN、韓国の住民登録番号の既定のパターンを持つ。日本のマイナンバー、電話番号などの既定はない。「完全な redact はない。最初から載せないほうがよい」と文書自身が書く（[Data redaction](https://logtape.org/manual/redaction)）。
- どの候補でも、`exception.message`（例外のメッセージ）と `exception.stacktrace` は、例外の内容をそのまま出す。`security.md` は「スタックトレースや DB の出力するエラーメッセージは攻撃のヒントになる」としてユーザー向けと分けるが、ログに出す側の redact は規約が求めていない。
- CloudWatch Logs のデータ保護（文書による）: ログ事象の取り込み時に、選んだ識別子（認証情報、財務、PII、PHI、デバイス識別子）を検出し、取り出し口（Logs Insights、metric filter、subscription filter）でマスクする。`logs:Unmask` の権限を持つ利用者は、マスクされていない値を見られる。ポリシーを設定する前に取り込まれたログはマスクされない（[Help protect sensitive log data with masking](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/mask-sensitive-log-data.html)）。文書の書き方から、保存されたデータ自体は変えず、表示の側で隠すと読める（私の解釈。保存の形は文書に明記がない）。
- 判断: 発生源で載せない、が基本で、ロガーの redact は「うっかり」への保険にとどまる。キー名による redact で止められるのは、秘匿するキーの名前を知っているものだけである。メッセージや例外のメッセージには、DB のエラーが接続文字列やパラメータを含めることがあるため、`exception.message` の扱いは別に決める必要がある。

### テストで確かめる方法

- 判断（今回の `check.mjs` と同じ形）: ログの出力を配列に集めるテスト用の sink（または stdout の取り込み）を用意し、秘匿する値を入れたデータをロガーに渡して、出力に目印の文字列（`-FIELD` など）が含まれないことを確かめる。値ごとに別の目印を入れると、どのパスが漏れたかが分かる。
- 出力する値の側のテスト（DTO の `toLog()` の戻りに秘匿するキーがない、など）は、ロガーの redact とは別の層で確かめられる。保証カタログ（#148 の 8）に載せるなら、検出力は「秘匿するキーを 1 つ足すと落ちる」fixture で確かめる（`vp check` の fixture と同じ考え方）。

## 5. 例外とエラー

### 規約

`keys.md`: `exception.type`、`exception.message`、`exception.stacktrace`、`event.kind`、`event.category`、`event.outcome`。`levels-and-notification.md`: WARN 以上は通知対象。`message-codes.md`: WARN 以上にメッセージコードを付ける。`web-api/observability.md`: 400 系は INFO、500 系の実装不備は ERROR。`messages.md`: ユーザー向けのメッセージとログは分け、トレース ID で紐づける。

### 確かめた事実

- `onError` で `log.error("unhandled exception", { "message.code": "API-E-0001", "exception.type": err.name, "exception.message": err.message, "exception.stacktrace": err.stack, ... })` を呼び、`application/problem+json`（`type`、`title`、`status`）を返す書き方が、3 候補とも動いた。ログの行には、そのリクエストの `trace_id`、`span_id`、リクエスト ID が付いた。
- アクセスログの応答時の行は、同じリクエストで `500` を記録した。つまり、500 のときは「例外の行（ERROR）」と「アクセスログの応答時の行（INFO）」の 2 行が出る。
- `@hono/otel` は、`c.error` があると span に `recordException` し、ステータスを ERROR にする。ログと span の両方に例外が残る（ソースを読んだ）。
- pino の組み込みの `err` serializer（`pino.stdSerializers.err`）は、`err` というキーに `type`、`message`、`stack` を入れる（[pino の API](https://github.com/pinojs/pino/blob/main/docs/api.md)）。`exception.type` などのキーにするには、自分で展開するか、`errorKey` と `formatters.log` を使う。今回は自分で展開した。LogTape は `Error` をプロパティに渡すと、プレーンなオブジェクトに直して出す（JSON Lines formatter の文書）。どちらも、`exception.*` のキーにする変換は自前である。
- 判断: Problem Details の応答（[#221](https://github.com/yokozi-jp/agent-software-factory/issues/221)）とログの分担は、次の形が自然に見える。応答には `type`、`title`、`status`、`code`（メッセージコード）、`trace_id` だけを出し、例外の内容、スタックトレース、DB のエラーはログにだけ出す（`messages.md` と `security.md` と同じ分離）。ログには同じ `message.code` と `trace_id` を出すと、利用者が持ってきたコードからログをたどれる。`message.code` は、メッセージ定義書（`message-codes.md`）の一覧から型で縛る（下の「6. 検査」の `LogFields` の例）と、定義にないコードが型エラーになる。
- 4xx の扱い: Hono の `HTTPException` や検証エラーは `onError` を通らない経路もある（#221 の領分）。この調査では、`onError` に届いた例外だけを確かめた。

## 6. 守らせる検査

### 確かめた事実（Oxlint 1.89.0、`vp` 1.4.0 が使う版。`/tmp/lint-exp` で実行）

設定: `no-console: error`、`no-restricted-globals`（`process`）、`no-restricted-imports`（`pino`）。

| 書き方                                   | 結果                                                                              |
| :--------------------------------------- | :-------------------------------------------------------------------------------- |
| `console.log("x")`、`console.error("y")` | 止まった（`no-console`）                                                          |
| `globalThis.console.warn("z")`           | 止まらなかった                                                                    |
| `const c = console; c.info("w")`         | 止まらなかった                                                                    |
| `process.stdout.write("direct\n")`       | 止まった（`no-restricted-globals` の `process`。ADR 0007 の設定にすでにある）     |
| `import pino from "pino"`                | 止まった（`no-restricted-imports`。入口とテスト以外で import させない設定になる） |

- `apps/web/src` には `no-console: error` がすでにある（`vite.config.ts`）。`apps/api/src` に同じ設定を足せる。`apps/api/src/server.ts`（入口）にある `console.log` は、ロガーに替えるまで違反になるので、入口を `lint.overrides` の除外に入れるか、ロガーに替える。
- 型でキー名を縛る（`tsc` 実行）: `LogFields` 型（キーは `"http.request.method"?: "GET" | "POST" | ...`、`"http.response.status_code"?: number`、`"message.code"?` は `API-E-1`、`BIZ-W-2` のような形のテンプレートリテラル型 など）を作り、`log.info(message: string, fields?: LogFields | (() => LogFields))` と宣言すると、次の 3 つが `tsc` で止まった。
  - `{ "http.request.methd": "GET" }`（綴りの誤り）: `TS2353`（Object literal may only specify known properties）。
  - `{ traceId: "a" }`（キー名の規約違反）: `TS2353`。
  - `{ "http.response.status_code": "200" }`（値の型の誤り）: `TS2322`。
- 型の限界（TypeScript の仕様。今回の実験では確かめた形のみ）: 余分なプロパティの検査はオブジェクトリテラルに対してだけ働く。スプレッド（`{ ...extra }`）や、変数に入れてから渡すと、余分なキーは止まらない（判断）。`keys.md` の拡張スキーマ以外のキー（`order.id` など、業務のキー）は、`LogFields` に足すか、`Record<string, ...>` を許すかで、検査の強さが変わる。
- 判断: キー名の検査は、(a) 型（`LogFields`）、(b) 実行時のテスト（ログの出力を集めて、キーが許可リストにあることを確かめる）、(c) 自作の Oxlint plugin（ADR 0019 と同じ形で、`log.info` の第 2 引数のキーを見る）の 3 つの層が考えられる。plugin は alpha 機能で保守が要る（ADR 0019 の Consequences）。型で足りるかどうかは、#229 で決める。
- ロガーを経由しない出力の禁止は、`console`（`no-console`）、`process.stdout`（`no-restricted-globals`）で、`apps/api/src` ではすでに近い状態にある。入口のファイルとテストは対象外なので、ロガーを組み立てる入口のコードは検査の外にある（判断。入口のコードを小さく保つ）。

## 7. 性能（非同期の出力、遅延評価、flush）

### 規約（`performance.md`）

非同期ロギング（Java の AsyncAppender）、遅延評価（プレースホルダー）、ログ出力の分岐、ループでのマシンガンログの禁止、ファイル名と行番号を出さない。「プロセス障害時のログ欠損に備え、シャットダウンフックでキュー内のログをフラッシュさせる」「キューが溢れた時の対応は、アプリケーションをブロッキングさせる。ログを破棄させる設定にはしない」。Go は非同期にしなくてもよい。

### 確かめた事実（5000 行 × 約 130 バイトを出し、`process.exit(0)` で終わる。pipe は `| wc -l`、遅い読み手は `| (sleep 0.5; wc -l)`）

| 書き方                                                                   | `process.exit` の前に flush なし、読み手が速い pipe | 同、遅い読み手 | ファイルへのリダイレクト |
| :----------------------------------------------------------------------- | :-------------------------------------------------- | :------------- | :----------------------- |
| `process.stdout.write`                                                   | 912〜5000 行（回ごとに違う）                        | 544 行         | 5000 行                  |
| `console.log`                                                            | 821〜5000 行（回ごとに違う）                        | 544 行         | 5000 行                  |
| pino（既定の宛先）                                                       | 5000 行                                             | 5000 行        | 5000 行                  |
| pino `pino.destination({ fd: 1, sync: true })`                           | 5000 行                                             | 5000 行        | 5000 行                  |
| pino `pino.destination({ sync: false, minLength: 4096 })`                | 5000 行                                             | 5000 行        | 5000 行                  |
| pino `pino.transport({ target: "pino/file" })`（worker thread）          | 5000 行                                             | 5000 行        | 5000 行                  |
| LogTape 同期の sink（`process.stdout.write`）                            | 5000 行                                             | 544 行         | 5000 行                  |
| LogTape `getStreamSink`（非ブロッキングなし）、flush なし                | 0 行                                                | 未計測         | 0 行                     |
| LogTape `getStreamSink` + `nonBlocking`（`bufferSize: 100`）、flush なし | 1 行                                                | 未計測         | 1 行                     |
| 同、`await dispose()` あり                                               | 300 行                                              | 未計測         | 未計測                   |
| 同、`await drain()` あり                                                 | 300 行                                              | 未計測         | 未計測                   |

- 読み方: `process.exit()` を呼ばずに、イベントループが空になって自然に終わる場合は、pino、`stdout.write`、`console.log` ともに 5000 行が出た。LogTape の非ブロッキング sink は、`dispose()` しないと自然には終わらず、15 秒の `timeout` に当たった（`rc=124`。`flushInterval` のタイマーが残るためと推測、未確認）。`dispose()` を呼ぶと終わった。
- Node の文書は、`process.stdout` と `process.stderr` の書き込みを「ファイル: 同期、TTY: POSIX では同期、pipe とソケット: POSIX では非同期」とし、`process.exit()` の前に非同期の書き込みが終わらないと書かれないことがあると書く（[A note on process I/O](https://nodejs.org/api/process.html#a-note-on-process-io)）。実験は、この記述と合う。pipe が詰まる条件は、ECS で `awslogs` の読み手が遅れたとき、Lambda でランタイムの読み手が遅れたときに起こり得るが、実際の起こりやすさは未確認。
- pino が失わなかった理由: `pino.destination({ sync: true })` は `sonic-boom` の同期書き込みで、読み手が詰まっていても書き終わるまで待つ。`sync: false` でも、`on-exit-leak-free`（pino の依存）が終了時に flush する（`package.json` の依存より。仕組みの詳細は読んでいない）。
- pino の文書は、Lambda での非同期ログについて「ランタイムが freeze される前に宛先へ書かれず、遅れるか失われやすい。Lambda では必ず `sync: true` の宛先を使う」と書く（[Asynchronous Logging](https://github.com/pinojs/pino/blob/main/docs/asynchronous.md)）。
- Lambda の freeze: Event Functions は、ランタイムと拡張がすべて完了を知らせて、未処理のイベントがなくなると、実行環境が freeze される（[Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)）。ハンドラーが返る前に、書き込みが終わっている必要がある。非同期の sink（pino の `sync: false`、LogTape の非ブロッキング）を使うなら、ハンドラーの最後で `flush`（pino は `logger.flush()`）か `drain()`（LogTape）を `await` する。LogTape は `fromAsyncSink` の `waitUntil` option（Vercel と Cloudflare 向けの例）を持つが、Lambda 向けの例はない。
- Web Functions の終了: `platform.spinDownReport` は、`SIGTERM` を受けてから 1 秒以内に終了しなかったことを失敗とする（[Web Function logs](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging.html)）。同期の書き込みなら、`SIGTERM` の処理で特別なことはいらない。非同期なら、1 秒以内に flush する必要がある。
- LogTape の非ブロッキング sink は、バッファが `bufferSize` の 2 倍を超えると、古い記録を捨てる。`onDrop` で件数を受け取れる（文書の「Buffer overflow protection」）。`performance.md` の「ログを破棄させる設定にはしない」に反する既定である。実験の 300 行は、5000 行を同期のループで出したため（実際の API の負荷とは違う）。
- 遅延評価: 3 候補とも、無効なレベル（`debug`）の行は出なかった（確かめた）。ただし、実験では引数のオブジェクトを呼び出し側が先に作っているので、「引数を作る費用」が省けるかは確かめていない。自作は `fields` に関数を渡せる形にしたが、この実験のシナリオでは関数を渡していない。pino の `isLevelEnabled` や LogTape の遅延評価（`lazy()` は context の値に使える形を確かめた）の文書は、この項目では読んでいない。
- `performance.md` の「ファイル名と行番号を出さない」は、pino の既定（出さない）で満たされる。LogTape は、`captureSourceLocation` を有効にした logger だけが場所を持つと formatters の文書にある（既定値は文書で確かめていない）。

## 食い違い（`docs/logging` と一次情報）

- `performance.md` は Java、Go、Python の記述が中心で、Node.js の記述がない。この調査で確かめた Node.js の事実（pipe の書き込みが非同期、`process.exit()` で失われる）は、`performance.md` にない。取り込んだガイドラインの範囲外の追記になるので、直さずに報告する。
- `keys.md` が `severity.text` を既定とするのに対し、Lambda の JSON ログ形式のレベル絞り込みは `level` を見る（文書による）。「ライブラリによっては `level` のままでも許容」と `keys.md` が書く。ただし、`web-api.md` の表は `severity.text` と書く。
- `messages.md` が悪い例とする `details` のネストを、`batch.md` が `batch.params` と `batch.stats` のオブジェクトで使う（規約同士の食い違い）。
- `field-list.md` が挙げる「ログ項目の一覧とライフサイクル」（暗黙と明示）は、この調査の `ambient()`（リクエスト ID、`tenant_id`、`user_id`、`trace_*`）と、`LogFields`（明示）の分け方と対応する。表そのものはまだない。
- pino の `redaction.md` が `fast-redact` と書くのに対し、`pino@10.4.0` の依存は `@pinojs/redact` である。pino 側の文書の遅れ。

## 比較表

凡例: ○ 確かめた、△ 設定や自前のコードが要る、× 合わない、? 未確認。

| 観点                                           | `hono/logger`                           | 自作（約 30 行）                            | pino 10.4.0                                                                                                                        | LogTape 2.4.2                                                                                             |
| :--------------------------------------------- | :-------------------------------------- | :------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `keys.md` のキー名で JSON Lines                | × 文字列のみ                            | ○                                           | △ `base`、`messageKey`、`timestamp`、`formatters.level` を設定。数値の `level` は直せる（複数 transport では直せない、文書による） | △ 組み込みの formatter は `@timestamp`、`level`、`logger`、`properties`。自前の formatter（約 15 行）で ○ |
| `trace_id`、`span_id`（`@opentelemetry/api`）  | ×                                       | ○                                           | ○ `mixin`                                                                                                                          | ○ 同期の sink の formatter か `lazy()`。非ブロッキングでは formatter 内は ×（`lazy()` で ○）              |
| `trace_flags`                                  | ×                                       | ○                                           | ○                                                                                                                                  | ○                                                                                                         |
| リクエストごとの項目（`tenant_id`、`user_id`） | ×                                       | ○ `tryGetContext()`                         | ○ `mixin`。`child()` は作成時の 1 回                                                                                               | ○ `withContext`（`contextLocalStorage` が要る）                                                           |
| ワーカー、バッチで同じ形                       | ×                                       | ○（判断）                                   | ○（判断）                                                                                                                          | ○ `withContext`（判断）                                                                                   |
| ADR 0007（アプリのコードに Node 固有がない）   | ○                                       | ○                                           | △ `pino.destination` と transport は入口に置く                                                                                     | △ `AsyncLocalStorage` と stdout の sink は入口に置く                                                      |
| Workers で動く                                 | ○                                       | ○                                           | ?（公式は Node 向け）                                                                                                              | ○（文書が対応と明記）。ただし context は `AsyncLocalStorage` が要る                                       |
| ECS で動く                                     | ○                                       | ○                                           | ○                                                                                                                                  | ○                                                                                                         |
| Lambda で動く（stdout）                        | ○                                       | ○                                           | ○（`sync: true`）                                                                                                                  | ○（同期の sink）                                                                                          |
| Lambda の JSON 形式との関係                    | ?                                       | ?                                           | ?                                                                                                                                  | ?                                                                                                         |
| 要求時と応答時の 2 行                          | × 要求時 `<--` と応答時 `-->`（文字列） | ○                                           | ○（自作の middleware）                                                                                                             | ○（自作）。`honoLogger` は 1 行のみ（`logRequest`）                                                       |
| `/health` 除外、`OPTIONS` を出す               | ×                                       | ○                                           | ○（自作の middleware）                                                                                                             | ○ `honoLogger` の `skip` か自作                                                                           |
| redact（キー名）                               | ×                                       | ○ 自前（deny list）                         | ○ `redact`（大文字小文字を区別、`*` は 1 段）                                                                                      | ○ `redactByField`                                                                                         |
| redact（文字列）                               | ×                                       | ×（自前の正規表現）                         | ×                                                                                                                                  | △ `redactByPattern`（メール、カード番号、JWT など）                                                       |
| `exception.*`                                  | ×                                       | ○ 自前                                      | △ `err` serializer を `exception.*` に展開                                                                                         | △ 自前                                                                                                    |
| `process.exit()` 前の取りこぼし                | ×（`console.log`。pipe で取りこぼした） | △ 同期の書き込みを自前（pipe が詰まると ×） | ○ 既定と `sync: true` は取りこぼしなし                                                                                             | △ 同期の sink は pipe で ×。非ブロッキングは溢れると捨てる                                                |
| 遅延評価（引数を作る費用を省く）               | ×                                       | △ 関数で渡す設計（未実測）                  | △ 無効なレベルは出ない。引数を作る費用は未確認                                                                                     | △ 無効なレベルは出ない。`lazy()` は context の値に使える                                                  |
| 依存の数                                       | 0（Hono に含む）                        | 0                                           | 直接 11                                                                                                                            | 0（拡張は別パッケージ）                                                                                   |
| 型でキー名を縛る                               | ×                                       | ○ 自前の `Logger` 型                        | ○ 自前の `Logger` 型を被せる                                                                                                       | ○ 同左                                                                                                    |
| 保守の負担                                     | 小さい                                  | 自前のコードを持つ                          | 設定が多い（`formatters`、`mixin`、`redact`）                                                                                      | 自前の formatter と sink                                                                                  |

「型でキー名を縛る」は、どの候補でも `Logger` のインターフェースを自分で定義して、実体の前に置くことで実現する（確かめた形は `LogFields` の例）。

## 決めるべき論点（#229 に渡す）

1. ロガーを、(a) 自作、(b) pino、(c) LogTape から選ぶ。`hono/logger` は規約に合わないので候補から外れる。判断の軸: キー名の設定の量、`process.exit()` 前の取りこぼし、依存の数、Workers への可搬性、保守の負担。
2. アプリのコードがロガーの実体を知らない `Logger` のインターフェース（`LogFields` の型つき）を `apps/api/src` に置くか。置くなら、型の範囲（`keys.md` の拡張スキーマ、業務のキー、メッセージコードの型）をどうするか。
3. Lambda（Event Functions、Web Functions）で、stdout の JSON の行をそのまま書くか、`console` にオブジェクトを渡すか。Web Functions は `message` の下に入る。検証環境で実機の出力を確かめる前提で、ログの出力先の関数を入口で差し替えられる形にしておくか。
4. `severity.text` と `level` のどちらを出すか（Lambda の `applicationLogLevel` の絞り込みが `level` と `timestamp` を見る）。`keys.md` は `level` も許容している。Event Functions の JSON ログ形式と Web Functions の `applicationLogLevel` を使うかどうかとも関係する。
5. `trace_flags` を載せるか。OTel の仕様は 3 つとも省略可。`keys.md` の共通スキーマに足す必要があるか。
6. リクエストごとの項目の取り方: `hono/context-storage`（`tryGetContext()`）に統一するか。ワーカーとバッチの `AsyncLocalStorage` を自分で持つか。`hono/context-storage` は Workers で `nodejs_compat` か `nodejs_als` が要る。
7. アクセスログの middleware を自作するか。`honoLogger`（`@logtape/hono`）を使うなら、2 行の規約をどうするか。`@hono/otel` の後ろに置く順序の検査（順序を誤ると `trace_id` が付かない）をテストで固定するか。
8. `/health` を `@hono/otel` の span から外すか（外すなら方法）。
9. マスク: キー名の redact を何で持つか（ロガーの redact か、自前の deny list）。メッセージと `exception.message` の中身をどう守るか（載せない、型で縛る、`redactByPattern` を重ねる）。`exception.stacktrace` を本番で出すか。テスト（目印の文字列）を保証カタログに載せるか。
10. 非同期の出力: 同期の書き込み（pino の `sync: true`、自作の同期）を既定にするか。非同期の sink を使うなら、Lambda でハンドラーの最後に `flush` か `drain` を `await` する置き場所（入口）と、`SIGTERM`（ECS、Web Functions の 1 秒）の処理。バッファが溢れたときの扱い（`performance.md` は捨てないとする）。
11. 検査: `apps/api/src` に `no-console` を足すか。`globalThis.console` と別名の抜け穴を、自作の plugin（ADR 0019 と同じ形）で塞ぐか。キー名は型だけで足りるか、plugin やテストも要るか。
12. メッセージコード（`message.code`）の付け方: 定義書（`message-codes.md`）から型を作るか、手で書くか。API のエラー応答の `code`（#221）と同じ表にするか。
13. 規約の側の修正（取り込んだガイドラインの範囲外なので、合意が要る）: `performance.md` に Node.js の節を足すか。`batch.md` の `batch.params` のネストを直すか。`keys.md` に `trace_flags` を足すか。
14. `@opentelemetry/instrumentation-pino` を使うか（pino を選んだ場合）。使えば `trace_id`、`span_id`、`trace_flags` を自動で足す（キー名は `logKeys` で変えられる）が、ESM では import の順序に注意が要り、`@opentelemetry/api` の peer が `^1.10.0` で、今の `sdk-trace-base@2.12.0` の peer と合わない。`mixin` で自前に足す方法は、実験で動いた。

## 未確認のこと

- AWS の上での、Lambda Event Functions と Web Functions の実際の出力の形。特に、Web Functions で stdout に書いた JSON の行がトップレベルの項目として残るか、`message` の文字列になるか。Event Functions で `process.stdout.write` の JSON の行が JSON ログ形式でどう扱われるか。`severity.text` のとき `applicationLogLevel` が効くか。
- CloudWatch Logs Insights が、ドットを含むキー（`http.request.method` のような 1 つのキー）を、ネストしたオブジェクトと同じ記法（ドット）でどう扱うか。文書は「JSON のフィールドはドット記法で表す」とだけ書く（[Fields in JSON logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_AnalyzeLogData-discoverable-fields.html)）。
- `@opentelemetry/instrumentation-pino` と `hono-pino` は動かしていない。
- Cloudflare Workers での pino と LogTape の動作。
- ECS で `awslogs` の読み手が遅れたときの、実際の取りこぼしの起こりやすさ。`process.exit()` を呼ばずに、`SIGTERM` で終わる普通の停止では、実験で試していない。
- `logRequest: true` の `honoLogger`。要求時と応答時の 2 行が出せるかは、型定義の記述のみ。
- 性能の数値（行あたりの時間、CPU）は計っていない。`performance.md` の非同期ロギングが Node.js で要るかどうかは、数字では確かめていない。
- Oxlint の `no-console` の `globalThis.console` と別名の抜け穴が、Oxlint の新しい版で塞がるか。
- 日本の個人情報（マイナンバー、電話番号）向けの `redactByPattern` のパターンは、自作が要る（既定の一覧にない）。それが実用になるかは確かめていない。

## 出典

- このリポジトリ: [AGENTS.md](../AGENTS.md)、[ADR 0007](../docs/adr/0007-api-on-node-web-standard-app.md)、[ADR 0013](../docs/adr/0013-api-on-ecs-and-lambda-web-functions.md)、[ADR 0019](../docs/adr/0019-custom-oxlint-plugin-for-xss.md)、`docs/logging/`（`keys.md`、`web-api.md`、`security.md`、`levels-and-notification.md`、`performance.md`、`messages.md`、`message-codes.md`、`format.md`、`batch.md`、`startup.md`、`field-list.md`）、[Issue #148](https://github.com/yokozi-jp/agent-software-factory/issues/148)（解決コメント）、[Issue #199](https://github.com/yokozi-jp/agent-software-factory/issues/199)、[Issue #221](https://github.com/yokozi-jp/agent-software-factory/issues/221)、[Issue #228](https://github.com/yokozi-jp/agent-software-factory/issues/228)
- pino: [API](https://github.com/pinojs/pino/blob/main/docs/api.md)、[Redaction](https://github.com/pinojs/pino/blob/main/docs/redaction.md)、[Asynchronous Logging](https://github.com/pinojs/pino/blob/main/docs/asynchronous.md)、[Transports](https://github.com/pinojs/pino/blob/main/docs/transports.md)
- LogTape: [Introduction](https://logtape.org/intro)、[Contexts](https://logtape.org/manual/contexts)、[Sinks](https://logtape.org/manual/sinks)、[Formatters](https://logtape.org/manual/formatters)、[Data redaction](https://logtape.org/manual/redaction)、[@logtape/hono](https://www.npmjs.com/package/@logtape/hono)
- Hono: [Logger のソース](https://github.com/honojs/hono/blob/main/src/middleware/logger/index.ts)、[Context Storage Middleware](https://hono.dev/docs/middleware/builtin/context-storage)、[@hono/otel の README](https://github.com/honojs/middleware/blob/main/packages/otel/README.md)
- OpenTelemetry: [Trace Context in non-OTLP Log Formats](https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/)、[instrumentation-pino の README](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/packages/instrumentation-pino/README.md)
- Node.js: [A note on process I/O](https://nodejs.org/api/process.html#a-note-on-process-io)
- AWS: [Log and monitor Node.js Lambda Event Functions](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html)、[Configuring JSON and plain text log formats](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-logformat.html)、[Web Function logs in Amazon CloudWatch Logs](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging.html)、[Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)、[Send Amazon ECS logs to CloudWatch](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_awslogs.html)、[Help protect sensitive log data with masking](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/mask-sensitive-log-data.html)、[CloudWatch Logs Insights の discoverable fields](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_AnalyzeLogData-discoverable-fields.html)
- 実験: `/tmp/hono-log-exp`（`src/custom.mjs`、`src/pino.mjs`、`src/logtape.mjs`、`src/app.mjs`、`src/drive.mjs`、`src/flush.mjs`、`check.mjs`）と `/tmp/lint-exp`（Oxlint 1.89.0 と `tsc`）。リポジトリには入れていない。
