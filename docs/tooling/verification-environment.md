---
type: Architecture
title: 検証環境の流れ
description: AWS の上に検証環境を作り、migration を当て、E2E を流して消す流れ（起動の条件、順序、ECS と Lambda の並列、イメージと zip の検査、WireMock、消し忘れの保険）と、本番の CD との違いを定める文書。検証環境の workflow や CDK の stack を書く、変えるとき、検証環境が失敗したとき、本番の CD を設計するときに読む。
tags: [tooling, architecture, verification-environment, cd, aws, cdk]
---

# 検証環境の流れ

検証環境は、AWS の上の配線をローカルの代わりでは確かめられない範囲だけ確かめるために、作って E2E を流して消す環境です ([用語集](../../GLOSSARY.md))。常には置きません。
取り込んだ docs (`docs/web-frontend/minify.md`、`docs/batch/release.md` など) の「検証環境」は、常に置く staging を指します。ここでの検証環境とは別の意味で、原文のまま残しています。

決定の経緯は [使い捨ての検証環境を作り、E2E を流して消す流れ（CD）を決める](https://github.com/yokozi-jp/agent-software-factory/issues/88) と [検証環境で migration をどこから、いつ当てるかを決める](https://github.com/yokozi-jp/agent-software-factory/issues/203) の解決コメントにあります。この流れは [ADR 0013](../adr/0013-api-on-ecs-and-lambda-web-functions.md) の構成を確かめるためのものです。workflow、CDK の stack、aws-nuke、E2E は、サンプル機能とインフラの spec で実装します。この文書は実装の前に決めた流れです。

## 確かめるもの

日々の E2E は、ローカルと CI の Docker (testcontainers の PostgreSQL、ElasticMQ、S3Mock、Mailpit) で流します。検証環境の E2E は、各経路を 1 本ずつ通す smoke に絞ります。業務ルールの網羅は、ローカルと CI で済ませます。

- CDK で deploy でき、IAM の権限がそろっていること。
- CloudFront、OAC を通して API が届き、SSE が少しずつ届くこと。
- Arm64 の zip とコンテナイメージが、実際の実行環境で起動すること。
- Aurora が 0 ACU から再開するときに、タイムアウトに当たらないこと。
- ADR 0013 の Consequences にある、AWS の上で未確認の点 (IPv6 の外向きの通信、Web Functions のログ、streaming、connector を通した Aurora、Cognito への IPv6、ECR の dual-stack のエンドポイント、IPv6 だけの subnet から Aurora への接続、pull-through cache)。smoke の assert で確かめます。

## いつ流すか

- 手動の `workflow_dispatch` (任意のブランチから。入力 `keep`) と、main での週に 1 回の定期の実行です。インフラを変える PR は、merge の前に手動で試せます。
- PR の必須チェックにしません。main で失敗したら Issue で知らせます。
- merge ごとには流しません (1 回 30〜60 分、約 0.5 ドル)。`release.yml` は何もデプロイしないので、リリースの前も条件にしません。
- 定期の実行を置く理由 (判断): Renovate の PR (aws-cdk-lib、AWS SDK、ベースイメージ) は検証を通らずに merge されます。AWS の側の変化、Grype の DB の更新、destroy と aws-nuke の経路が壊れていないことは、コードを変えなくても確かめ続ける必要があります。費用は月に約 2 ドルです。
- `keep` の既定は false です。true なら destroy を飛ばし、残した環境は翌日の aws-nuke で消えます。定期の実行では必ず消します。
- エージェントは検証の流れを起動しません。起動できるのは Write の権限を持つ人 (今は所有者だけ) です。この禁止は [エージェントの権限の線引き](https://github.com/yokozi-jp/agent-software-factory/issues/33) の表に載せます (表は [#134](https://github.com/yokozi-jp/agent-software-factory/issues/134) で作ります)。

## アカウントと認証

- 管理アカウント (請求、Organizations、IAM Identity Center、Budgets、Cost Anomaly Detection。workload は置かない) と、検証用のアカウント 1 つです。テンプレートが前提にするのは「1 つのアカウントに OIDC のロールと CDK の bootstrap がある」ことだけです。SI の案件では、顧客の landing zone から sandbox のアカウントをもらいます。
- Control Tower は入れません (判断)。2 つのアカウントでは得るものが少なく、作って消す環境では AWS Config の configuration item (1 件 0.003 ドル) が毎回増えます。
- GitHub のロールは OIDC で assume し、CDK の bootstrap のロール 4 つへの `sts:AssumeRole` だけを許します。`sub` は environment `verification` に固定した ID 付きの形を `StringEquals` で書きます。CloudFormation の実行ロールは既定の `AdministratorAccess` のままです (権限の境界はアカウントの分離。判断)。
- environment `verification` はすべてのブランチから deploy でき、required reviewers は置きません。協力者が増えたら足します。

## 順序

1. **build**: ECS のイメージと Lambda の zip を作り、検査と attestation を付けます。
2. **deploy**: `cdk deploy` (express mode)。構成ごとに stack を data (VPC、Aurora、ECS のクラスター、migrate のタスク定義) と app に分け、data の deploy、migration、app の deploy の順に流します。
3. **migration**: 下の節。
4. **E2E**: 下の節。
5. **destroy**: 別の job で、`if: always()`。標準のモードで、消し終わったことを確かめます。

`concurrency` で同時に流れるのを 1 本にし、stack の名前は固定にします。

### ECS と Lambda の並列

同じアカウントに、独立した `verify-ecs` と `verify-lambda` を作り、matrix で並列に流します。それぞれが VPC、Aurora、CloudFront、Cognito を持ちます。ネットワークの形 (NAT Gateway か、dual-stack と egress-only internet gateway か) が違うので、共有するとどちらかの配線を確かめられなくなります。

残す stack は `verify-shared` だけです。テスト用のドメインの Route 53 の hosted zone、SES のドメインの ID (検証は最大 72 時間)、受信のルール、受信したメールを置く S3 を入れます。CloudFront と Cognito は既定のドメインを使います。

stack は構成ごとに data と app に分け、`verify-ecs-data`、`verify-ecs-app`、`verify-lambda-data`、`verify-lambda-app` になります。

### migration

- migrate 用の ECS のタスク定義 (アプリと同じイメージ、入口 `migrate`) を data の stack に置きます。GitHub の job が `aws ecs run-task` で 1 回起動し、`aws ecs wait tasks-stopped` (最大 10 分) で待ち、コンテナの `exitCode` で成否を決めます。本番の CD と同じ形です ([ADR 0025](../adr/0025-kysely-and-dbmate-sql-first.md))。
- dbmate には `--wait --wait-timeout 60s` を付けます。Aurora が 0 ACU から再開するのに最大 15 秒かかるためです。DB への最初の接続は migrate のタスクになります。
- 検証環境の DB は毎回空です。本物の Aurora で全部の migration の適用を毎回確かめます。2 回目の `migrate` が何もしないことは、CI (testcontainers) だけで確かめます。
- Lambda の構成では、ECS のタスク (migrate、締めのバッチ、WireMock) を IPv6 だけの private subnet に置き、イメージは ECR の dualstack の URI で指定します (ADR 0013)。

### E2E

- GitHub の runner から、各 stack の CloudFront の URL に向けて Playwright で流します。範囲は、各経路を 1 本ずつ通す smoke です (画面、API、DB、Outbox から SQS とワーカー、SES の受信、人事システムのフェイク、締めのバッチ、CSV を S3 に置く)。
- テスト用の利用者 (申請者、上長、経理) は、毎回 Cognito の `AdminCreateUser` で作り、managed login を画面で通します。
- 人事システムのフェイクは WireMock を stack ごとに Fargate のタスク 1 つで動かします。スタブはローカル、CI と同じ JSON をイメージに焼き込み、internal ALB から呼びます。イメージは ECR の pull-through cache から取ります。S3 は本物を使い、会計システムのフェイクは作りません。

## イメージと zip の検査と署名

| 段階         | すること                                                                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR の CI     | hadolint で Dockerfile を検査し、必須チェックにする (Dockerfile ができてから)                                                                                                                                                            |
| build の job | Grype でスキャンし、`--only-fixed` の High と Critical で失敗させる。Syft で SBOM を作る (zip は `--select-catalogers +javascript-package-cataloger`)。`actions/attest` で provenance と SBOM を付ける。Grype と Syft は mise で固定する |
| deploy の前  | `gh attestation verify` で検証する。イメージは digest で deploy し、zip は検証したものをそのまま CDK に渡す                                                                                                                              |

- `actions/attest` は public のリポジトリなので GHEC が要りません。
- Trivy は使いません ([ADR 0021](../adr/0021-sast-and-dependency-scan.md)、2026-03 の侵害)。
- Lambda のコード署名 (Web Functions には使えない) と ECR managed signing は、既定にしません。署名の強制まで要る案件の選択肢です。構成によって守りが違わないよう、既定は attestation の検証にそろえます (判断)。

## 消し忘れの保険

- 日に一度、aws-nuke (ekristen の fork) で検証用のアカウントを掃除します。
- Budgets と Cost Anomaly Detection は通知だけに使います。リソースを消さず、知らせが数時間から 24 時間遅れます。
- spend limit は使いません。新しい sign-up の spend limit は日本の住所だとシドニーに固定され、東京を使うために advanced features を有効にすると使えなくなります。

## 本番の CD との違い

テンプレートが作るのは、検証の流れと、environment の名前を引数に取る CDK のアプリまでです。本番の CD は作らず、次の違いを示します。

| 項目          | 検証環境                 | 本番の CD                                                                                                                                                                    |
| ------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 環境          | 作って消す               | 常に置く                                                                                                                                                                     |
| 承認          | なし                     | 案件ごとに置く                                                                                                                                                               |
| deploy の方式 | 全部を新しく作る         | blue/green など                                                                                                                                                              |
| migration     | 空の DB に全部を適用する | データのある DB に、前の版のアプリが動いている間に流す。互換を保つ expand と contract にし、`lock_timeout` を付ける ([ADR 0025](../adr/0025-kysely-and-dbmate-sql-first.md)) |
| DB の削除     | `DESTROY`                | `RETAIN`                                                                                                                                                                     |
| ロールバック  | なし (消して作り直す)    | アプリの前の版へ戻し、スキーマは前向きの migration で直す                                                                                                                    |

- `RemovalPolicy.DESTROY` と `autoDeleteObjects` は environment ごとの設定で分け、本番に漏らさないようにします。
- 検証環境は、データのある DB に、前の版のアプリが動いている間に migration を流すことを確かめません。
- 本番では、migrator の扱いを変える選択肢があります (人ごとの保守ユーザーなど)。
