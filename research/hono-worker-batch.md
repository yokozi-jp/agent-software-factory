# ワーカーとバッチを Hono のアプリとして書く案の標準とアンチパターンを調べる（ECS の常駐、Lambda Event Functions と Web Functions、Step Functions の RunTask）

## 問い

[Issue #348](https://github.com/yokozi-jp/agent-software-factory/issues/348) の調査。ワーカー（SQS のメッセージを処理する）とバッチ（締め）を Hono のアプリとして書く案を、一次資料で調べる。次の 2 つの形を比べる。

1. **処理を Hono の route にし、入口は変換だけにする**: ECS のワーカー、Lambda Event Functions の `handler(event)`、Step Functions の RunTask で起動する ECS のタスクが、メッセージや引数を `Request` に変えて `app.request()` で呼ぶ。API と同じ middleware が使えるか。Hono に公式の形や事例があるか。失敗を `batchItemFailures` やタスクの終了コードにどう戻すか。
2. **ワーカーを HTTP で待ち受けるサービスにし、push で受ける**: Lambda Web Functions を SQS から起動できるか。EventBridge Pipes や API destinations から HTTP で受けられるか。ECS で HTTP のワーカーにする構成があるか。VPC の中の DB、FIFO の順序、再試行と DLQ との関係。

どちらも ADR 0013 の入口の形と比べ、変える場合に ADR 0013 のどこが変わるかを書く。決定はここでは下さない。

調べた日は 2026-10-29。AWS アカウントはまだないので、AWS の上ではなにも実行していない。Hono 側は `/tmp` に入れた hono 4.13.14、`@hono/aws-lambda` 1.0.1、`@hono/otel` 1.3.0、`@aws-lambda-powertools/batch` 2.36.0（どれも npm の最新）で動かして確かめた。リポジトリの中には `node_modules` を足していない。

## 要約

- 確かめた事実: Hono の公式の資料に、非 HTTP のイベントを `app.request()` で route に流す形は書かれていない。`app.request()` は公式に「テストに便利な method」と説明されている。非 HTTP のイベントについて公式にあるのは、Cloudflare Workers で `fetch: app.fetch` と並べて `scheduled` などの handler を export する形だけで、その handler は route を通らない。Lambda の SQS、EventBridge、Step Functions の事例は、Hono の資料にも AWS の資料にも見つからなかった。この形は標準ではなく、自前の設計になる。
- 確かめた事実: `@hono/aws-lambda` の `handle(app)` は API Gateway（v1、v2）、ALB、VPC Lattice のイベントだけを扱う。SQS のイベントを渡すと、例外にならず `{"statusCode":404,...}` を返す。これは `batchItemFailures` を持たない応答で、`ReportBatchItemFailures` の下では、判断として「失敗なし」に当たり、メッセージが消える。SQS の Event Function に `handle(app)` をそのまま使うのはアンチパターンになる。
- 確かめた事実: Issue 本文の `hono/aws-lambda` は、hono 4.13.14 で非推奨（v5 で削除予定）。`@hono/aws-lambda` に移っている。
- 確かめた事実（形 1 の middleware）: `hono/logger`、`onError`、`@hono/otel` の `httpInstrumentationMiddleware` は、`app.request()` で呼んでも動いた。`@hono/otel` は request の header から親の trace を取り出すので、SQS のメッセージ属性の `traceparent` を header に写せば、API と同じ形でつながる。span の名前は `POST /route`、属性には合成した URL が入る。認証、CSRF、CORS などの HTTP 固有の middleware は、ワーカーでは意味がない。
- 確かめた事実（形 2）: SQS から Lambda Web Functions を直接起動する方法は、文書に見つからなかった。SQS の event source mapping は Event Functions の文書にだけある。EventBridge Pipes は SQS（標準と FIFO）を読み、API destination に HTTP で送れる。ただし API destination は 5 秒で timeout し、公開のドメイン名と公的な証明書が要り、認証は Basic、OAuth、API キーだけで SigV4 は使えない。Web Functions の endpoint は `ApplicationManaged` なら署名なしで受けられる。
- 判断: 形 1 は ADR 0013 の入口の形（ECS は SQS を読む繰り返し、Lambda は `handler(event)`、締めは RunTask）を変えずに、入口の中身を薄くする案になる。ADR 0013 より ADR 0028 の「`ManagedRuntime` を入口ごとに 1 つ」の書き方が変わる。形 2 は、Event Functions と SQS の部分的な失敗の応答、ECS の SQS を読む繰り返し、VPC に入れた Event Functions を、公開の HTTP endpoint と Pipes に置き換える案で、ADR 0013 の非同期の節がほぼ書き直しになる。
- 判断: 形 1 で API と共有できるのはログと OpenTelemetry とエラーの変換くらいで、得るものは小さい。形 2 は 5 秒の制約と公開の面が増える。どちらも今の ADR 0013 より優れているとは、この調査では言えない。決めるべき論点は末尾に並べた。

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
- 事例: Hono の公式、`honojs/middleware`、AWS の資料を探して、SQS や Step Functions の入口から `app.request()` を呼ぶ例は見つからなかった。見つからなかったことは、あることの否定にはならない。

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
- 空の `batchItemFailures` と `null` の `batchItemFailures` は、バッチ全体の成功として扱われる（同）。判断: `batchItemFailures` を持たない応答（`handle()` が返した `statusCode` だけの object など）はこの `null` に当たると読める。この読みは AWS の上では確かめていない。
- Powertools for AWS Lambda（TypeScript）の `@aws-lambda-powertools/batch` に `processPartialResponse` と `SqsFifoPartialProcessor` がある。FIFO では、既定で最初の失敗で止め、残りを失敗にする。パッケージの実装のコメントと export で確かめた。
- 判断: 変換の中に `batchItemFailures` の組み立てがあるので、Powertools を使うかは形 1 と独立に決められる。Powertools の `recordHandler` の中で `app.request()` を呼ぶ形もとれる。

### ECS のワーカー（SQS を読む繰り返し）

- ECS の公式は、SQS のワーカーを service として置き、backlog per task（`ApproximateNumberOfMessagesVisible` を running task 数で割った値）で target tracking の scaling をする形を示す。scale-in の前に、処理中のタスクを task scale-in protection で守るよう勧める（[Scale Amazon ECS services based on an Amazon SQS queue](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-queue.html)）。これは形 1 でも形 2 でも変わらない、ワーカーの運用の標準。
- 止めるときは、コンテナに SIGTERM を送り、task definition の `StopTimeout` の後に SIGKILL を送る（[Amazon ECS task lifecycle](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html)）。ADR 0028 の `ManagedRuntime` の `dispose` は、この SIGTERM で呼ぶ。
- 判断: 繰り返しの中で `ReceiveMessage` → 変換 → `app.request()` → `DeleteMessage`（成功か恒久の失敗のとき）とするだけで、形は Lambda と同じになる。Lambda と違い、`batchItemFailures` の代わりに、削除するかどうかを入口が決める。

### Step Functions から RunTask で起動する ECS のタスク

- `arn:aws:states:::ecs:runTask.sync`（Run a Job）が使える。`Overrides.ContainerOverrides` の `Command` と `Environment` でタスクに引数を渡せる。`RunTask` が HTTP 200 で `Failures` を返したときは、`AmazonECS.Unknown` でタスクの state が失敗する（[Run Amazon ECS or Fargate tasks with Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html)）。
- 判断: 入口は `process.argv` か環境変数を読み、`Request` に変えて `app.request()` を呼び、`res.ok` なら終了コード 0、そうでなければ 1 にする（試作で、500 のとき `1` になることを確かめた）。
- 確かめられなかった: Step Functions の文書は、コンテナが 0 以外の終了コードで終わったとき `.sync` の state が失敗するかを明記していない。Stack Overflow に、Fargate のタスクの runtime error で state が成功になったという報告がある（[AWS Step Functions and Fargate task: container runtime error does not cause pipeline to fail](https://stackoverflow.com/questions/63815158/)）。一次情報ではないので、検証環境で確かめる。
- 締めは、日付などの引数を route の path か body に載せる形になる。Step Functions の入力は 256 KB まで（[EventBridge Pipes targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-event-target.html) の payload の節）。

### 形 1 の標準とアンチパターン（まとめ）

- 標準と言える部分（一次情報あり）: 部分的な失敗の応答（Lambda の文書）、backlog per task の scaling と scale-in protection（ECS の文書）、`runTask.sync` と overrides（Step Functions の文書）、`app.request()` でアプリを呼ぶこと自体（Hono の文書はテスト用と説明）。
- 標準と言えない部分: 本番の入口で `app.request()` を使うこと、SQS や Step Functions のイベントを route に流すこと。公式の事例が見つからず、判断になる。
- アンチパターン（確かめた事実 + 判断）: SQS の Event Function に `handle(app)` をそのまま使う（404 を返し、判断として `ReportBatchItemFailures` の下で消える）。API と同じ `app` に job 用の route を置き、CloudFront の `/api/*` から外に見せる（判断: 面が増える。worker 専用の `createWorkerApp` にして、`apps/api` の `createApp` と分ける）。

## 形 2: ワーカーを HTTP で待ち受けるサービスにし、push で受ける

### Lambda Web Functions を SQS から起動できるか

- 確かめた事実: 文書で SQS の event source mapping を説明するのは Event Functions の側で、"Lambda Event Function and the Amazon SQS queue must be in the same AWS Region"（[Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)）。Web Functions の文書に、SQS から起動する記述は見つからなかった。Web Functions は HTTPS の endpoint を持ち、`HTTP requests and responses` の頁は HTTP/1.1 の request を受ける形だけを説明する（[HTTP requests and responses](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-http.html)）。
- 確かめた事実: endpoint の `AuthType` は `IamAuth`（SigV4 の署名が要る。CloudFront は代わりに署名できる）と `ApplicationManaged`（Lambda は認証せず、全部の request が関数に届く。公開の endpoint 向け）の 2 つ（[Lambda Web Function endpoint access control](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html)）。`ApplicationManaged` は CloudFront の後ろに置いても、自分のドメインで公開のまま届く。
- 確かめた事実: Web Function の resource-based policy の例は CloudFront の service principal だけで、「AWS service に invoke を許す」例として載る（[Lambda Web Function permissions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-permissions.html)）。SQS や EventBridge の service principal の例はない。
- 確かめた事実（#86 の調査）: Web Function の同時実行は 1 つの実行環境で最大 64、`maxEnvironments` の最小は 2、リクエストの `timeoutSeconds` は既定 30 秒で最大 900 秒。VPC の DB へは egress network connector を付けて届く。

### EventBridge Pipes と API destinations

- Pipes の source は SQS の標準キューと FIFO キュー。target に API destination、API Gateway、Lambda、Step Functions、ECS task などがある（[Amazon SQS as a source](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-sqs.html)、[Pipes targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-event-target.html)）。target に Lambda Web Functions はない。
- API destination は、5 秒の client execution timeout を持つ。5 秒を超えると timeout にして再試行する。公開のドメイン名と公的に信頼された証明書の HTTPS endpoint だけを扱い、mTLS は使えない（[API destinations](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html)）。
- 接続（connection）の認証は `BASIC`、`OAUTH_CLIENT_CREDENTIALS`、`API_KEY` の 3 つ（[CreateConnection](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_CreateConnection.html)）。SigV4 は選べない。判断: 受け側が Web Function なら `ApplicationManaged` にして、API キーをアプリで検査することになる。`IamAuth` の endpoint は API destination から呼べない。
- API destination に送る内容は、受け側の API の形に合うよう `InputTemplate` で作る（[Pipes targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-event-target.html)）。
- batch: 1 回の呼び出しに複数のメッセージを渡せる target は、Pipes の表（Lambda、Step Functions、SQS、SNS など）に入っていて、API destination はその表にない。「target が batch に対応しないと、source の batch は有効にできない」と書かれている（[Batching and concurrency](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-batching-concurrency.html)）。判断: API destination には 1 メッセージずつ送ることになる。
- 順序: source が順序つき（FIFO）の pipe は、target を同期で呼ぶ。FIFO では、message group ごとに 1 度に 1 batch だけを送り、エラーのときは、その group の次のメッセージを受ける前に再試行を終える（[Pipes targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-event-target.html)、[SQS as a source](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-sqs.html)）。
- 再試行と DLQ: SQS を source にする pipe は、target の失敗（API destination の論理エラーを含む）を source キューの最大受信回数まで再試行する。DLQ は pipe ではなく source キューに付ける。pipe に付ける DLQ は pipe の非同期の起動のためのもの。source キューの visibility timeout は、enrichment と target の実行時間の合計の 6 倍以上にし、`maxReceiveCount` は 5 以上を勧める（[SQS as a source](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-sqs.html)、[Error handling and troubleshooting](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-error-troubleshooting.html)）。
- 部分的な失敗: pipe の target が batch に対応するとき、一部だけ成功した batch の残りを再試行する。`batchItemFailures` の形の応答は pipe にも使える（[SQS as a source](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-sqs.html) の「Reporting batch item failures」）。HTTP の応答からこれを作る手段は文書にない。
- 確かめられなかった: API destination が 4xx（400、409 など）を返したとき、pipe がそれを失敗として SQS に戻すか。API destination の文書は、event bus での再試行の対象を 401、407、409、429、5xx としている（Pipes の場合は source の設定が決めるとも書く）。
- Pipes 自体は VPC の外のサービスで、API destination は公開のドメイン名に向かう。判断: VPC の中の ALB や private な endpoint は直接は呼べない。

### ECS で HTTP のワーカーにする構成

- 確かめた事実: ECS の SQS のワーカーについて AWS が文書にしているのは、タスクが SQS を読む形（上の「ECS のワーカー」）。SQS や Pipes から HTTP で ECS の service を呼ぶ構成を勧める文書は見つからなかった。
- Pipes の target には ECS task（`RunTask`）があり、パラメーターは `EcsParameters` で指定する。batch の表に ECS はない。`docs/async/flow-control.md` の「SQS + Lambda + ECS スタンドアロンタスク（EventBridge Pipes でも同様）」はこの形に当たる。常駐の HTTP サービスではなく、メッセージごとにタスクを起動する形になる。
- 判断: HTTP の ECS ワーカーを Pipes の API destination から呼ぶには、ALB を公開のドメイン名と公的な証明書で外に出す必要がある。ADR 0013 の「ECS のタスクと DB を private subnet に置く」に対し、ワーカーのためだけに公開の入口が増える。

### VPC の中の DB

- Web Functions: egress network connector を付けると VPC の subnet を通って Aurora に届く。これは API と同じ（ADR 0013）。ワーカーだけ Web Function にするなら、API の Web Function とは別の Web Function と別の connector になる。
- Event Functions（今の ADR 0013）は VPC の設定で入る。形 2 の Lambda の構成では、Event Functions のワーカーがなくなり、VPC に入れた Event Functions の「14 日使われないと `Inactive`」の項（ADR 0013 の Consequences）は、ワーカーの分は不要になる。

## 比較

| 項目                 | 今の ADR 0013（入口が application を直接呼ぶ）            | 形 1（入口は変換だけ、route を `app.request()`）                                               | 形 2: Pipes → API destination → Web Function                                              | 形 2: Pipes → API destination → ECS の HTTP ワーカー            |
| -------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 受け方               | ECS は SQS を読む繰り返し、Lambda は event source mapping | 同じ。入口の中で `Request` に変える                                                            | Pipes が SQS を読み、HTTP で push                                                         | 同左。ALB（公開）に push                                        |
| 一次情報の裏づけ     | 全部あり                                                  | 部分的な失敗の応答、scaling、`runTask.sync` はあり。`app.request()` の本番利用は公式の事例なし | Pipes、API destination、`ApplicationManaged` は文書あり。この組み合わせの事例は見つからず | HTTP の ECS ワーカーを SQS から push する構成の文書は見つからず |
| 失敗の戻し方         | `batchItemFailures`、削除しない、終了コード               | status を入口が `batchItemFailures`、削除、終了コードに写す                                    | HTTP の status。API destination が 4xx を失敗にするかは未確認                             | 同左                                                            |
| FIFO の順序          | Event Functions: 最初の失敗で止める（入口か Powertools）  | 同じ                                                                                           | Pipes が group ごとに 1 batch ずつ同期で送る。1 メッセージずつ                            | 同左                                                            |
| 1 回の処理時間の上限 | Lambda 15 分、ECS は無制限                                | 同じ                                                                                           | API destination は 5 秒。超えると timeout で再試行（重複）                                | 同左                                                            |
| 再試行と DLQ         | SQS の最大受信回数と source キューの DLQ                  | 同じ                                                                                           | 同じ（source キューの DLQ）。pipe の DLQ は別物                                           | 同左                                                            |
| VPC の DB            | Event Functions は VPC に入る。ECS は private subnet      | 同じ                                                                                           | Web Function + connector。VPC に入れた Event Functions は不要                             | private subnet のままだと Pipes から届かない。ALB を公開にする  |
| 認証                 | 不要（入口が内部）                                        | 不要（`Request` を内部で作る）                                                                 | `ApplicationManaged` + API キー（アプリで検査）。公開の endpoint になる                   | 公開の ALB + API キー                                           |
| API と共有できるもの | application、domain                                       | 上に加えて logger、`onError`、`@hono/otel`                                                     | 上に加えて Hono の route と HTTP の middleware 全部                                       | 同左                                                            |
| 増える部品           | なし                                                      | worker 用の Hono app、変換の層                                                                 | Pipes、API destination、connection、Web Function、API キー                                | Pipes、API destination、connection、公開 ALB、API キー          |
| ADR 0013 で変わる量  | なし                                                      | 小（入口の 1 項と ADR 0028 の `ManagedRuntime` の渡し先）                                      | 大（非同期の節、Lambda の構成、VPC、Consequences）                                        | 大（ECS の構成、private subnet、入口）                          |

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
- ECS の構成: 「ECS のタスクと DB を private subnet」に対し、ワーカー用の公開の入口（ALB）が増える。
- Considered Options に「SQS を push で受ける」案とその理由を足す。
- ADR 0028: 変わらない（`ManagedRuntime` は HTTP サーバーの入口で 1 つ作る）。ただし Web Functions の SIGTERM は未確認のまま（ADR 0028 の「次は実施の Issue で確かめます」の項）。
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
6. 形 2 を採るなら、公開の endpoint の認証（API キーを誰がどこで検査し、どう回すか）と、ワーカーの endpoint が CloudFront の外に出ることを許すか。
7. ADR の書き方。形 1 は ADR 0028 と新しい ADR で書き足し、ADR 0013 は直さない（ADR 0032 の前例）。形 2 は ADR 0013 の非同期の節の書き換えが大きく、新しい ADR で置き換えるか、ADR 0013 を直すか。
8. `.sync` の終了コードの扱いを、最初の検証環境で確かめるか（形 1 の締めに必要）。

## 未確認のこと

- AWS の上での実行はすべて未実行。
- Step Functions の `runTask.sync` が、コンテナの 0 以外の終了コードで state を失敗にするか。
- SQS の Event Function に `handle(app)`（`batchItemFailures` を持たない応答）を使ったとき、`ReportBatchItemFailures` の下でメッセージが消えるか。文書の「`null` の `batchItemFailures` は成功」からの推測。
- Web Functions を SQS の event source mapping から起動できないこと。文書に記述が見つからなかっただけで、API が拒否することは確かめていない。
- API destination が 4xx を返したとき、pipe がそれを失敗として扱うか。
- API destination と connection が、private な API（VPC Lattice の resource configuration など）にどこまで届くか。「private APIs」の項目は読んでいない。
- Pipes の API destination の 5 秒に対し、Web Function の cold start がどれだけ余裕を残すか。
- Web Functions が停止の前に SIGTERM を送るか（ADR 0028 にも残っている項目）。
- 変換の層を含めた Event Function の bundle の大きさと cold start（Hono は小さいが、測っていない）。
- `@hono/otel` と Effect の Tracer のつなぎ方（Issue #148）。
- 事例の探し漏れ: Hono の公式、`honojs/middleware`、AWS の資料を検索した範囲で見つからなかっただけで、ブログや OSS にはあるかもしれない。

## 出典

- Hono: [Hono: API（`app.request`、`app.fetch`）](https://hono.dev/docs/api/hono)、[Hono: AWS Lambda](https://hono.dev/docs/getting-started/aws-lambda)、[Hono: Cloudflare Workers（other event handlers）](https://hono.dev/docs/getting-started/cloudflare-workers)、[Best Practices](https://hono.dev/docs/guides/best-practices)、[Hono の全文（llms-full.txt）](https://hono.dev/llms-full.txt)、[honojs/hono の `src/adapter/aws-lambda/handler.ts`](https://github.com/honojs/hono/blob/main/src/adapter/aws-lambda/handler.ts)、[@hono/aws-lambda](https://www.npmjs.com/package/@hono/aws-lambda)、[@hono/otel](https://www.npmjs.com/package/@hono/otel)
- Lambda: [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)、[Handling errors for an SQS event source](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)、[Configuring scaling behavior for SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)、[Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)
- Lambda Web Functions: [AWS Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)、[HTTP requests and responses](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-http.html)、[Lambda Web Function endpoint access control](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html)、[Lambda Web Function permissions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-permissions.html)、[Scaling behavior for Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)、このリポジトリの [`research/lambda-web-functions`](https://github.com/yokozi-jp/agent-software-factory/blob/research/lambda-web-functions/research/lambda-web-functions.md)（Issue #86）
- EventBridge Pipes: [Pipes targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-event-target.html)、[SQS as a source](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-sqs.html)、[Batching and concurrency](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-batching-concurrency.html)、[Error handling and troubleshooting](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-error-troubleshooting.html)、[API destinations](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html)、[CreateConnection](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_CreateConnection.html)
- Step Functions と ECS: [Run Amazon ECS or Fargate tasks with Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html)、[Scale Amazon ECS services based on an Amazon SQS queue](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-queue.html)、[Amazon ECS task lifecycle](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html)
- Powertools: [`@aws-lambda-powertools/batch`](https://www.npmjs.com/package/@aws-lambda-powertools/batch)（2.36.0 の `SqsFifoPartialProcessor`、`processPartialResponse`）
- 一次ではない: [AWS Step Functions and Fargate task: container runtime error does not cause pipeline to fail（Stack Overflow）](https://stackoverflow.com/questions/63815158/)
- このリポジトリ: ADR 0013、ADR 0028、ADR 0032、`docs/async/flow-control.md`、`apps/api/src/server.ts`、[Issue #86](https://github.com/yokozi-jp/agent-software-factory/issues/86)
