# ワーカーとバッチを Hono のアプリとして書く案の標準とアンチパターンを調べる（ECS の常駐、Lambda Event Functions と Web Functions、Step Functions の RunTask）

## 問い

[Issue #348](https://github.com/yokozi-jp/agent-software-factory/issues/348) の調査。ワーカー（SQS のメッセージを処理する）とバッチ（締め）を Hono のアプリとして書く案を、一次資料で調べる。次の 2 つの形を比べる。

1. **処理を Hono の route にし、入口は変換だけにする**: ECS のワーカー、Lambda Event Functions の `handler(event)`、Step Functions の RunTask で起動する ECS のタスクが、メッセージや引数を `Request` に変えて `app.request()` で呼ぶ。API と同じ middleware が使えるか。Hono に公式の形や事例があるか。失敗を `batchItemFailures` やタスクの終了コードにどう戻すか。
2. **ワーカーを HTTP で待ち受けるサービスにし、push で受ける**: Lambda Web Functions を SQS から起動できるか。EventBridge Pipes や API destinations から HTTP で受けられるか。ECS で HTTP のワーカーにする構成があるか。VPC の中の DB、FIFO の順序、再試行と DLQ との関係。

どちらも ADR 0013 の入口の形と比べ、変える場合に ADR 0013 のどこが変わるかを書く。決定はここでは下さない。

調べた日は 2026-10-29。AWS アカウントはまだないので、AWS の上ではなにも実行していない。Hono 側は `/tmp` に入れた hono 4.13.14、`@hono/aws-lambda` 1.0.1、`@hono/otel` 1.3.0、`@aws-lambda-powertools/batch` 2.36.0（どれも npm の最新）で動かして確かめた。リポジトリの中には `node_modules` を足していない。

## 要約

- 確かめた事実: Hono の公式の資料に、非 HTTP のイベントを `app.request()` で route に流す形は書かれていない。Hono のメンテナーは、scheduled event を Hono の route に流す機能を「fetch event と scheduled event は別物」として計画しないと答えている（[honojs/hono#492](https://github.com/honojs/hono/issues/492)）。`app.request()` は公式に「テストに便利な method」と説明されている。非 HTTP のイベントについて公式にあるのは、Cloudflare Workers で `fetch: app.fetch` と並べて `scheduled` などの handler を export する形だけで、その handler は route を通らない。Lambda の SQS、EventBridge、Step Functions の事例は、Hono の資料にも AWS の資料にも見つからなかった。この形は標準ではなく、自前の設計になる。
- 確かめた事実: `@hono/aws-lambda` の `handle(app)` は API Gateway（v1、v2）、ALB、VPC Lattice のイベントだけを扱う。SQS のイベントを渡すと、例外にならず `{"statusCode":404,...}` を返す。AWS の Knowledge Center は、`{"Key1":"Value1"}` のような「期待しない JSON」の応答を、バッチ全体の成功として扱うと書く。`{"statusCode":404,...}` はこれに当たると読める（AWS の上では未実行）。この読みでは、メッセージは再試行されずに消える。SQS の Event Function に `handle(app)` をそのまま使うのはアンチパターンになる。
- 確かめた事実: Issue 本文の `hono/aws-lambda` は、hono 4.13.14 で非推奨（v5 で削除予定）。`@hono/aws-lambda` に移っている。
- 確かめた事実（形 1 の middleware）: `hono/logger`、`onError`、`@hono/otel` の `httpInstrumentationMiddleware` は、`app.request()` で呼んでも動いた。`@hono/otel` は request の header から親の trace を取り出すので、SQS のメッセージ属性の `traceparent` を header に写せば、API と同じ形でつながる。span の名前は `POST /route`、属性には合成した URL が入る。認証、CSRF、CORS などの HTTP 固有の middleware は、ワーカーでは意味がない。
- 確かめた事実（形 2）: Lambda Web Functions を SQS の event source mapping の対象にする方法は、文書にも API の定義にもない。Web Functions の文書は、キューのメッセージの処理には Event Functions を使うよう書く。EventBridge Pipes は SQS（標準と FIFO）を読み、API destination に HTTP で送れる。ただし API destination は 5 秒で timeout し、認証は Basic、OAuth、API キーだけで SigV4 は使えない。Web Functions の endpoint は `ApplicationManaged` なら署名なしで受けられる。
- 確かめた事実（形 2 の経路）: API destination の connection は、VPC Lattice の resource configuration を指定すると VPC の private な HTTPS endpoint（ALB の後ろのアプリなど）に届く。ただし private API でも、公開のドメイン名と公的に信頼された証明書が要る。以前の版の「VPC の中の endpoint には届かない」は誤りで、この版で直した。
- 確かめた事実（4xx と停止）: API destination は 401、407、409、429、5xx を再試行し、それ以外の 4xx は再試行しない。Pipes が再試行しない 4xx の後で SQS のメッセージをどうするかは、文書にない。Web Functions は停止の前に SIGTERM を送り、後始末に使える時間は 1 秒。
- 判断: 形 1 は ADR 0013 の入口の形（ECS は SQS を読む繰り返し、Lambda は `handler(event)`、締めは RunTask）を変えずに、入口の中身を薄くする案になる。ADR 0013 より ADR 0028 の「`ManagedRuntime` を入口ごとに 1 つ」の書き方が変わる。形 2 は、Event Functions と SQS の部分的な失敗の応答、ECS の SQS を読む繰り返し、VPC に入れた Event Functions を、公開の HTTP endpoint と Pipes に置き換える案で、ADR 0013 の非同期の節がほぼ書き直しになる。
- 判断: 形 1 で API と共有できるのはログと OpenTelemetry とエラーの変換くらいで、得るものは小さい。形 2 は 5 秒の制約と、公開の endpoint（Web Function の場合）か VPC Lattice の resource configuration（ECS の場合）が増える。どちらも今の ADR 0013 より優れているとは、この調査では言えない。決めるべき論点は末尾に並べた。

## 今の ADR が決めていること

- ADR 0013: 入口は API の `server.ts`、ECS のワーカー（SQS を読む繰り返し）、Lambda のワーカー（Event Functions の `handler(event)`、`batchItemFailures` を返す）、締めのバッチ。締めは EventBridge Scheduler → Step Functions → RunTask の ECS のタスクだけ。非同期は Outbox → SQS の FIFO（DLQ あり）。FIFO を読む Event Functions は最初の失敗で止め、残りを `batchItemFailures` に入れる。Event Functions は VPC に入れ、外向きは IPv6。
- ADR 0028: Effect は application と infrastructure で使い、実行は `http`、入口、テストだけ。`ManagedRuntime` は入口ごとに起動時に 1 つ作り、`app.ts` とワーカーの handler に渡す。
- ADR 0032: 環境変数は入口が読んで検査し、`createApp` に引数で渡す。`c.env` と `process` は入口以外で読まない。
- [Issue #86](https://github.com/yokozi-jp/agent-software-factory/issues/86) の調査（`research/lambda-web-functions`）: Web Functions は `AWS_LAMBDA_HTTP_ENDPOINT` を listen する HTTP サーバー。Event Functions の SQS の FIFO で `ReportBatchItemFailures` が使える。FIFO では最初の失敗で止め、残りを全部返す。同時実行数は message group の数と maximum concurrency の小さい方まで。
- `apps/api/src/server.ts` は今、`createApp({ auth, databases })` を作って `serve()` するだけの入口で、ワーカーの入口はまだない（`apps/` は `api` と `web` だけ）。

## 形 1: 処理を Hono の route にし、入口は変換だけにする

### Hono に公式の形があるか（確かめた事実）

- `app.request(input, requestInit, Env, executionCtx)` は、`Request` か path を受けて `Response` を返す。公式は「`request` is a useful method for testing」と書く（[Hono: API](https://hono.dev/docs/api/hono)）。第 3 引数の `Env` は `c.env` になる。第 4 引数を渡さないと `c.executionCtx` は例外になる（実行して確かめた: `This context has no ExecutionContext`）。
- 公式の Lambda の頁は、API Gateway、ALB、Function URL の HTTP の入口として `handle(app)` を説明する。`c.env.event` と `c.env.lambdaContext` で Lambda のイベントとコンテキストを読める（[Hono: AWS Lambda](https://hono.dev/docs/getting-started/aws-lambda)）。非 HTTP のイベントを route に流す形は書かれていない。
- `handle()` の実装（hono 4.13.14 の `src/adapter/aws-lambda/handler.ts`）は、`getProcessor(event)` で ALB、API Gateway v2、VPC Lattice を見分け、どれでもなければ API Gateway v1 として扱う。SQS のイベント（`{ Records: [...] }`）を渡して実行したところ、例外にならず `{"body":"404 Not Found","statusCode":404,...}` が返った。`@hono/aws-lambda` 1.0.1 の `handle` も同じ形で、`Records` を見ていない。
- 同じ hono 4.13.14 では `hono/aws-lambda` に `@deprecated ... will be removed in v5. Install @hono/aws-lambda` が付く。`@hono/aws-lambda` の README に移行の手順がある。
- Cloudflare Workers の頁に「Using Hono with other event handlers」があり、`export default { fetch: app.fetch, scheduled: async (batch, env) => {} }` の形を示す（[Hono: Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)）。`scheduled` の中身は route を通らない。
- Hono の Best Practices は「Rails 風の Controller を作らず、path の定義の直後に handler を書く」と勧める（[Best Practices](https://hono.dev/docs/guides/best-practices)）。入口が薄く、処理が application にある ADR 0028 の形とは矛盾しない。route の handler は application の関数を呼ぶだけにできる。
- 事例: Hono の公式、`honojs/middleware`、AWS の資料を探して、SQS や Step Functions の入口から `app.request()` を呼ぶ例は見つからなかった。見つからなかったことは、あることの否定にはならない。検索の範囲は次のとおり（2026-10-29、`gh` で実行）。
  - `gh search code`: `app.request SQSEvent hono`、`app.request batchItemFailures`、`hono SQSHandler app.request`、`hono app.request EventBridgeEvent`、`hono SQSEvent`、`app.request SQSBatchResponse`、`hono batchItemFailures` は、どれも 0 件。`SQSEvent` だけの検索は結果が出る（Hono と組み合わせた例は出ない）。
  - `gh search repos`: `hono sqs worker`、`hono lambda sqs handler app.request`、`hono non-http event` は 0 件。
  - `honojs/hono` の Issue: `SQS`、`EventBridge`、`scheduled`、`queue handler`、`Lambda event` で検索した。関係するのは [#3180](https://github.com/honojs/hono/issues/3180)（2024-07、open、Lambda adapter が S3、EventBridge、関数の直接呼び出しのトリガーを扱えない。貢献者が「公式の adapter は HTTP request を前提にすべき」と答えた）、[#492](https://github.com/honojs/hono/issues/492)と[#581](https://github.com/honojs/hono/issues/581)（どちらも closed。scheduled event を Hono に載せる要望。メンテナーは `export default { fetch: app.fetch, scheduled }` の形を示し、scheduled の対応は計画しないと答えた）。`honojs/middleware` と `honojs/website` では、`SQS`、`EventBridge` の検索で関係する Issue が 0 件（一部の検索は GitHub API の EOF で失敗し、再試行しても結果が出なかった）。
  - `honojs/hono` の Discussions（GraphQL の search）: `SQS` は 0 件。`queue consumer` で出た [#1163](https://github.com/orgs/honojs/discussions/1163)、[#2282](https://github.com/orgs/honojs/discussions/2282)、[#3280](https://github.com/orgs/honojs/discussions/3280) と、Issue [#2396](https://github.com/honojs/hono/issues/2396) は Cloudflare Queues の話で、メンテナーの答えは `export default { fetch: app.fetch, async queue() {} }` と、queue の handler を route の外に置く形だった。
  - AWS Powertools for AWS Lambda (TypeScript): `aws-powertools/powertools-lambda-typescript` のコード検索で `hono` は CHANGELOG とテストの依存の記述にしか出ない。HTTP 用の `event-handler` パッケージは Hono でなく、Powertools 自前の `Router` で `app.resolve(event, context)` を呼ぶ（[Event Handler: HTTP API](https://docs.aws.amazon.com/powertools/typescript/latest/features/event-handler/http/)）。SQS には別の `batch` パッケージを使う。Hono の app を非 HTTP のイベントに使う資料は見つからなかった。
  - 判断: 見つかったのは、非 HTTP のイベントを route の外の handler で受ける形（Cloudflare）と、Hono が非 HTTP のイベントを扱わない方針だけだった。形 1 の「route に流す」は、公開された事例のない自前の設計として扱う。

### 入口の変換（実行して確かめた小さな試作）

SQS のレコードを `Request` に変え、`app.request()` を呼び、`Response` の status を `batchItemFailures` に戻す。`/tmp` で動かした（Node.js 24.22.1）。

```ts
const toRequest = (r: SQSRecord) =>
  new Request(`http://worker.internal/messages/${r.messageAttributes.type.stringValue}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sqs-message-id": r.messageId },
    body: r.body,
  });

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: { itemIdentifier: string }[] = [];
  let stopped = false;
  for (const r of event.Records) {
    if (stopped) {
      failures.push({ itemIdentifier: r.messageId });
      continue;
    } // FIFO: 最初の失敗で止める
    const res = await app.request(toRequest(r));
    if (res.status >= 500 || res.status === 409) {
      failures.push({ itemIdentifier: r.messageId });
      stopped = true;
    }
  }
  return { batchItemFailures: failures };
}
```

- 3 件（2 件目が DB の故障の 500）を渡すと `{"batchItemFailures":[{"itemIdentifier":"2"},{"itemIdentifier":"3"}]}` が返った。handler が投げた例外は、`app.onError` か Hono の既定の処理が 500 の `Response` にするので、`app.request()` から呼び出し側へは投げ上がらない。
- 判断: この変換は 20 行ほどで、`http` 層の route が application の関数を呼ぶ形は ADR 0028 と合う。ただし、status と「再試行するか」の対応（409 や 400 を再試行するか）は HTTP の意味から自動では決まらない。route ごとに決めて、変換の側に持つことになる。

### middleware（確かめた事実）

| middleware                                      | `app.request()` で動くか | 備考                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hono/logger`                                   | 動く                     | `<-- POST /path` と `--> POST /path 200 9ms` を出す。message id は header に入れて自前のログに足さないと残らない                                                                                                                                                     |
| `app.onError`                                   | 動く                     | 例外を 500 の `Response` に変える。入口が status を見て `batchItemFailures` や終了コードにする                                                                                                                                                                       |
| `@hono/otel` の `httpInstrumentationMiddleware` | 動く                     | span は `POST /jobs/ship-outbox/:id`（kind は SERVER）で、`http.route`、`http.response.status_code`、`url.full` が付く。500 のとき status は ERROR。`propagation.extract(context.active(), c.req.header())` で親を取るので、`traceparent` を header に写せばつながる |
| 認証、CSRF、CORS、rate limit、Cookie            | 意味がない               | HTTP の利用者のためのもので、ワーカーでは使わない                                                                                                                                                                                                                    |

- 出典: `/tmp` での実行（`@hono/otel` の `dist/index.mjs`、`InMemorySpanExporter` で span を読んだ）。[`@hono/otel` の README](https://www.npmjs.com/package/@hono/otel)。
- 判断: 共有できるのはログ、OpenTelemetry、エラーの変換で、すべて数行で足せる。span の `url.full` と `server.address` には、入口が合成した URL が入る。host を固定の値にしておかないと、集計の key がばらつく。
- ADR 0028 は「Tracer と `@hono/otel` の span のつなぎ方」を [Issue #148](https://github.com/yokozi-jp/agent-software-factory/issues/148) に残している。形 1 を採るなら、ワーカーの span もこの Issue の範囲に入る。

### Lambda Event Functions（SQS）

- 部分的な失敗の応答は、event source mapping の `FunctionResponseTypes` に `ReportBatchItemFailures` を指定して有効にする。関数は `{ "batchItemFailures": [{ "itemIdentifier": "<messageId>" }] }` を返す（[Handling errors for an SQS event source](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)）。
- FIFO では、関数は最初の失敗の後を処理せず、失敗したものと未処理のものを全部 `batchItemFailures` に入れる（同）。
- 空の `batchItemFailures` と `null` の `batchItemFailures` は、バッチ全体の成功として扱われる（同）。AWS の Knowledge Center は、さらに `{}` と `{"Key1":"Value1"}`（`batchItemFailures` を持たない JSON）も、バッチ全体の成功として挙げる（[How do I troubleshoot Lambda function Amazon SQS ReportBatchItemFailures response types?](https://repost.aws/knowledge-center/lambda-sqs-report-batch-item-failures)）。確かめた事実: `handle(app)` が SQS のイベントに返す `{"body":"404 Not Found","statusCode":404,...}` は `batchItemFailures` を持たない JSON なので、この文書の「期待しない JSON」に当たると読める。この場合、メッセージは再試行されず、SQS から削除される。AWS の上では実行していない。Lambda の文書と Knowledge Center は、不正な JSON（`"Hello world"` など）の扱いで食い違う（Lambda の文書は complete failure、Knowledge Center は同じ例を成功の見出しの下に置く）。`statusCode` の object は有効な JSON なので、この食い違いには当たらない。
- Powertools for AWS Lambda（TypeScript）の `@aws-lambda-powertools/batch` に `processPartialResponse` と `SqsFifoPartialProcessor` がある。FIFO では、既定で最初の失敗で止め、残りを失敗にする。パッケージの実装のコメントと export で確かめた。
- 判断: 変換の中に `batchItemFailures` の組み立てがあるので、Powertools を使うかは形 1 と独立に決められる。Powertools の `recordHandler` の中で `app.request()` を呼ぶ形もとれる。

### ECS のワーカー（SQS を読む繰り返し）

- ECS の公式は、SQS のワーカーを service として置き、backlog per task（`ApproximateNumberOfMessagesVisible` を running task 数で割った値）で target tracking の scaling をする形を示す。scale-in の前に、処理中のタスクを task scale-in protection で守るよう勧める（[Scale Amazon ECS services based on an Amazon SQS queue](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-queue.html)）。これは形 1 でも形 2 でも変わらない、ワーカーの運用の標準。
- 止めるときは、コンテナに SIGTERM を送り、task definition の `StopTimeout` の後に SIGKILL を送る（[Amazon ECS task lifecycle](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html)）。ADR 0028 の `ManagedRuntime` の `dispose` は、この SIGTERM で呼ぶ。
- 判断: 繰り返しの中で `ReceiveMessage` → 変換 → `app.request()` → `DeleteMessage`（成功か恒久の失敗のとき）とするだけで、形は Lambda と同じになる。Lambda と違い、`batchItemFailures` の代わりに、削除するかどうかを入口が決める。

### Step Functions から RunTask で起動する ECS のタスク

- `arn:aws:states:::ecs:runTask.sync`（Run a Job）が使える。`Overrides.ContainerOverrides` の `Command` と `Environment` でタスクに引数を渡せる。`RunTask` が HTTP 200 で `Failures` を返したときは、`AmazonECS.Unknown` でタスクの state が失敗する（[Run Amazon ECS or Fargate tasks with Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html)）。
- 判断: 入口は `process.argv` か環境変数を読み、`Request` に変えて `app.request()` を呼び、`res.ok` なら終了コード 0、そうでなければ 1 にする（試作で、500 のとき `1` になることを確かめた）。
- 終了コードと `.sync` の state の関係は、別の調査（[Issue #349](https://github.com/yokozi-jp/agent-software-factory/issues/349)）が担当する。#349 の調査を参照。この調査では扱わない。
- 締めは、日付などの引数を route の path か body に載せる形になる。Step Functions の入力は 256 KB まで（[EventBridge Pipes targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-event-target.html) の payload の節）。

### 形 1 の標準とアンチパターン（まとめ）

- 標準と言える部分（一次情報あり）: 部分的な失敗の応答（Lambda の文書）、backlog per task の scaling と scale-in protection（ECS の文書）、`runTask.sync` と overrides（Step Functions の文書）、`app.request()` でアプリを呼ぶこと自体（Hono の文書はテスト用と説明）。
- 標準と言えない部分: 本番の入口で `app.request()` を使うこと、SQS や Step Functions のイベントを route に流すこと。公式の事例が見つからず、判断になる。
- アンチパターン（確かめた事実 + 判断）: SQS の Event Function に `handle(app)` をそのまま使う（404 を返し、判断として `ReportBatchItemFailures` の下で消える）。API と同じ `app` に job 用の route を置き、CloudFront の `/api/*` から外に見せる（判断: 面が増える。worker 専用の `createWorkerApp` にして、`apps/api` の `createApp` と分ける）。

## 形 2: ワーカーを HTTP で待ち受けるサービスにし、push で受ける

### Lambda Web Functions を SQS から起動できるか

- 確かめた事実: 文書で SQS の event source mapping を説明するのは Event Functions の側で、"Lambda Event Function and the Amazon SQS queue must be in the same AWS Region"（[Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)）。Web Functions の文書に、SQS から起動する記述は見つからなかった。Web Functions の文書は、キューのメッセージやファイルのアップロードなどのイベント処理には Event Functions を使うよう書く（[AWS Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)）。Web Functions は HTTPS の endpoint を持ち、`HTTP requests and responses` の頁は HTTP/1.1 の request を受ける形だけを説明する（[HTTP requests and responses](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-http.html)）。
- 確かめた事実（API の定義）: `CreateEventSourceMapping` の `FunctionName` は、関数名、関数の ARN、version か alias の ARN、部分的な ARN を受け、pattern は `(function:)?([a-zA-Z0-9-_\.]+)(:(\$LATEST(\.PUBLISHED)?|[a-zA-Z0-9-_]+))?` を含む。`EventSourceArn` は SQS のキューの ARN を受ける（[CreateEventSourceMapping](https://docs.aws.amazon.com/lambda/latest/api/API_CreateEventSourceMapping.html)）。Web Function の ARN は `arn:aws:lambda:<region>:<account>:web-function/<name>` で、`/` を含む。判断: この ARN は `FunctionName` の pattern に合わず、受け付けられないと読める。AWS CLI（2.39.0）の `aws lambda-web` の command 一覧（`create-web-function`、`create-web-function-endpoint`、`put-resource-policy` など 23 個）に、event source mapping を作る command はない（[lambda-web](https://docs.aws.amazon.com/cli/latest/reference/lambda-web/index.html)）。AWS の API を呼んで拒否されることは確かめていない（この環境は `aws` の実行が禁止）。
- 確かめた事実（resource-based policy）: Web Function の resource-based policy は `PutResourcePolicy`、`GetResourcePolicy`、`DeleteResourcePolicy` で管理し、`AddPermission`、`RemovePermission`、`GetPolicy` は使えない。AWS service に許す例は CloudFront の `lambda:InvokeWebFunctionEndpoint` だけで、`aws:SourceArn` で絞る。`Principal: "*"` のような public な policy は `ValidationException` で拒否される（[Lambda Web Function permissions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-permissions.html)）。判断: Pipes や event source mapping が Web Function を呼ぶための action と principal の例は、文書にない。
- 確かめた事実: endpoint の `AuthType` は `IamAuth`（SigV4 の署名が要る。CloudFront は代わりに署名できる）と `ApplicationManaged`（Lambda は認証せず、全部の request が関数に届く。公開の endpoint 向け）の 2 つ（[Lambda Web Function endpoint access control](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html)）。`ApplicationManaged` は CloudFront の後ろに置いても、自分のドメインで公開のまま届く。
- 確かめた事実（#86 の調査）: Web Function の同時実行は 1 つの実行環境で最大 64、`maxEnvironments` の最小は 2、リクエストの `timeoutSeconds` は既定 30 秒で最大 900 秒。VPC の DB へは egress network connector を付けて届く。

### EventBridge Pipes と API destinations

- Pipes の source は SQS の標準キューと FIFO キュー。target に API destination、API Gateway、Lambda、Step Functions、ECS task などがある（[Amazon SQS as a source](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-sqs.html)、[Pipes targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-event-target.html)）。target に Lambda Web Functions はない。
- API destination は、5 秒の client execution timeout を持つ。5 秒を超えると timeout にして再試行する。再試行の回数と期間は、pipe では source の種類と設定が決める。private API でも、使えるのは公開のドメイン名と公的に信頼された証明書の HTTPS endpoint だけで、mTLS は使えない（[API destinations](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html)）。
- 接続（connection）の認証は `BASIC`、`OAUTH_CLIENT_CREDENTIALS`、`API_KEY` の 3 つ（[CreateConnection](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_CreateConnection.html)）。SigV4 は選べない。判断: 受け側が Web Function なら `ApplicationManaged` にして、API キーをアプリで検査することになる。`IamAuth` の endpoint は API destination から呼べない。
- API destination に送る内容は、受け側の API の形に合うよう `InputTemplate` で作る（[Pipes targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-event-target.html)）。
- batch: 1 回の呼び出しに複数のメッセージを渡せる target は、Pipes の表（Lambda、Step Functions、SQS、SNS など）に入っていて、API destination はその表にない。「target が batch に対応しないと、source の batch は有効にできない」と書かれている（[Batching and concurrency](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-batching-concurrency.html)）。判断: API destination には 1 メッセージずつ送ることになる。
- 順序: source が順序つき（FIFO）の pipe は、target を同期で呼ぶ。FIFO では、message group ごとに 1 度に 1 batch だけを送り、エラーのときは、その group の次のメッセージを受ける前に再試行を終える（[Pipes targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-event-target.html)、[SQS as a source](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-sqs.html)）。
- 再試行と DLQ: SQS を source にする pipe は、target の失敗（API destination の論理エラーを含む）を source キューの最大受信回数まで再試行する。DLQ は pipe ではなく source キューに付ける。pipe に付ける DLQ は pipe の非同期の起動のためのもの。source キューの visibility timeout は、enrichment と target の実行時間の合計の 6 倍以上にし、`maxReceiveCount` は 5 以上を勧める（[SQS as a source](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-sqs.html)、[Error handling and troubleshooting](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-error-troubleshooting.html)）。
- 部分的な失敗: pipe の target が batch に対応するとき、一部だけ成功した batch の残りを再試行する。`batchItemFailures` の形の応答は pipe にも使える（[SQS as a source](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-sqs.html) の「Reporting batch item failures」）。HTTP の応答からこれを作る手段は文書にない。
- API destination が 4xx と 5xx を返したときの扱い（確かめた事実）:
  - API destination の文書は、401、407、409、429、5xx を再試行し、1xx、2xx、3xx と、上記以外の 4xx は再試行しないと書く。`Retry-After` の header も読む（[API destinations](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html) の「API destination error codes」）。
  - Pipes の文書は、同期で呼ぶ API destination の「logic error」を、利用者側の起動の失敗（customer invocation error）の例に挙げる。SQS を source にする pipe は、これを source キューの最大受信回数まで再試行する。target の失敗が返ると、pipe の polling の速さは徐々に落ちる（[Error handling and troubleshooting](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-error-troubleshooting.html)）。AWS 側の再試行できる失敗（HTTP 接続の失敗など）は、最大受信回数に数えず、record の期限が切れるまで無制限に再試行する。
  - 同じ文書は、4xx が続くとき pipe が自動で無効になる場合があると書くが、挙げる例は IAM の認可の問題と存在しない resource で、API destination の応答の 4xx を指すとは書いていない。
  - 判断（文書に書かれていない部分）: 400 のような再試行しない 4xx を、pipe が target の失敗として SQS に戻すのか、配信済みとして batch を成功にするのかは、文書にない。後者なら、そのメッセージは DLQ にも入らず消える。5 秒の timeout、429、5xx、409、401 は再試行の対象なので、SQS に戻る側と読める。AWS の上では未実行。

### ECS で HTTP のワーカーにする構成

- 確かめた事実: ECS の SQS のワーカーについて AWS が文書にしているのは、タスクが SQS を読む形（上の「ECS のワーカー」）。SQS や Pipes から HTTP で ECS の service を呼ぶ構成を勧める文書は見つからなかった。
- Pipes の target には ECS task（`RunTask`）があり、パラメーターは `EcsParameters` で指定する。batch の表に ECS はない。`docs/async/flow-control.md` の「SQS + Lambda + ECS スタンドアロンタスク（EventBridge Pipes でも同様）」はこの形に当たる。常駐の HTTP サービスではなく、メッセージごとにタスクを起動する形になる。
- 判断: HTTP の ECS ワーカーを Pipes の API destination から呼ぶ道は 2 つある。(a) ALB を公開のドメイン名と公的な証明書で外に出す。(b) connection に VPC Lattice の resource configuration を指定して、private subnet のまま届かせる（下の「VPC の中の endpoint に届くか」）。(b) なら ADR 0013 の「ECS のタスクと DB を private subnet に置く」は崩れない。

### VPC の中の endpoint に届くか（Pipes と API destination）

- 確かめた事実: connection は、公開 API と private API の両方を対象にできる。private API（VPC か on-premises にある resource）には、VPC Lattice の resource configuration を connection に指定する。EventBridge は、その resource configuration と EventBridge 所有の service network の間に resource association を作る。例として「Elastic Load Balancer の後ろの HTTPS アプリ」が挙がる。別の AWS アカウントの private API も対象にできる。on-premises へは、VPC への経路（Direct Connect、Site-to-Site VPN）が別に要る（[Connections](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-target-connection.html)、[Connecting to private APIs](https://docs.aws.amazon.com/eventbridge/latest/userguide/connection-private.html)）。
- 確かめた事実: private API でも、API destination が扱うのは公開のドメイン名と公的に信頼された証明書の HTTPS endpoint だけ（上の API destinations の注記）。
- 確かめた事実: 作成者の権限で association を作るので、利用者は association を一覧できる。EventBridge が作った association は削除できず、connection を消すと一緒に消える。cross-account の private API では、connection 側のアカウントに、呼び出しの CloudTrail と VPC Lattice のログが届かない。
- 判断: 形 2 の ECS の HTTP ワーカーは、ALB を private のまま resource configuration に載せれば Pipes から届く。ただし、ALB に公的な証明書と、公開 DNS で引けるドメイン名を付ける必要がある。resource configuration の種類、料金、IPv6 の扱い、IPv6 のみの構成との相性は調べていない。
- 判断: Lambda Web Functions は VPC の外に endpoint を持ち、private にはならない。Web Functions の endpoint を Pipes から呼ぶ経路に VPC Lattice は関係しない。

### Web Functions の停止（SIGTERM）と cold start

- 確かめた事実（停止）: Lambda は環境を消す前に、新しい request の割り当てを止め、処理中の request が終わるのを best-effort で待ち、SIGTERM を送る。SIGTERM の後、プロセスが後始末に使える時間は最大 1 秒で、その後に環境を終了する。処理中の request の完了は保証されない。プロセスの状態は失われる。文書は「ハードウェア障害などで graceful shutdown が保証されない場合がある」ので、shutdown の callback に依存しないよう書く（[Execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html)）。
- 確かめた事実（比較）: ECS は SIGTERM の後、task definition の `StopTimeout` の後に SIGKILL を送る（[Amazon ECS task lifecycle](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html)）。Web Functions の 1 秒は、これに比べて固定で短い。
- 判断: ADR 0028 の `ManagedRuntime` の `dispose`（DB の pool を閉じるなど）が 1 秒に収まるかは、実施の Issue で測る。1 秒以内に終わらないとき、処理中のメッセージは中断されうる。SQS の FIFO を Pipes で受ける形では、中断された request は API destination の timeout か接続の失敗として再試行され、同じメッセージが再び届くので、受け側は冪等にする必要がある（判断）。
- 確かめた事実（cold start）: 新しい環境の初期化では、コードを読み込み、プロセスを起動し、`AWS_LAMBDA_HTTP_ENDPOINT` で 10 秒以内に listen を始める。listen するまで環境は request を受けない。新しい環境が初期化中のとき、request は 429 にならず待つ（queue される）。待った request が cold start の遅延を受ける。文書は、listen の後に重い初期化を回し、DB の接続などを遅延させて cold start を短くするよう勧める（[Execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html)、[Scaling behavior](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)）。cold start の長さの数値は、文書に見つからなかった。
- 確かめた事実（スロットリング）: endpoint の rate limit を超えるか、環境がすべて使われていると、Lambda は HTTP 429 を返す。load shedding では、`lambda-web-error-type` header のない 503 を返し、文書は backoff と jitter を付けて再試行するよう書く（[Scaling behavior](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)）。API destination は 429 と 5xx を再試行するので、スロットリングは再試行になる。
- 実験（/tmp、Node.js 24.22.1、hono 4.13.14、`@hono/node-server`）: route 1 つの Hono を `serve()` するだけのプロセスで、import から listen まで 3〜7 ms、プロセスの開始から listen まで 95〜200 ms（5 回）。これは手元の下限で、Lambda の cold start（コードの取得、環境の作成）、Effect の `ManagedRuntime` の起動、VPC の connector と Aurora への接続は含まない。5 秒との差は測れていない。
- 判断: cold start が 5 秒を超えるかは測っていない。超えると API destination が timeout にして再試行する。そのとき、最初の request が Web Function の側でまだ処理中なら、同じメッセージが重ねて届く。cold start 中の request は queue されて待つので、受け側の処理時間に cold start が足される（5 秒の枠に入る）。5 秒の枠に処理が入らないなら、受け側は「受領だけ返して後で処理」するか、冪等にして重複を許す必要がある。

### VPC の中の DB

- Web Functions: egress network connector を付けると VPC の subnet を通って Aurora に届く。これは API と同じ（ADR 0013）。ワーカーだけ Web Function にするなら、API の Web Function とは別の Web Function と別の connector になる。
- Event Functions（今の ADR 0013）は VPC の設定で入る。形 2 の Lambda の構成では、Event Functions のワーカーがなくなり、VPC に入れた Event Functions の「14 日使われないと `Inactive`」の項（ADR 0013 の Consequences）は、ワーカーの分は不要になる。

## 比較

| 項目                 | 今の ADR 0013（入口が application を直接呼ぶ）            | 形 1（入口は変換だけ、route を `app.request()`）                                               | 形 2: Pipes → API destination → Web Function                                                                          | 形 2: Pipes → API destination → ECS の HTTP ワーカー                  |
| -------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 受け方               | ECS は SQS を読む繰り返し、Lambda は event source mapping | 同じ。入口の中で `Request` に変える                                                            | Pipes が SQS を読み、HTTP で push                                                                                     | 同左。ALB（公開、または resource configuration）に push               |
| 一次情報の裏づけ     | 全部あり                                                  | 部分的な失敗の応答、scaling、`runTask.sync` はあり。`app.request()` の本番利用は公式の事例なし | Pipes、API destination、`ApplicationManaged` は文書あり。この組み合わせの事例は見つからず                             | HTTP の ECS ワーカーを SQS から push する構成の文書は見つからず       |
| 失敗の戻し方         | `batchItemFailures`、削除しない、終了コード               | status を入口が `batchItemFailures`、削除、終了コードに写す                                    | HTTP の status。401、407、409、429、5xx は再試行、他の 4xx は再試行しない。再試行しない 4xx の後の SQS の扱いは未確認 | 同左                                                                  |
| FIFO の順序          | Event Functions: 最初の失敗で止める（入口か Powertools）  | 同じ                                                                                           | Pipes が group ごとに 1 batch ずつ同期で送る。1 メッセージずつ                                                        | 同左                                                                  |
| 1 回の処理時間の上限 | Lambda 15 分、ECS は無制限                                | 同じ                                                                                           | API destination は 5 秒。超えると timeout で再試行（重複）                                                            | 同左                                                                  |
| 再試行と DLQ         | SQS の最大受信回数と source キューの DLQ                  | 同じ                                                                                           | 同じ（source キューの DLQ）。pipe の DLQ は別物                                                                       | 同左                                                                  |
| VPC の DB            | Event Functions は VPC に入る。ECS は private subnet      | 同じ                                                                                           | Web Function + connector。VPC に入れた Event Functions は不要                                                         | resource configuration で private のまま届く。または ALB を公開       |
| 認証                 | 不要（入口が内部）                                        | 不要（`Request` を内部で作る）                                                                 | `ApplicationManaged` + API キー（アプリで検査）。公開の endpoint になる                                               | API キー（ALB を公開にするなら必須）                                  |
| API と共有できるもの | application、domain                                       | 上に加えて logger、`onError`、`@hono/otel`                                                     | 上に加えて Hono の route と HTTP の middleware 全部                                                                   | 同左                                                                  |
| 増える部品           | なし                                                      | worker 用の Hono app、変換の層                                                                 | Pipes、API destination、connection、Web Function、API キー                                                            | Pipes、API destination、connection、resource configuration か公開 ALB |
| ADR 0013 で変わる量  | なし                                                      | 小（入口の 1 項と ADR 0028 の `ManagedRuntime` の渡し先）                                      | 大（非同期の節、Lambda の構成、VPC、Consequences）                                                                    | 大（ECS の構成、入口。private のまま届くなら subnet は変わらない）    |

## ADR 0013 のどこが変わるか

形 1 を採る場合（判断）:

- 「ルール」の最初の項（入口）: 入口の種類（API の `server.ts`、ECS のワーカー、Lambda のワーカー、締めのバッチ）は変わらない。ワーカーと締めの入口が「メッセージや引数を `Request` に変え、worker 用の Hono app を呼び、結果を `batchItemFailures`、メッセージの削除、終了コードに戻す」と書き足す。
- 「ECS では API、ワーカー、バッチを 1 つのコンテナイメージ」「Lambda では zip」「締めのバッチは ECS のタスク」「Outbox を送る処理は 1 つの関数」「FIFO を読む Event Functions は最初の失敗で止める」: 変わらない。FIFO の規則は変換の層（か Powertools）に移る。
- インフラ（CloudFront、VPC、IPv6、NAT、SQS、Step Functions、IaC）: 変わらない。
- ADR 0028: 「`ManagedRuntime` は入口ごとに 1 つ作り、`app.ts` とワーカーの handler に渡す」が、「worker 用の app に渡す」になる。実行の関数は `http` と入口で呼ぶ決まりなので、route の中で呼ぶのは許される。ADR 0013 でなく、ADR 0028 と新しい ADR で書き足すのが筋になる（ADR 0032 が ADR 0007 を書き換えずに置き換えた前例がある）。
- ADR 0032: 変わらない。入口が環境変数を読んで検査し、worker 用の app を作る関数に引数で渡す。`app.request()` の第 3 引数の `Env` を使わなくても済む。

形 2 を採る場合（判断）:

- 「ルール」の入口の項: Lambda のワーカーが Event Functions の `handler(event)` から Web Functions の HTTP サーバーに、ECS のワーカーが「SQS を読む繰り返し」から HTTP サーバーに変わる。
- 非同期の項: Event Functions の「`batchItemFailures` を返す」「最初に失敗したメッセージで止める」が、Pipes の同期呼び出しと source キューの再試行に置き換わる。5 秒の API destination に合わせ、受け側は短く返すか、キューを二重に使う。
- 「Lambda の構成」の項: Event Functions の VPC の設定、`Ipv6AllowedForDualStack`、14 日で `Inactive` になる項が、ワーカーの分は不要になる。Web Function と connector が増える。公開の endpoint の認証（API キー）が増える。
- 「入口は CloudFront 1 つ」の項: ワーカーの endpoint は CloudFront の外に出る（Pipes は CloudFront を通らない）。入口が 1 つ、という前提が崩れる。
- ECS の構成: 「ECS のタスクと DB を private subnet」は、VPC Lattice の resource configuration で Pipes から private のまま届くなら崩れない。公開の ALB を使うなら、ワーカー用の公開の入口が増える。どちらでも、ALB に公的な証明書とドメイン名が要る。
- Considered Options に「SQS を push で受ける」案とその理由を足す。
- ADR 0028: 変わらない（`ManagedRuntime` は HTTP サーバーの入口で 1 つ作る）。ただし Web Functions の SIGTERM の後始末は 1 秒に限られるので、`dispose` が 1 秒に収まるかを実施の Issue で確かめる（ADR 0028 の「次は実施の Issue で確かめます」の項）。
- ADR 0032: `server.ts` と同じ形で読めるので変わらない。

## docs と一次情報の食い違い

- Issue #348 の本文にある `hono/aws-lambda` は、hono 4.13.14 で非推奨になり、v5 で削除される。`@hono/aws-lambda` を使う。リポジトリの docs にこの名前は出てこないので、直す docs はない。
- ADR 0013、0028、0032 と一次情報の食い違いは、この調査の範囲では見つからなかった。ADR 0013 の「FIFO を読む Event Functions は最初に失敗したメッセージで処理を止める」は、Lambda の文書（`services-sqs-errorhandling`）と一致する。
- `docs/async/flow-control.md` の「SQS + Lambda + ECS スタンドアロンタスク（EventBridge Pipes でも同様）」は、Pipes の target に ECS task があることと合う。

## 決めるべき論点

1. 形 1 を採るか。得るものはログ、OpenTelemetry、エラーの変換の共有と、route という共通の形（判断: 小さい）。払うものは、公式の事例がない自前の変換の層と、status と再試行の対応を決める作業。application を直接呼ぶ今の入口との差は、この 2 つの釣り合いで決まる。
2. 形 1 を採るなら、worker 用の Hono app を `createApp` と分けるか。同じ app に置くと、`/api/*` から job の route が見える面が増える。
3. 形 1 の status と再試行の対応。400 と 409 の扱い、再試行しない失敗の置き場（DLQ か、処理済みとして削除か）、FIFO で止める条件。変換に持つか、Powertools の `processPartialResponse` に任せるか。
4. 形 1 の trace の伝播。メッセージ属性の `traceparent` を header に写すか。合成する URL の host を何にするか。[Issue #148](https://github.com/yokozi-jp/agent-software-factory/issues/148) の範囲に入れるか。
5. 形 2 を採るか。5 秒の API destination の制約が、Outbox を送る処理や締めに合うか。受け側が 5 秒以内に受領だけ返して後で処理する形にすると、SQS の「処理が終わるまで消さない」が崩れる。
6. 形 2 を採るなら、公開の endpoint の認証（API キーを誰がどこで検査し、どう回すか）と、ワーカーの endpoint が CloudFront の外に出ることを許すか。ECS の HTTP ワーカーなら、公開の ALB にするか、VPC Lattice の resource configuration で private のまま届かせるか。
7. ADR の書き方。形 1 は ADR 0028 と新しい ADR で書き足し、ADR 0013 は直さない（ADR 0032 の前例）。形 2 は ADR 0013 の非同期の節の書き換えが大きく、新しい ADR で置き換えるか、ADR 0013 を直すか。
8. `.sync` の終了コードの扱いは、#349 の調査を参照して決めるか（形 1 の締めに必要）。
9. 形 2 で、5 秒の枠に cold start と処理が入らないとき、重複を許して冪等にするか、受領だけ返して後で処理するか。

## 未確認のこと

- AWS の上での実行はすべて未実行。
- Step Functions の `runTask.sync` と終了コードは、#349 の調査を参照（ここでは扱わない）。
- SQS の Event Function に `handle(app)`（`statusCode: 404` の object）を使ったとき、`ReportBatchItemFailures` の下でメッセージが消えるか。Knowledge Center の「`{"Key1":"Value1"}` は complete success」からの推測で、AWS の上では実行していない。
- Web Functions を SQS の event source mapping から起動できないこと。文書に記述がなく、`FunctionName` の pattern と `aws lambda-web` の command 一覧から「できない」と読めるだけで、API が拒否することは確かめていない（`aws` の実行は禁止）。
- API destination が再試行しない 4xx（400 など）を返したとき、pipe が SQS のメッセージを戻すのか、成功として削除するのか。
- VPC Lattice の resource configuration 経由で Pipes から ALB に届くことの実機の確認、resource configuration の種類と料金、IPv6 のみの構成との相性。
- Pipes の API destination の 5 秒に対し、Web Function の cold start（Effect の起動、VPC の connector、Aurora への接続を含む）がどれだけ余裕を残すか。Lambda の文書に cold start の数値はなく、手元の下限（95〜200 ms）しか測っていない。
- ADR 0028 の `dispose` が、Web Functions の SIGTERM の後の 1 秒に収まるか（SIGTERM を送ること自体は文書で確かめた）。
- 変換の層を含めた Event Function の bundle の大きさと cold start（Hono は小さいが、測っていない）。
- `@hono/otel` と Effect の Tracer のつなぎ方（Issue #148）。
- 事例の探し漏れ: GitHub のコード検索、リポジトリ検索、`honojs/hono` の Issue と Discussions、Powertools のコードと文書を検索した範囲（「事例」の項に列挙）で見つからなかっただけで、ブログや非公開の OSS にはあるかもしれない。`gh` の API は EOF で失敗することがあり、`honojs/middleware` と `honojs/website` の検索は一部しか結果が出なかった。

## 出典

- Hono: [Hono: API（`app.request`、`app.fetch`）](https://hono.dev/docs/api/hono)、[Hono: AWS Lambda](https://hono.dev/docs/getting-started/aws-lambda)、[Hono: Cloudflare Workers（other event handlers）](https://hono.dev/docs/getting-started/cloudflare-workers)、[Best Practices](https://hono.dev/docs/guides/best-practices)、[Hono の全文（llms-full.txt）](https://hono.dev/llms-full.txt)、[honojs/hono の `src/adapter/aws-lambda/handler.ts`](https://github.com/honojs/hono/blob/main/src/adapter/aws-lambda/handler.ts)、[@hono/aws-lambda](https://www.npmjs.com/package/@hono/aws-lambda)、[@hono/otel](https://www.npmjs.com/package/@hono/otel)
- Lambda: [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)、[Handling errors for an SQS event source](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)、[Configuring scaling behavior for SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)、[Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)
- Lambda Web Functions: [AWS Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)、[HTTP requests and responses](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-http.html)、[Lambda Web Function endpoint access control](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html)、[Lambda Web Function permissions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-permissions.html)、[Scaling behavior for Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)、このリポジトリの [`research/lambda-web-functions`](https://github.com/yokozi-jp/agent-software-factory/blob/research/lambda-web-functions/research/lambda-web-functions.md)（Issue #86）
- EventBridge Pipes: [Pipes targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-event-target.html)、[SQS as a source](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-sqs.html)、[Batching and concurrency](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-batching-concurrency.html)、[Error handling and troubleshooting](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-error-troubleshooting.html)、[API destinations](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html)、[CreateConnection](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_CreateConnection.html)
- Step Functions と ECS: [Run Amazon ECS or Fargate tasks with Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html)、[Scale Amazon ECS services based on an Amazon SQS queue](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-queue.html)、[Amazon ECS task lifecycle](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html)
- 追加調査（2026-10-29）: [Execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html)、[Lambda Web Function permissions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-permissions.html)、[CreateEventSourceMapping](https://docs.aws.amazon.com/lambda/latest/api/API_CreateEventSourceMapping.html)、[AWS CLI: lambda-web](https://docs.aws.amazon.com/cli/latest/reference/lambda-web/index.html)、[Connections for API targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-target-connection.html)、[Connecting to private APIs](https://docs.aws.amazon.com/eventbridge/latest/userguide/connection-private.html)、[Pipes error handling](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-error-troubleshooting.html)、[ReportBatchItemFailures の Knowledge Center](https://repost.aws/knowledge-center/lambda-sqs-report-batch-item-failures)、[Powertools Event Handler: HTTP API](https://docs.aws.amazon.com/powertools/typescript/latest/features/event-handler/http/)、Hono の Issue [#492](https://github.com/honojs/hono/issues/492)、[#581](https://github.com/honojs/hono/issues/581)、[#2396](https://github.com/honojs/hono/issues/2396)、[#3180](https://github.com/honojs/hono/issues/3180) と Discussions [#1163](https://github.com/orgs/honojs/discussions/1163)、[#2282](https://github.com/orgs/honojs/discussions/2282)
- Powertools: [`@aws-lambda-powertools/batch`](https://www.npmjs.com/package/@aws-lambda-powertools/batch)（2.36.0 の `SqsFifoPartialProcessor`、`processPartialResponse`）
- このリポジトリ: ADR 0013、ADR 0028、ADR 0032、`docs/async/flow-control.md`、`apps/api/src/server.ts`、[Issue #86](https://github.com/yokozi-jp/agent-software-factory/issues/86)
