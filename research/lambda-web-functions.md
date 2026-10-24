# Lambda Web Functions と Event Functions で、Hono の streaming、VPC の DB、SQS の部分的な失敗の応答が動くかを確かめる

## 問い

[Issue #86](https://github.com/yokozi-jp/agent-software-factory/issues/86) の調査。[デプロイ先と実行基盤を決める](https://github.com/yokozi-jp/agent-software-factory/issues/25) の決め直しのコメントと ADR 0013 で、Lambda の構成は API を Lambda Web Functions（zip、Node.js 24）、ワーカーを Lambda Event Functions（zip、`nodejs24.x`、SQS から起動）にすると決めた。その前提が成り立つかを、一次資料（Lambda、CloudFront、CDK のドキュメントと aws-cdk-lib のパッケージの中身）と、ローカルでの小さな実行で確かめる。

- Web Functions: `@hono/node-server` で `AWS_LAMBDA_HTTP_ENDPOINT` を listen する Hono のアプリが、そのまま動くか。`streamSSE` の応答が、CloudFront（OAC、`AllViewerExceptHostHeader`）を通して少しずつ届くか。
- Web Functions: リクエストのタイムアウト、使われない実行環境が消えるまでの時間、初期化のタイムアウト、WebSocket。
- Web Functions から VPC の中の Aurora PostgreSQL につなげるか。NAT Gateway が要るか。
- Web Functions を CDK で書けるか。pnpm と Nx の monorepo で zip をどう作るか。
- Event Functions の SQS の FIFO キューで、`ReportBatchItemFailures` と `batchItemFailures` が使えるか。
- Web Functions から Outbox を送る Event Function を非同期で起動する方法と、IAM の権限。

調べた日は 2026-10-24。AWS のリソースは作っていない。AWS の上での実行はすべて未実行。ローカルの実験は Node.js v24.22.1、hono 4.13.13、`@hono/node-server` 2.1.5、esbuild 0.28.2 で行った。

## 要約

- Hono と `@hono/node-server` は、Web Functions でそのまま使える。AWS の開発者ガイドのサンプルに、Hono と `@hono/node-server` で `AWS_LAMBDA_HTTP_ENDPOINT` を listen する `index.js` がそのまま載っている。ローカルで、1つのファイルにまとめた Hono のアプリを Node.js 24 で `AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:9124` として起動し、`streamSSE` の応答が 500 ms ごとに 1 件ずつ届くこと、3本の SSE が並行して流れること、SIGTERM で終わることを確かめた。
- streaming: Web Functions は設定なしで応答を streaming する（HTTP/1.1、半二重。リクエストの本文を受け終えてから応答を返す）。CloudFront は `Transfer-Encoding: chunked` の応答を、受け取ったそばから viewer に返す。`text/event-stream` は CloudFront が圧縮する型に入っていない。ただし、CloudFront を通した SSE が少しずつ届くことは、AWS の上では未実行。
- タイムアウト: リクエストは `timeoutSeconds`（既定 30 秒、3〜900 秒）で切れる。streaming では stream 全体がこの時間で切れ、本文が途中で終わる。CloudFront の origin response timeout（既定 30 秒）は、応答のパケットの間にも効く。初期化は 10 秒以内に listen を始める必要がある（変えられない）。終了のときは SIGTERM から 1 秒で止められる。
- 使われない実行環境が消えるまでの時間は、文書にない。「寿命は保証しない」「トラフィックがなければ 0 まで減らす」とだけある。最小の実行環境の数を指定する設定もない。
- WebSocket は使えない。Lambda が `Upgrade` ヘッダーを外す。AWS は一方向で足りるなら SSE を勧める。
- VPC: Web Functions は VPC の中では動かない。revision に egress network connector を付けると、外への通信が VPC の subnet を通り、Aurora に届く。connector を付けると既定のインターネットへの経路がなくなるので、SQS、SES、Lambda の API を呼ぶには、NAT Gateway か VPC のインターフェイスエンドポイントが要る。connector は `HomeRegion` の endpoint でだけ使える。subnet は 2 つ以上の AZ が要る。
- CDK: L1 だけがある。`CfnWebFunction`、`CfnWebFunctionRevision`、`CfnWebFunctionEndpoint`、`CfnNetworkConnector`、`CfnResourcePolicy`（`aws-cdk-lib/aws-lambda`）。`CfnWebFunction*` は aws-cdk-lib 2.273.0 から入り、2.272.0 にはない。L2 は AWS の人が出した PR #39210 で、まだ merge されていない。OAC の `always-amz-auth` は 2.274.0 に `Signing.SIGV4_ALWAYS_AMZ_AUTH` として入っている。コードは S3 のバージョニングが有効な bucket から読むので、CDK の bootstrap の bucket と `Code.fromAsset` はそのままでは使えない（PR #39210 の説明）。
- zip: 実行環境は Arm64 で、`index.js` を既定の入口として読み、`package.json` の `main` は読まない。AWS のサンプルは `npm ci --omit=dev` の `node_modules` ごと zip にする。判断: このリポジトリでは、esbuild か Vite+ の build で 1 つの ESM のファイルにまとめ、`index.js` と `{"type":"module"}` だけの `package.json` を zip にする（実験では 28 KB）。
- Event Functions の SQS の FIFO キューでも `ReportBatchItemFailures` と `batchItemFailures` は使える。FIFO では、最初の失敗で処理を止め、失敗したものと処理していないものを全部 `batchItemFailures` に入れる必要がある。同時実行数は message group の数と maximum concurrency の小さい方で上限が決まる。
- Outbox を送る処理は、Web Functions から AWS SDK の `Invoke` を `InvocationType: "Event"` で呼んで起動する。Web Function の実行ロールに、対象の Event Function への `lambda:InvokeFunction` が要る。connector を付けた Web Function からは、NAT Gateway か Lambda のインターフェイスエンドポイント（`com.amazonaws.<region>.lambda`）を通る。
- 判断: Lambda の構成の前提は、技術としては成り立つ。ただし、ADR 0013 と食い違う点や書き足すべき点がある。主なものは、CDK に L1 しかないこと（ADR は ECS Express Mode を「CDK の L1 しかない」ことを理由に退けている）、VPC の中の DB を使うと NAT Gateway かインターフェイスエンドポイントの常時の課金が Lambda の構成にも乗ること、`maxEnvironments` の最小が 2 であること。一覧は「ADR 0013 と決め直しのコメントとの食い違い」の節にある。

## Hono と `@hono/node-server` がそのまま動くか

- Web Functions は、Node.js のフレームワークで普通の HTTP サーバーを動かす。Lambda Web Adapter や、イベントを HTTP に変える adapter は要らない（[Web Function runtimes](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.html)）。
- サーバーは `AWS_LAMBDA_HTTP_ENDPOINT`（`host:port` の形）の host と port で listen する。違う host や port で listen すると、リクエストは届かない。この変数はローカルでは設定されないので、fallback の値はローカルでだけ使われる（同）。この変数は revision の環境変数で上書きできない（[Environment variables](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-env-vars.html)）。
- AWS のサンプルに Hono の例がある。`npm pkg set type=module` をした上で、`@hono/node-server` の `serve({ fetch: app.fetch, port: Number(port), hostname: host })` で listen する `index.js` を置く（[Web Function sample applications](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-samples.html)）。
- 入口: runtime は既定で、package の root の `index.js` を読む。`package.json` の入口の設定は読まない。別のファイルにするときは `AWS_LAMBDA_NODEJS_ENTRYPOINT` に package の root からの相対パスを書く（[Environment variables](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-env-vars.html)）。
- ランタイムは `nodejs24.x` だけで、patch の版は固定できず、Lambda がいつも最新に当てる（[Web Function runtimes](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.html)）。
- 実行環境は Arm64。native のモジュールは Linux Arm64 用に作る（[Testing Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-testing.html)、[Best practices](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-best-practices.html)）。
- 1つの実行環境が、同時に複数のリクエストを受ける。リクエストごとの状態を global の変数に置かない。CPU を長く使う同期の処理は、同じ実行環境の他のリクエストを全部止める（[Web Function runtimes](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.html)）。ADR 0007 の「アプリのコードは Web 標準の API だけ」とは衝突しない。
- このリポジトリの `apps/api/src/server.ts` は、今は `PORT` を読み、hostname を指定していない。Web Functions では `AWS_LAMBDA_HTTP_ENDPOINT` から host と port を取るように変える（決め直しのコメントのとおり）。

実験（ローカル、Node.js v24.22.1）:

- `src/server.ts` に Hono のアプリを書いた。`/api/sse` は `streamSSE` で 500 ms ごとに 5 件の event を書く。入口は `const [hostname, port] = (process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? "localhost:3000").split(":")` で `serve({ fetch: app.fetch, hostname, port: Number(port) })` を呼び、SIGTERM で `server.close()` と `process.exit(0)` をする。
- `esbuild src/server.ts --bundle --platform=node --target=node24 --format=esm` で 1 つのファイル（106 KB）にまとめ、`index.js` と `{"type":"module"}` の `package.json` だけを zip にした（28 KB）。別の directory に展開し、`node_modules` がない状態で `AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:9124 node index.js` で起動した。AWS の [Testing Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-testing.html) の「展開した archive から起動する」手順に合わせた。
- `curl -N` で、event が 500 ms ごとに 1 件ずつ届いた。応答は `content-type: text/event-stream`、`cache-control: no-cache`、`transfer-encoding: chunked`。
- 3 本の SSE を同時に流すと、合計 2.55 秒で終わった（1本 2.5 秒）。3 本は 1 つのプロセスで並行に流れた。
- SIGTERM でプロセスが止まり、port が閉じた。

## streaming と CloudFront

- Web Functions は、追加の設定なしで応答を streaming する（[AWS Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)）。リクエストの本文も届いたそばからアプリに渡すが、経路は半二重で、Lambda はリクエストの本文を全部渡してからアプリの応答を返す。本文を読み終えてから応答を書く（[Configuring networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)）。AI のチャットのように、POST の本文を受けてから SSE を返す形はこれに合う。
- endpoint は HTTP/1.1 だけを受ける。HTTP/1.0 は 505 になる。method は `GET`、`HEAD`、`POST`、`PUT`、`PATCH`、`OPTIONS`、`DELETE`（[HTTP requests and responses](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-http.html)）。
- CloudFront は、origin が `Transfer-Encoding: chunked` を返すと、edge に届いたそばから viewer に返す（[Request and response behavior for custom origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorCustomOrigin.html)）。
- CloudFront が圧縮する content type の一覧に `text/event-stream` はない（[Serving compressed files](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html)）。圧縮のために応答がためられることはない（判断。一覧からの読み取り）。
- CloudFront の origin response timeout（既定 30 秒）は、最初の応答までの時間と、応答のパケットの間の時間の両方に効く（[Origin settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesOrigin.html)）。LLM の応答を待つ間に 30 秒以上何も送らないと切れるので、SSE のコメント行などで定期的に何かを送る（判断）。
- OAC: Web Functions の origin には、origin type `lambda`、signing behavior `always-amz-auth` の OAC を使う。他の signing behavior は CloudFront が受け付けない。regional の endpoint は `sigv4`、global の endpoint は `sigv4a`（[Restrict access to an AWS Lambda Web Function origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda-web.html)）。
- `always-amz-auth` では、CloudFront は自分の署名を専用のヘッダーに入れ、viewer の `Authorization` ヘッダーはそのまま origin に渡す。`PUT`、`POST`、`PATCH` は `UNSIGNED-PAYLOAD` で署名するので、viewer は `x-amz-content-sha256` を送らなくてよい（同）。決め直しのコメントの記述と合う。
- ただし、`GET` と `HEAD` では、`Authorization` を cache policy に入れないと CloudFront が外す。アプリが `Authorization` ヘッダー（Bearer の token など）を読むなら、そのオリジンを使うすべての cache behavior の cache policy に入れる（同）。
- origin request policy は viewer の `Host` を送らないものにする。Lambda は `Host` で振り分け、endpoint のドメインでなければ 404 を返す。managed policy なら `AllViewerExceptHostHeader`（同、[Configuring networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)）。
- OAC を使う Web Functions のオリジンの cache behavior には、Lambda@Edge の origin request と origin response の trigger を付けられない（[Restrict access to an AWS Lambda Web Function origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda-web.html)）。
- `IamAuth` にしても、endpoint のドメインはインターネットから見える。署名のない直接のリクエストは拒否される。resource-based policy で `cloudfront.amazonaws.com` に `lambda:InvokeWebFunctionEndpoint` を与え、`aws:SourceArn` で自分の distribution に絞る（[Lambda Web Function endpoint access control](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html)）。`ApplicationManaged` にすると、CloudFront と WAF を迂回して直接呼べる（[Configuring networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)）。
- Lambda は CORS のヘッダーを付けない。アプリか CloudFront で扱う（同）。web と `/api/*` を同じ CloudFront のオリジンにまとめる ADR 0013 の構成では、CORS は要らない（判断）。

## タイムアウト、実行環境の寿命、初期化、WebSocket

| 項目                                         | 値                                                                                                                                     | 出典                                                                                                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| リクエストのタイムアウト（`timeoutSeconds`） | 既定 30 秒、3〜900 秒。revision の設定                                                                                                 | [Request timeout](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-timeout.html)                                                                                                       |
| streaming の応答                             | stream 全体が `timeoutSeconds` で切れる。status は送った値（多くは 200）のまま、本文が途中で終わり、`lambda-web-error-type` は付かない | 同                                                                                                                                                                                                         |
| streaming でない応答のタイムアウト           | 504、`lambda-web-error-type: Runtime.RequestTimeout`                                                                                   | 同                                                                                                                                                                                                         |
| 初期化のタイムアウト                         | 起動から 10 秒以内に listen を始める。変えられない                                                                                     | [Execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html)、[Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html) |
| 終了                                         | 新しいリクエストを止め、処理中のリクエストを best effort で待ち、SIGTERM を送る。SIGTERM から 1 秒で終わらせる                         | [Execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html)                                                                                           |
| 使われない実行環境が消えるまでの時間         | 文書にない。「寿命は保証しない」「トラフィックがなければ 0 まで減らす」                                                                | 同、[Scaling behavior](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)                                                                                                            |
| 最小の実行環境の数                           | 設定がない。必ず 0 から増える                                                                                                          | [Scaling behavior](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)                                                                                                                |
| WebSocket                                    | 使えない。Lambda が `Upgrade` などを外す                                                                                               | [Configuring networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)、[HTTP requests and responses](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-http.html)  |
| 実行環境ごとの資源                           | 2 vCPU、メモリ 2 GB（V8 の heap は既定 1,024 MB）、`/tmp` 512 MB、file descriptor 1,024                                                | [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)、[Web Function runtimes](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.html)                |
| package の大きさ                             | 512 MB（展開後）                                                                                                                       | [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)                                                                                                                   |

- 初期化を短くするため、AWS は DB の接続や外部のクライアントを最初のリクエストで作るよう勧める（[Execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html)）。
- 課金のメモリは、実行環境が消費するメモリを、実行環境がある間ずっと数える。リクエストの間の時間も含む（[AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)）。使われない実行環境がどれだけ残るかが分からないので、使っていない時間のメモリの費用は見積もれない。
- Lambda は、急な増加に備えて実行環境を先に増やしておく（headroom）（[Scaling behavior](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)）。そのため、実行環境の数はリクエストの数から計算した数より多くなることがある。

## 同時実行と DB の接続

- `maxConcurrencyPerEnvironment`（revision の設定）: 既定 64、1〜128。Lambda が資源の使い方から決める動的な上限の、さらに上限。新しい Web Function では低い値から始まり、学習した値は 0 まで減っても覚えている（[Scaling behavior](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)）。
- `maxEnvironments`（endpoint の設定）: 任意で、**2〜10,000**。Region ごとに効く。revision の重みを変えるときなどに、一時的に超えることがある（同）。
- 上限に達して全部の実行環境が埋まると、Lambda はすぐ 429 を返し、待たせない（同）。
- 判断: 実行環境ごとに接続プールを持つなら、DB の接続の数は「プールの大きさ × `maxEnvironments`」に、一時的な超過の分を足して見積もる。`maxEnvironments` は 1 にできないので、最小でも 2 つの実行環境のプールが並ぶ前提で、Aurora の `max_connections` を見る。

## VPC の中の Aurora PostgreSQL と NAT Gateway

- Web Functions は Lambda が持つ基盤で動き、VPC の中では動かない。VPC への外向きの通信は、revision に egress network connector を付けて行う。connector は内向きの通信を変えない（[Configuring networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)）。
- connector の条件（同）:
  - 異なる AZ の subnet を 2 つ以上選ぶ。
  - revision から参照するときは、版を付けた ARN（`...:network-connector:nc-...:4` の形）を使う。後から変えるには新しい revision を作る。
  - connector の compute resource type は `WebFunction` にする。Event Functions とは共有できない。
  - connector を使えるのは `HomeRegion` の endpoint だけ。
  - Lambda が ENI を作るための operator role を用意し、作る人には `lambda:PassNetworkConnector` と operator role への `iam:PassRole` が要る（[Web Function permissions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-permissions.html)）。
- DB の security group では、connector の security group からの接続を許す。connector の通信に固定の送信元 IP はない（[Configuring networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)）。
- connector を付けると、既定の外向きの経路が置き換わる。connector はインターネットへの経路を持たない。公開の IPv4 の宛先に届くには、connector の subnet から NAT Gateway への route が要る（同）。SQS、SES、Lambda の API も公開の endpoint なので、NAT Gateway か、それぞれの VPC のインターフェイスエンドポイントが要る（判断。AWS の API が公開の endpoint であることからの読み取り）。
  - Lambda のインターフェイスエンドポイントは `com.amazonaws.<region>.lambda`。`Invoke` を含むすべての Lambda の API を VPC の中から呼べる（[Lambda interface endpoints](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-endpoints.html)）。
  - SES の API にもインターフェイスエンドポイント（サービス名を `email` で探す）がある（[Setting up VPC endpoints with Amazon SES](https://docs.aws.amazon.com/ses/latest/dg/send-email-set-up-vpc-endpoints.html)）。
  - インターフェイスエンドポイントも、AZ ごとに時間で課金される（[Lambda interface endpoints](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-endpoints.html)）。
- connector を付けない revision は、公開の IPv4 の宛先に直接出られるが、VPC の中のリソースには届かない（[Configuring networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)）。DB を VPC の中に置く限り、API の Web Function には connector が要る。
- Event Functions は、従来どおり関数に VPC の設定（subnet と security group）を付ける。VPC に入れた関数は、NAT Gateway のある private subnet に置かないとインターネットに出られない。public subnet に置いても出られない（[Enable internet access for VPC-connected Lambda Event Functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html)）。
- AWS の開発者ガイドは、connector を付けた Web Function を、VPC の中の DB の例として挙げている（[Configuring networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)）。PR #39210 の integ test は、connector を通して S3 の gateway endpoint にだけ届く object を読み、egress が connector を通ることを確かめたと書いている（[aws-cdk#39210](https://github.com/aws/aws-cdk/pull/39210)）。Aurora への接続そのものの実行は、この調査では未実行。

## CDK で書けるか

- CloudFormation のリソース: `AWS::Lambda::WebFunction`（名前と tag だけ）、`AWS::Lambda::WebFunctionRevision`、`AWS::Lambda::WebFunctionEndpoint`。resource-based policy は `AWS::Lambda::ResourcePolicy`（[AWS::Lambda::WebFunction](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunction.html)、[aws-cdk#39234](https://github.com/aws/aws-cdk/issues/39234)）。SAM には `AWS::Serverless::WebFunction` がある（[AWS SAM](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-webfunction.html)）。
- aws-cdk-lib（npm で確かめた）:
  - 2.274.0（2026-10-20、最新）の `aws-lambda` に、`CfnWebFunction`、`CfnWebFunctionRevision`、`CfnWebFunctionEndpoint`、`CfnNetworkConnector`、`CfnResourcePolicy` がある。L2 はない。
  - 2.273.0（2026-10-08）にも `CfnWebFunction*` がある。2.272.0 には `CfnNetworkConnector` だけがあり、`CfnWebFunction*` はない。最小の版は **2.273.0**。
  - `CfnWebFunctionRevision` の `serviceConfig` に `egressNetworkConnectorArn`、`timeoutSeconds`、`maxConcurrencyPerEnvironment`、`environmentVariables`、`executionRoleArn` がある。`buildConfig.codeConfig.s3Object` は `bucket`、`key`、`versionId`。`CfnWebFunctionEndpoint` に `authType`、`endpointType`、`revisionWeights`、`scalingConfig.maxEnvironments`、`throttleConfig.rateLimit` と、属性の `attrDomainName` がある。
  - CloudFront: 2.274.0 に `SigningBehavior.ALWAYS_AMZ_AUTH` と `Signing.SIGV4_ALWAYS_AMZ_AUTH` があり、`FunctionUrlOriginAccessControl` と `HttpOrigin` と `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER` で Web Functions のオリジンを書く例が `aws-cloudfront-origins` の README にある（[aws-cdk#39196](https://github.com/aws/aws-cdk/pull/39196)）。global の endpoint 用の `Signing.SIGV4A_ALWAYS_AMZ_AUTH` は 2026-10-22 に merge され（[aws-cdk#39216](https://github.com/aws/aws-cdk/pull/39216)）、2.274.0 にはまだない。
- L2 の状況（2026-10-24 時点）:
  - [aws-cdk#39210](https://github.com/aws/aws-cdk/pull/39210)（feat(lambda): add WebFunction and NetworkConnector L2 constructs）は open。`WebFunction`、`WebFunctionCode`、`NetworkConnector`、`WebFunctionEndpoint` を `aws-cdk-lib/aws-lambda` に足す。maintainer は、別の人の alpha の L2 の PR をこれにまとめるよう案内した（[aws-cdk#39234](https://github.com/aws/aws-cdk/issues/39234)）。
  - Web Functions のオリジンの construct（`WebFunctionOrigin` のようなもの）は [aws-cdk#39434](https://github.com/aws/aws-cdk/issues/39434) で open。L2 を待っている。
  - npm には個人の L2（`@ashishpandeyone/cdk-lambda-web-function` 0.1.13）もある。
- コードの置き場所: Web Functions はコードを、自分の S3 bucket の版を固定した object から読む。bucket はバージョニングが要り、Lambda のサービスプリンシパルに `s3:GetObject` と `s3:GetObjectVersion` を与える bucket policy が要る。object の版を消すと、その revision は戻らない `Failed` になる（[Deploying Web Function code from Amazon S3](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-code-s3.html)）。PR #39210 は、CDK の bootstrap の bucket がこれらを満たさないので `lambda.Code.fromAsset` は使えず、asset を別の bucket に写す段が要ると書いている（[aws-cdk#39210](https://github.com/aws/aws-cdk/pull/39210)）。
- revision は作った後に変えられない。環境変数や timeout を変えるにも新しい revision を作る。Web Function ごとに 50 の revision を目安に、使われていない古いものを Lambda が消す（[Managing Web Function revisions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions.html)）。
- Event Functions は従来の L2 で書ける。2.274.0 に `Runtime.NODEJS_24_X` があり、`SqsEventSource` に `reportBatchItemFailures` と `maxConcurrency` がある（パッケージの型定義で確かめた）。
- 判断: 今は L1 で、小さな自前の construct（function、revision、endpoint、resource policy、connector、code の bucket）を書き、#39210 が出たら置き換える。CDK の公式のガイドは、L2 がないリソースに L1 を使うことを、普通の使い方として説明している（[AWS CDK constructs](https://docs.aws.amazon.com/cdk/v2/guide/constructs.html)）。避けるアンチパターンは、保守の続くか分からない個人の 0.x の construct に基盤を預けること。

## pnpm と Nx の monorepo で zip を作る

- AWS のサンプルは、`npm ci --omit=dev` の後に、`index.js`、`package.json`、lock file、`node_modules` を zip にする（[Web Function sample applications](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-samples.html)）。AWS のベストプラクティスは、lock file から本番の依存だけを入れ、開発用のファイルを除き、upload する archive そのものを試すことを勧める（[Best practices](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-best-practices.html)、[Testing Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-testing.html)）。
- `pnpm deploy --prod`: workspace の 1 つの package を、独立した `node_modules` 付きで別の directory に写す。v12.2.0 から `injectWorkspacePackages` は要らない（[pnpm deploy](https://pnpm.io/cli/deploy)）。pnpm の `node_modules` は symlink を使う。zip が symlink を保つかと、Lambda がそれを展開するかは未確認。
- 1つのファイルにまとめる: CDK の `NodejsFunction` は、Event Functions のコードを esbuild でまとめるのが既定（[aws-lambda-nodejs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html)）。実験では、Hono と `@hono/node-server` を含めて 106 KB の 1 ファイルになり、`node_modules` なしで起動した。
- 今の `apps/api/vite.config.ts` は `build.ssr: "src/server.ts"` で、依存を外に出す（`node_modules` から読む）設定。target は `node26`。
- 判断: Web Functions と Event Functions の zip は、1 つの ESM のファイル（`index.js`）と `{"type":"module"}` だけの `package.json` にする。理由は、symlink の扱いの心配がなく、package が小さく（AWS は cold start のために小さくするよう勧める、[Execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html)）、展開した archive をそのまま試せること。これは AWS のサンプルの形（`node_modules` ごと）とは違うが、CDK の `NodejsFunction` の既定と同じ考え方。避けるアンチパターンは、monorepo の `node_modules`（開発用の依存と symlink を含む）をそのまま zip にすることと、x86_64 で作った native のモジュールを入れること。native のモジュールが要る依存が入ったら、`pnpm deploy --prod` を Arm64 の container で動かす形に切り替える。
- Nx: zip を作る target を、`build` に依存する target として足す形が考えられる（判断。Nx の target の依存の普通の使い方）。具体的な設定は未実行。

## Event Functions の SQS の FIFO キューと部分的な失敗の応答

- Lambda の SQS の event source mapping は、標準のキューと FIFO キューの両方に対応する（[Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)）。
- 部分的な失敗の応答は、event source mapping の `FunctionResponseTypes` に `ReportBatchItemFailures` を指定して有効にする。関数は `{ "batchItemFailures": [{ "itemIdentifier": "<messageId>" }] }` を返す（[Handling errors for an SQS event source](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)）。
- FIFO キューでは、最初の失敗で処理を止め、失敗したものと処理していないものを全部 `batchItemFailures` に入れる。キューの順序を保つため（同）。
- 関数が例外を投げると、batch 全体が失敗になる。`itemIdentifier` が空、null、存在しない message ID のときも、batch 全体が失敗になる。空の `batchItemFailures` は全部成功（同）。
- FIFO では、同じ message group の message は順に届き、関数がエラーを返すと、その message をやり直し終えるまで同じ group の次の message を渡さない（[Configuring scaling behavior for SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)）。
- FIFO の同時実行数は、message group ID の数と maximum concurrency（2〜1,000）の小さい方で上限が決まる（同）。ADR 0013 の「ワーカーは同時実行数の上限と接続プール 1 本」は、`SqsEventSource` の `maxConcurrency` で書ける。
- event source mapping は少なくとも 1 回の配信で、重複があり得る。AWS は関数を冪等にするよう強く勧める（[Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)）。
- Powertools for AWS Lambda（TypeScript）の `BatchProcessor` は部分的な失敗の応答を扱う（[Handling errors for an SQS event source](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)）。判断: 入口は小さいので、ECS のワーカーと共通の処理を呼び、FIFO の「最初の失敗で止める」を自分で書く方が、依存が増えず ECS と同じ形にしやすい。Powertools の FIFO 用の処理（`SqsFifoPartialProcessor`）の挙動は未確認。

## Web Functions から Event Function を非同期で起動する

- Event Function を非同期で起動するには、`Invoke` の `InvocationType` を `Event` にする。Lambda は event をキューに入れて 202 を返し、別の処理が関数に渡す（[Invoking a Lambda Event Function asynchronously](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async.html)、[Invoke](https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html)）。
- 権限は `lambda:InvokeFunction`（[Invoke](https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html)）。Web Function のコードは revision の実行ロールで AWS の API を呼ぶので、実行ロールに対象の Event Function の ARN への `lambda:InvokeFunction` を足す（[Web Function permissions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-permissions.html)）。同じアカウントなら、Event Function の resource-based policy は要らない（判断。IAM の同じアカウントの評価の規則）。CDK では `eventFn.grantInvoke(webFunctionRole)` で書ける（判断。`grantInvoke` は `IGrantable` を受ける）。
- 非同期の payload は最大 1 MB。関数がエラーを返すと Lambda は最大 2 回やり直す。キューが追いつかないと event が失われることがあり、エラーがなくても同じ event が複数回届くことがある（[Invoke](https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html)）。ADR 0013 の「取りこぼしに備えて 15 分ごとにも呼ぶ」と、Outbox を送る処理を冪等にする方針は、この性質に合う。
- connector を付けた Web Function から `Invoke` を呼ぶ通信は VPC を通るので、NAT Gateway か Lambda のインターフェイスエンドポイントが要る（「VPC の中の Aurora PostgreSQL と NAT Gateway」の節）。
- 判断: commit の後に、レスポンスを返す前に `Invoke`（`Event`）を await する。`Invoke` の失敗はリクエストの失敗にせず、log に残して 15 分ごとの起動に任せる。応答を返した後に動く処理は、実行環境が消えると止まるため（[Execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html) の「寿命は保証しない」からの読み取り）。

## ADR 0013 と決め直しのコメントとの食い違い

成り立つもの:

- Hono のアプリがそのまま動くこと、streaming が設定なしで使えること、OAC と `IamAuth` と `AllViewerExceptHostHeader`、`x-amz-content-sha256` が要らないこと、WebSocket を ECS だけで扱うこと、Event Functions の `batchItemFailures`、非同期の起動。いずれも一次資料と合う。

食い違うもの、書き足すべきもの:

1. **CDK に L1 しかない。** ADR 0013 は ECS Express Mode を「CDK の L1 しかない」ことを理由の1つに退けたが、Web Functions も 2026-10-24 時点で L1 だけ（aws-cdk-lib 2.274.0。L2 は open の [aws-cdk#39210](https://github.com/aws/aws-cdk/pull/39210)）。理由が同じ形で当てはまる。さらに、コードはバージョニングのある自前の S3 bucket に置く必要があり、CDK の asset の仕組みをそのまま使えない（[Deploying Web Function code from Amazon S3](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-code-s3.html)、#39210）。
2. **NAT Gateway の費用が Lambda の構成にも乗る。** ADR 0013 は NAT Gateway を ECS の文脈で書いている。Web Functions も Event Functions も、VPC の中の DB を使いつつ SQS、SES、Lambda の API を呼ぶなら、NAT Gateway かインターフェイスエンドポイントが要る（[Configuring networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)、[Enable internet access for VPC-connected Lambda Event Functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html)）。どちらも時間で課金されるので、「使っていないときの費用」を理由に Lambda を対象にした ADR の理由が、その分だけ弱まる（判断）。
3. **`maxEnvironments` は 1 にできない。** 範囲は 2〜10,000 で、一時的に超えることがあり、Lambda は先に実行環境を増やす（[Scaling behavior](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)）。「`maxEnvironments` で実行環境の数を抑えて接続プールを持つ」は成り立つが、DB の接続の数の見積もりは最小 2 つ分から始まる。
4. **「1つの実行環境が最大 64 の同時のリクエスト」は既定の上限。** 64 は `maxConcurrencyPerEnvironment` の既定値で、1〜128 に変えられる。実際の上限は Lambda が動的に決め、新しい関数では低く始まる（同）。
5. **streaming は「設定なし」だが、時間の設定は要る。** `timeoutSeconds` の既定 30 秒が stream 全体に効き、CloudFront の origin response timeout の既定 30 秒がパケットの間に効く（[Request timeout](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-timeout.html)、[Origin settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesOrigin.html)）。AI の長い応答には、`timeoutSeconds` を上げ、定期的に何かを送る必要がある。
6. **`Authorization` ヘッダーを使うなら cache policy に入れる。** `GET` と `HEAD` では、cache policy にないと CloudFront が外す（[Restrict access to an AWS Lambda Web Function origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda-web.html)）。決め直しのコメントは origin request policy だけを挙げている。
7. **実行環境は Arm64。** native のモジュールを含む依存は Arm64 用に作る（[Testing Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-testing.html)）。ECS の image を x86_64 で作るなら、成果物の CPU が 2 種類になる（判断）。
8. **FIFO では「最初の失敗で止める」。** ADR 0013 の「`batchItemFailures` を返す」に、FIFO では最初の失敗の後を処理せずに全部返すことを書き足す（[Handling errors for an SQS event source](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)）。

## 未確認のこと

- AWS の上での実行はすべて未実行。特に、CloudFront（OAC、`AllViewerExceptHostHeader`）を通した `streamSSE` が少しずつ届くこと、connector を通した Aurora Serverless v2 への接続、Aurora が 0 ACU から再開する最大 15 秒の間に初期化の 10 秒の制限に当たらないか（接続を最初のリクエストで作れば当たらない見込み。判断）。
- 使われない実行環境が消えるまでの時間と、その間のメモリの費用。
- `AWS_LAMBDA_HTTP_ENDPOINT` の host が IPv6 の形（`[::1]:port`）になることがあるか。AWS の例は `split(':')` だが、IPv6 なら壊れる。
- runtime が `index.mjs` や `AWS_LAMBDA_NODEJS_ENTRYPOINT` で指定した ESM のファイルを読むか。実験では `index.js` と `{"type":"module"}` の形にした。
- `pnpm deploy --prod` で作った `node_modules` の symlink を、zip と Lambda が保つか。
- Vite+ の build で依存を含めて 1 ファイルにまとめる設定（`ssr.noExternal` など）。実験は esbuild で行った。
- CloudFormation で revision を更新するときの順序（新しい revision を作り、endpoint の重みを移し、古い revision を消す）と、`LatestRevision` と `Disabled` の自動デプロイのモードを CloudFormation でどう扱うか。
- Web Functions の log が connector を通らずに CloudWatch Logs に届くか（Event Functions は VPC に入れても log は Lambda が送る）。
- Powertools の `SqsFifoPartialProcessor` の挙動。
- connector の通信に対して、VPC のインターフェイスエンドポイントの private DNS が効くか（DNS の設定は [Configuring networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html) にあるが、AWS の API の endpoint の例はない）。
- PR #39210 の L2 がいつ、どの形で出るか。

## 出典

すべて 2026-10-24 に取得した。

- Lambda Web Functions: [AWS Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)、[Core concepts](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-how-it-works.html)、[Web Function runtimes](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.html)、[Execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html)、[Scaling behavior](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)、[Configuring networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)、[HTTP requests and responses](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-http.html)、[Managing Web Function revisions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions.html)、[Request timeout](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-timeout.html)、[Environment variables](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-env-vars.html)、[Deploying Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-deploying.html)、[Deploying Web Function code from Amazon S3](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-code-s3.html)、[Web Function permissions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-permissions.html)、[Endpoint access control](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html)、[Sample applications](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-samples.html)、[Best practices](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-best-practices.html)、[Testing](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-testing.html)、[Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)、[What's New（2026-10）](https://aws.amazon.com/about-aws/whats-new/2026/10/aws-lambda-web-functions/)、[AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- CloudFront: [Restrict access to an AWS Lambda Web Function origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda-web.html)、[Request and response behavior for custom origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorCustomOrigin.html)、[Origin settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesOrigin.html)、[Serving compressed files](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html)
- Lambda Event Functions と SQS: [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)、[Handling errors for an SQS event source](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)、[Configuring scaling behavior for SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)、[Invoking asynchronously](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async.html)、[Invoke API](https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html)、[Enable internet access for VPC-connected Lambda Event Functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html)、[Lambda interface endpoints](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-endpoints.html)
- SES: [Setting up VPC endpoints with Amazon SES](https://docs.aws.amazon.com/ses/latest/dg/send-email-set-up-vpc-endpoints.html)
- CloudFormation と SAM: [AWS::Lambda::WebFunction](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunction.html)、[AWS::Serverless::WebFunction](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-webfunction.html)
- AWS CDK: [Constructs](https://docs.aws.amazon.com/cdk/v2/guide/constructs.html)、[aws-lambda-nodejs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html)、[aws-cdk#39210](https://github.com/aws/aws-cdk/pull/39210)、[aws-cdk#39234](https://github.com/aws/aws-cdk/issues/39234)、[aws-cdk#39434](https://github.com/aws/aws-cdk/issues/39434)、[aws-cdk#39195](https://github.com/aws/aws-cdk/issues/39195)、[aws-cdk#39196](https://github.com/aws/aws-cdk/pull/39196)、[aws-cdk#39216](https://github.com/aws/aws-cdk/pull/39216)、[v2.273.0 のリリース](https://github.com/aws/aws-cdk/releases/tag/v2.273.0)
- aws-cdk-lib 2.272.0、2.273.0、2.274.0 の中身（`aws-lambda/lib/lambda.generated.d.ts`、`aws-lambda/lib/runtime.d.ts`、`aws-lambda-event-sources/lib/sqs.d.ts`、`aws-cloudfront/lib/origin-access-control.d.ts`、`aws-cloudfront-origins/README.md`）は `npm pack` で取得して確かめた。版の日付は `npm view aws-cdk-lib time`。
- pnpm: [pnpm deploy](https://pnpm.io/cli/deploy)
- 実験に使ったもの: hono 4.13.13、`@hono/node-server` 2.1.5、esbuild 0.28.2、Node.js v24.22.1（mise で入れた）。
