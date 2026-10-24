---
type: ADR
title: "ADR 0013: API、ワーカー、バッチを ECS と Lambda の両方に置けるようにし、Lambda は Web Functions のために Node.js 24 にし、IaC は AWS CDK で書く"
description: テンプレートの前提を AWS（東京）にし、ECS on Fargate（1つのコンテナイメージ）と Lambda（API は Web Functions、ワーカーは Event Functions）の両方に置けるようにし、そのためにリポジトリを Node.js 24 にし、DB、キュー、バッチ、メール、IaC の既定を決めた決定。デプロイ先や実行基盤を変えるとき、入口のファイルやインフラのコードを足すとき、Node.js の版を変えるとき、Lambda Web Adapter や AWS Blocks や Cloudflare に移したくなったとき、キューや DB の種類を変えたくなったときに読む。
tags: [adr, deploy, aws, ecs, lambda, cdk, runtime]
---

# ADR 0013: API、ワーカー、バッチを ECS と Lambda の両方に置けるようにし、Lambda は Web Functions のために Node.js 24 にし、IaC は AWS CDK で書く

テンプレートは、SI の案件と個人の開発の両方に使います。日本の SI の案件は AWS が多く、取り込んだガイドライン（`docs/async`、`docs/batch`）も AWS を前提にしているので、テンプレートが前提にするクラウドを AWS（東京）にしました。小さな社内の業務システムでは Lambda の方が安く、負荷が続くシステムや WebSocket を使うシステムでは ECS が合います。案件ごとに選べるよう、API と非同期のワーカーを ECS on Fargate と Lambda の両方に置けるようにします。サンプル機能が通らない構成は対象と呼ばないので（[対象にするサービスの型を決める](https://github.com/yokozi-jp/agent-software-factory/issues/42)）、検証環境では両方に出して E2E を流します。

Lambda の API は Lambda Web Functions に置きます。1つの実行環境が最大64の同時のリクエストを受けるので、DB の接続、cold start、課金（CPU は動いた時間だけ）が ECS に近い性質になり、API Gateway も adapter も要りません。Web Functions のランタイムは `nodejs24.x` だけなので、リポジトリ全体を Node.js 24 にします。アプリのコードは Web 標準の API だけで書いているので（ADR 0007）、後から 26 に上げるのは安く済みます。費用は、ECS 用のコンテナイメージと Lambda 用の zip の2種類の成果物を作ること、ワーカーの入口が ECS と Lambda で別の形になること、デプロイと E2E を2回流すことです。経緯は [デプロイ先と実行基盤を決める](https://github.com/yokozi-jp/agent-software-factory/issues/25) とその決め直しのコメントにあります。

## ルール

- 業務の処理は共通のコードにし、実行する場所の違いは入口のファイルで吸収します（ADR 0007 の方針を広げたもの）。入口は、API の `server.ts`（ECS と Web Functions で共通。Web Functions では `AWS_LAMBDA_HTTP_ENDPOINT` を listen する）、ECS のワーカー（SQS を読む繰り返し）、Lambda のワーカー（Event Functions の `handler(event)`。`batchItemFailures` を返す）、締めのバッチです。
- ECS では、API、ワーカー、バッチを1つのコンテナイメージにします。Lambda では、API（Web Functions）とワーカー（Event Functions、`nodejs24.x`）を zip で置きます。
- 締めのバッチは ECS のタスク（EventBridge Scheduler → Step Functions → RunTask）だけで動かします。Lambda は1回の実行が15分で切れるためです。
- 入口は CloudFront 1つにし、web（S3 と OAC）と `/api/*` を同じオリジンにまとめます。`/api/*` の転送先は、ECS なら ALB、Lambda なら Web Functions のエンドポイント（OAC、`IamAuth`、origin request policy は `AllViewerExceptHostHeader`）です。AI のチャットのような応答は SSE の streaming で書き、WebSocket を使う機能は ECS の構成でだけ扱います。
- DB は Aurora PostgreSQL Serverless v2 を VPC の中に置き、最小を 0 ACU にします。Web Functions は `maxEnvironments` で実行環境の数を抑えて接続プールを持ち、Event Functions のワーカーは同時実行数に上限を付けて接続プールを1本にします。
- 非同期処理は、Outbox から SQS の FIFO キュー（DLQ あり）に送ります。Outbox を送る処理は1つの関数にし、ECS ではワーカーが繰り返し呼び、Lambda ではコミットの後に非同期で起動し、取りこぼしに備えて15分ごとにも呼びます。DB を見続けると Aurora が 0 ACU で止まれないためです。
- メールは SES で送ります。ECS のタスクと DB は private subnet に置き、外への通信は NAT Gateway を通します。
- IaC は AWS CDK（TypeScript）で書きます。ECS は ecs-patterns の Fargate のサービスで作り、ECS Express Mode は使いません。Express Mode には CDK の L1 しかなく（[aws-cdk#36234](https://github.com/aws/aws-cdk/issues/36234)）、既定で作られるリソースが IaC から見えにくいためです。
- ローカルと CI では、SQS を ElasticMQ、S3 を S3Mock、メールを Mailpit で代えます。LocalStack は使いません（2026-03-23 からアカウントと token が要り、無料のプランは非商用だけ）。

## Considered Options

- **Node.js 26 のまま、同じコンテナイメージを Lambda Web Adapter で Lambda に置く**: 成果物が1つで済み、実行環境のメモリを 10 GB まで選べ、成果物は 10 GB まで置けます。ただし、Event Functions は1つの実行環境で1件ずつ処理するので、同時のリクエストの数だけ DB の接続と cold start が増え、待つ時間も課金されます。前に置く API Gateway の REST API（streaming のため）も要ります。実行環境に 2 GB を超えるメモリが要る、成果物が 512 MB を超える、Node.js 26 や別の言語を使いたい場合は、こちらに戻ります。
- **Lambda の zip（`nodejs26.x`）**: 2026-10 時点で public preview で、AWS は本番での利用を勧めていません。
- **ECS だけを対象にする**: いちばん単純ですが、使っていないときも課金が続き、小さな案件に勧めにくくなります。
- **App Runner**: 新規の受付を止めています。
- **AWS Blocks**（2026-06 preview）: ローカルの実装と CDK を一度に作れますが、独自の RPC（`ApiNamespace`）と API Gateway で動き、アプリのコードがフレームワークの import に依存します。ADR 0007 の方針と逆で、Hono と OpenAPI の方式が使えません。
- **Cloudflare**（Workers、Queues、R2）: 安く、Hono が動きますが、PostgreSQL は別の事業者（Neon など）に置くことになり、取り込んだガイドラインの書き直しが要ります。
- **RDS for PostgreSQL**: 時間の単価が安く、版をローカルとそろえやすいですが、0 ACU のように止まらないので、Lambda を対象にした理由（使っていないときの費用）が DB で消えます。Aurora express configuration は数秒で作れますが、VPC に入れられず DB にインターネットからの入口が付きます。Aurora DSQL は RLS がありません（ADR 0011）。
- **Outbox の表そのものをキューにする**（Solid Queue、pg-boss の形）: 部品が少なくなりますが、ワーカーが DB を見続けるので Aurora が止まらず、`docs/async` の前提から外れます。
- **Terraform / OpenTofu**: `plan` が読みやすく、フューチャーの設計ガイドラインを取り込めますが、言語と道具が増え、state を自分で管理することになります。

## Consequences

- Node.js 24 と `nodejs24.x` のサポートは 2028-04-30 に終わります。Web Functions が Node.js 26 に対応したら、リポジトリを 26 に上げます。下げる作業は [Node.js を 26 から 24 に下げる](https://github.com/yokozi-jp/agent-software-factory/issues/90) です。
- 検証環境は常には置かず、ときどき作って E2E を流して消します。SLO と外形監視は、常に動く環境が要るので後に回します。流れは [使い捨ての検証環境を作り、E2E を流して消す流れ（CD）を決める](https://github.com/yokozi-jp/agent-software-factory/issues/88) で決めます。
- Web Functions は 2026-10-12 の GA から日が浅く、streaming、VPC の DB への接続、CDK での書き方、Event Functions の部分的な失敗の応答は、[Lambda Web Functions と Event Functions で、Hono の streaming、VPC の DB、SQS の部分的な失敗の応答が動くかを確かめる](https://github.com/yokozi-jp/agent-software-factory/issues/86) で確かめます。成り立たなければ、この ADR を見直します。
- Aurora は 0 ACU から再開するのに最大15秒かかるので、使っていない時間の後の最初のアクセスが遅れます。
