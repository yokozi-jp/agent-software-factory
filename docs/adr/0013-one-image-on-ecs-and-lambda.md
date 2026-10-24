---
type: ADR
title: "ADR 0013: API、ワーカー、バッチは同じ Node.js 26 のコンテナイメージにして ECS と Lambda の両方に置き、IaC は AWS CDK で書く"
description: テンプレートの前提を AWS（東京）にし、apps/api の API、非同期のワーカー、締めのバッチを1つのコンテナイメージにして ECS on Fargate と Lambda（Lambda Web Adapter）の両方に置き、DB、キュー、バッチ、メール、IaC の既定を決めた決定。デプロイ先や実行基盤を変えるとき、入口のファイルやインフラのコードを足すとき、Lambda Web Functions や AWS Blocks や Cloudflare に移したくなったとき、キューや DB の種類を変えたくなったときに読む。
tags: [adr, deploy, aws, ecs, lambda, cdk, container]
---

# ADR 0013: API、ワーカー、バッチは同じ Node.js 26 のコンテナイメージにして ECS と Lambda の両方に置き、IaC は AWS CDK で書く

テンプレートは、SI の案件と個人の開発の両方に使います。日本の SI の案件は AWS が多く、取り込んだガイドライン（`docs/async`、`docs/batch`）も AWS を前提にしているので、テンプレートが前提にするクラウドを AWS（東京）にしました。小さな社内の業務システムでは Lambda の方が安く、負荷が続くシステムや WebSocket を使うシステムでは ECS が合います。案件ごとに選べるよう、`apps/api` の API、非同期のワーカー、締めのバッチを1つの Node.js 26 のコンテナイメージにして、ECS on Fargate と Lambda の両方に置けるようにします。サンプル機能が通らない構成は対象と呼ばないので（[対象にするサービスの型を決める](https://github.com/yokozi-jp/agent-software-factory/issues/42)）、検証環境では両方に出して E2E を流します。費用は、IaC に2つの分岐を持つことと、デプロイと E2E を2回流すことです。経緯は [デプロイ先と実行基盤を決める](https://github.com/yokozi-jp/agent-software-factory/issues/25) にあります。

## ルール

- 実行の単位は1つのイメージで、違いは入口のファイル（API、ワーカー、バッチ）で吸収します（ADR 0007 の方針を広げたもの）。Lambda では [Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter) を Dockerfile に入れて同じイメージを動かし、Lambda 用のコードを `apps/api/src` に入れません。
- 締めのバッチは ECS のタスク（EventBridge Scheduler → Step Functions → RunTask）だけで動かします。Lambda は1回の実行が15分で切れるためです。
- 入口は CloudFront 1つにし、web（S3 と OAC）と `/api/*` を同じオリジンにまとめます。`/api/*` の転送先は、ECS なら ALB、Lambda なら API Gateway の REST API（`STREAM` の転送モード）です。AI のチャットのような応答は SSE の streaming で書き、WebSocket を使う機能は ECS の構成でだけ扱います。
- DB は Aurora PostgreSQL Serverless v2 を VPC の中に置き、最小を 0 ACU にします。Lambda からは同時実行数に上限を付け、実行環境ごとの接続プールを1〜2本にします。
- 非同期処理は、Outbox から SQS の FIFO キュー（DLQ あり）に送ります。Outbox を送る処理は1つの関数にし、ECS ではワーカーが繰り返し呼び、Lambda ではコミットの後に起動し、取りこぼしに備えて15分ごとにも呼びます。DB を見続けると Aurora が 0 ACU で止まれないためです。
- メールは SES で送ります。ECS のタスクと DB は private subnet に置き、外への通信は NAT Gateway を通します。
- IaC は AWS CDK（TypeScript）で書きます。ECS は ecs-patterns の Fargate のサービスで作り、ECS Express Mode は使いません。Express Mode には CDK の L1 しかなく（[aws-cdk#36234](https://github.com/aws/aws-cdk/issues/36234)）、既定で作られるリソースが IaC から見えにくいためです。
- ローカルと CI では、SQS を ElasticMQ、S3 を S3Mock、メールを Mailpit で代えます。LocalStack は使いません（2026-03-23 からアカウントと token が要り、無料のプランは非商用だけ）。

## Considered Options

- **Lambda Web Functions**（2026-10-12 GA）: adapter なしで Hono を動かせますが、ランタイムは `nodejs24.x` だけです。Node.js 26 を下げることになるので採りません。Node.js 26 に対応したら、Lambda の入口を移すかを判断します。
- **Lambda の zip（`nodejs26.x`）**: 2026-10 時点で public preview で、AWS は本番での利用を勧めていません。
- **ECS だけを対象にする**: いちばん単純ですが、使っていないときも課金が続き、小さな案件に勧めにくくなります。Lambda に移れる形だけを残して確かめないと、気づかないうちに壊れます。
- **App Runner**: 新規の受付を止めています。
- **AWS Blocks**（2026-06 preview）: ローカルの実装と CDK を一度に作れますが、Lambda と独自の RPC（`ApiNamespace`）で動き、アプリのコードがフレームワークの import に依存します。ADR 0007 の方針と逆で、Hono と OpenAPI の方式が使えません。
- **Cloudflare**（Workers、Queues、R2）: 安く、Hono が動きますが、Workers は Node.js で動かず、PostgreSQL は別の事業者（Neon など）に置くことになり、取り込んだガイドラインの書き直しが要ります。
- **RDS for PostgreSQL**: 時間の単価が安く、版をローカルとそろえやすいですが、0 ACU のように止まらないので、Lambda を対象にした理由（使っていないときの費用）が DB で消えます。Aurora express configuration は数秒で作れますが、VPC に入れられず DB にインターネットからの入口が付きます。Aurora DSQL は RLS がありません（ADR 0011）。
- **Outbox の表そのものをキューにする**（Solid Queue、pg-boss の形）: 部品が少なくなりますが、ワーカーが DB を見続けるので Aurora が止まらず、`docs/async` の前提から外れます。
- **Lambda の前に Function URL と OAC を置く**: POST と PUT のたびに、ブラウザが本文の SHA-256 を `x-amz-content-sha256` に付ける必要があります。HTTP API は streaming の対応を確認できませんでした。
- **Terraform / OpenTofu**: `plan` が読みやすく、フューチャーの設計ガイドラインを取り込めますが、言語と道具が増え、state を自分で管理することになります。

## Consequences

- 検証環境は常には置かず、ときどき作って E2E を流して消します。SLO と外形監視は、常に動く環境が要るので後に回します。流れは [使い捨ての検証環境を作り、E2E を流して消す流れ（CD）を決める](https://github.com/yokozi-jp/agent-software-factory/issues/88) で決めます。
- Lambda Web Adapter で SQS の部分的な失敗の応答と REST API の streaming が動くかは、[Lambda Web Adapter で SQS の部分的な失敗の応答と REST API の streaming が動くかを確かめる](https://github.com/yokozi-jp/agent-software-factory/issues/86) で確かめます。動かなければ、この ADR を見直します。
- Aurora は 0 ACU から再開するのに最大15秒かかるので、使っていない時間の後の最初のアクセスが遅れます。
