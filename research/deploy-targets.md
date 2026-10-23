# Hono（Node.js 26）の API と web を置ける AWS のデプロイ先を比べる

## 問い

[Issue #24](https://github.com/yokozi-jp/hono-nx-vite-plus/issues/24) の調査。`apps/api`（Hono、Node.js 26、Web 標準の API だけ。ADR 0007）と `apps/web`（React の SPA）を置ける AWS のデプロイ先を、一次資料で比べる。観点は Node.js 26 の対応状況、コンテナの要否、費用の下限、ローカルとの差、IaC の選択肢。ADR 0007 の「Lambda Web Functions は Node.js 24」が今も正しいかも確かめる。

## 要約

- ADR 0007 の記述は一部が古い。Lambda の **Event Functions** は 2026-10-23 時点で `nodejs26.x` を**public preview** として提供する（本番は非推奨、GA 目標は 2026-11）。`nodejs24.x` は正式サポート。
- Lambda の **Web Functions**（2026-10-12 に GA）は「Node.js のみ対応」で、runtime は **`nodejs24.x` だけ**（`nodejs26.x` はまだ無い）。つまり ADR 0007 の「Web Functions は Node.js 24」はこの一点では今も正しい。Hono を名指しで例に挙げている。Tokyo を含む 5 リージョンで提供。
- App Runner は**新規の顧客に閉じた**。AWS は後継として **Amazon ECS Express Mode** を勧める。App Runner のソースコード型ランタイムは Node.js 22 止まり。
- コンテナを使えば（ECS on Fargate、ECS Express Mode、Lambda コンテナイメージ、Lambda Web Adapter）Node.js 26 は自由に選べる。マネージドランタイムに縛られるのは Lambda の zip（`nodejs26.x` は preview）と App Runner のソースコード型（22 止まり）だけ。
- 費用の下限: Lambda（Event / Web とも）は idle の課金が無く、リクエストが来なければゼロに近い。ECS Express Mode と Fargate は常時 1 タスク以上が既定で、idle でも課金が続く。
- web（SPA）は S3 + CloudFront が標準。CloudFront + S3（OAC）+ ACM の構成が AWS のサンプル CloudFormation として提供される。
- IaC は全候補が CloudFormation / CDK に対応する。Lambda Web Functions は CDK / SAM / CloudFormation 対応を公式が明記。
- 判断: どれを選ぶかは別の grilling チケットで決める。本ファイルは事実の整理に徹する。

## 比較

| デプロイ先                             | 対象       | Node.js 26                                       | コンテナ                                   | 費用の下限（idle）                     | IaC             |
| -------------------------------------- | ---------- | ------------------------------------------------ | ------------------------------------------ | -------------------------------------- | --------------- |
| Lambda Web Functions                   | API        | 不可（`nodejs24.x` のみ）                        | 不要（zip / managed）                      | ゼロに近い（active CPU + memory 課金） | CDK / SAM / CFN |
| Lambda Event Functions（Function URL） | API        | preview（`nodejs26.x`、本番非推奨）              | 不要                                       | ゼロに近い                             | CDK / SAM / CFN |
| Lambda + Lambda Web Adapter            | API        | 可（コンテナ / custom runtime 経由）             | 可（同一 image が Fargate / EC2 でも動く） | ゼロに近い                             | CDK / SAM / CFN |
| ECS on Fargate                         | API        | 可（自前の image）                               | 必須                                       | 常時課金（タスク数ぶん）               | CDK / CFN       |
| ECS Express Mode                       | API        | 可（自前の image）                               | 必須                                       | 常時課金（既定 min 1 タスク、Fargate） | CDK / CFN / CLI |
| App Runner                             | API        | 不可（ソースは Node.js 22 止まり、新規受付停止） | source か image                            | 常時課金                               | CDK / CFN       |
| S3 + CloudFront                        | web（SPA） | 該当なし（静的配信）                             | 不要                                       | ほぼ無し（従量）                       | CDK / CFN       |

## Lambda Web Functions

- 2026-10-12 に発表。「your code handles HTTP requests directly」で、Express や **Hono** をそのまま使い、adapter も custom config も要らない（docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.md、aws.amazon.com/about-aws/whats-new/2026/10/aws-lambda-web-functions/、2026-10-12）。
- 対応ランタイムは `nodejs24.x` のみ（表に `nodejs24.x` / Node.js 24 / Supported の 1 行だけ。web-functions-runtimes.md）。「Lambda Web Functions currently support Node.js」と明記。
- 課金は「active CPU time と環境が保持する memory に対してで、downstream を待つ idle の CPU 時間は課金しない」（同 whats-new、2026-10-12）。
- 1 つの warm な実行環境が複数の同時リクエストを処理でき、cold start を桁で減らせる。native の HTTP streaming、multi-Region routing、VPC 接続に対応（同 whats-new）。
- 各実行環境は memory 2 GB、Node.js の V8 heap は既定 1,024 MB、`NODE_OPTIONS` で増やせる。HTTPS のみ、port 443。`AWS_LAMBDA_HTTP_ENDPOINT` が listen 先を渡す（web-functions-runtimes.md）。
- 提供リージョン（2026-10-12 時点）: US East（N. Virginia、Ohio）、US West（Oregon）、Asia Pacific（**Tokyo**）、Europe（Ireland）（同 whats-new）。
- 作成手段: Lambda API、Agent Toolkit、Console、CLI、CloudFormation、SAM、**CDK**、SDK（同 whats-new）。
- ローカルとの差: `AWS_LAMBDA_HTTP_ENDPOINT` はローカルには設定されず、fallback の `localhost:3000` が使われる。ローカルで別アドレスにするときは自分で同変数を設定する（web-functions-runtimes.md）。

## Lambda Event Functions（Function URL）

- 旧称 Lambda functions。2026-10-12 に Web Functions の登場に合わせて「Event Functions」に改名された（名前だけの変更、再デプロイ不要。上記 whats-new）。
- マネージドランタイムの表に `nodejs26.x`（Amazon Linux 2023、Deprecation 未定）がある。ただし Node.js 26 と Python 3.15 は **public preview** で、「SLA やサポートの対象外、本番で使うべきでない。GA までは breaking change があり得る」と明記（lambda-runtimes.md、2026-10-23 取得）。GA 目標は **2026-11**。
- `nodejs24.x` は正式サポートで Deprecation は 2028-04-30。
- Function URL は Event Function 専用の HTTP(S) エンドポイント。API Gateway 無しで公開でき、`AWS_IAM` か `NONE` の auth、CORS を設定できる。CloudFormation の `AWS::Lambda::Url` で作れる（urls-configuration.md）。
- Function URL は public の Internet からのみ。PrivateLink は Function URL では使えない（同）。
- コンテナイメージで関数を作れば、ランタイムと Linux ディストリは image を作るときに選ぶ（lambda-runtimes.md）。つまりコンテナにすれば Node.js 26 を preview の制約なしに使える余地がある（image 側の runtime interface client が Node.js 26 を扱えることが前提。未確認）。

## Lambda + Lambda Web Adapter

- 同一の docker image を AWS Lambda、Amazon EC2、AWS Fargate、ローカルで動かせる。API Gateway（REST / HTTP）、Function URL、ALB に対応（github.com/awslabs/aws-lambda-web-adapter の README、version 1.1.0）。
- README は「新しい Node.js の web app なら Lambda Web Functions を勧める。ほかのランタイムやコンテナイメージでは、Web Functions が対応するまで Lambda Web Adapter を使い続けよ」と案内（同 README）。
- Dockerfile に 1 行（`COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0 ...`）を足すか、zip なら layer を付けて `AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap` を設定する（同）。
- アプリは任意の port で HTTP を listen すればよく、コード側の依存は増えない。SnapStart、response streaming、圧縮などに対応（同）。
- コンテナ or custom runtime なので Node.js 26 を自分で選べる。判断材料: Hono の入口は `@hono/node-server` 等の adapter を使う（ADR 0007 は入口ファイルにランタイム固有コードを閉じ込める方針）。

## ECS on Fargate / ECS Express Mode

- ECS Express Mode は App Runner の後継として AWS が勧める移行先。1 回の API 呼び出しで、container image と 2 つの IAM role を渡すと、**Fargate 上の ECS service、ALB、auto scaling、networking** を一式作る。「Express Mode 自体の追加料金は無く、下回りの AWS リソースの料金だけ払う」（apprunner-availability-change.md、2026-10-23 取得）。
- 作られる既定: default cluster（Fargate capacity provider）、task definition、canary deployment と auto scaling 付きの service、HTTPS listener の ALB、security group、log group、ACM 証明書（express-service-work.md）。
- 既定の task は cpu 1024（1 vCPU）、memory 2048（2 GB）、x86_64（ARM64 も選べる）。既定の desiredCount は 1、auto scaling は min 1 / max 20、target CPU 60%（express-service-work.md）。
- コンテナが必須。image は自分で作るので Node.js 26 を自由に選べる。App Runner のソースコード型から移行するときは、まず Dockerfile で image 化して ECR に push する（apprunner-availability-change.md）。
- 費用の下限: 既定で min 1 タスクが常時走るため、idle でも Fargate のぶん課金が続く（express-service-work.md の desiredMinTaskCount: 1）。Lambda と違い idle をゼロにはできない。
- ローカルとの差: 素の Hono / Node.js プロセスを container で動かすだけなので、ローカルの `node server.ts` と差が小さい（adapter 不要。判断の根拠は ADR 0007 の「入口ファイルで吸収」方針）。
- IaC: ECS / Fargate は CloudFormation と CDK の標準対象。Express Mode は CLI（`create-express-gateway-service`）、Console、GitHub Action でも作れる（apprunner-availability-change.md、express-service-work.md）。
- 素の ECS on Fargate は Express Mode を使わず自前で task / service / ALB を組む選択肢。自由度は高いが設定項目が多い（express-service-work.md が「hundreds of configuration parameters」と対比）。

## App Runner

- 「AWS App Runner is no longer open to new customers.」既存顧客のみ継続利用可。新規は ECS Express Mode を勧める（apprunner-availability-change.md、service-source-code.md、2026-10-23 取得）。
- ソースコード型のマネージドランタイムは Node.js 22 が最新（Node.js 18 以前は 2025-12-01 に End of Support）。Node.js 26 のマネージドランタイムは無い（service-source-code.md、service-source-code-nodejs-releases 参照）。
- image 型（source image）なら自前の image を使えるので Node.js 26 も載せられるが、新規受付が止まっているため新規プロジェクトの選択肢としては外れる。
- 判断: 新規の `apps/api` を App Runner に載せるのはアンチパターン（新規受付停止、公式が後継を明示）。標準の後継は ECS Express Mode（出典: apprunner-availability-change.md）。

## S3 + CloudFront（web / SPA）

- 静的サイト（HTML / CSS / JS / 画像）の標準構成。S3 bucket に content を置き、CloudFront で低レイテンシ配信する。CloudFront は **OAC**（origin access control）で「CloudFront 経由のみ、S3 直アクセス不可」にする。ACM の証明書で HTTPS（getting-started-secure-static-website-cloudformation-template.md）。
- AWS 公式のサンプル CloudFormation（`aws-samples/amazon-cloudfront-secure-static-site`）がこの構成を一括で作る。テンプレートは us-east-1 で deploy する必要がある（同）。
- React の SPA では、ルーティングのために 403/404 を `index.html` に返す設定が要るのが一般的（本サンプルの範囲外。SPA 固有の error response 設定は未確認）。
- IaC: CloudFront / S3 / ACM とも CloudFormation・CDK の標準対象。
- 判断: web は S3 + CloudFront（OAC + ACM）が標準の慣行。避けるアンチパターン: S3 の「static website hosting」エンドポイントを直接公開する（HTTPS や OAC が付かない）。この一文は本サンプルが OAC 構成を勧めることからの読み取りで、別ページの明示は未確認。

## 未確認のこと

- Lambda の**コンテナイメージ**で `nodejs26.x` 相当を本番で（preview 制約なしに）使えるか。Event Functions の image では runtime を image 側で選ぶが、Node.js 26 の runtime interface client の正式対応状況は未確認。
- 各候補の具体的な料金（単価、無料枠、Fargate の vCPU/GB 単価、Lambda の GB 秒と active CPU 課金の係数）。料金は pricing ページで要確認。本調査は「idle に課金があるか否か」の質的な比較に留めた。
- SPA 向けの CloudFront error response（403/404 を index.html にする）設定の公式ページ。
- Lambda Web Functions の `maxConcurrencyPerEnvironment` の既定値と、Hono の実アプリでの同時処理の挙動。
- ECS Express Mode の提供リージョン一覧（Tokyo を含むか）。

## 出典

- Lambda Web Function runtimes: `https://docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.md`（2026-10-23 取得）
- Lambda Event Function runtimes（対応ランタイム表、Node.js 26 preview）: `https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.md`（2026-10-23 取得）
- Lambda Web Functions 発表（日付、Hono 言及、リージョン、CDK）: `https://aws.amazon.com/about-aws/whats-new/2026/10/aws-lambda-web-functions/`（Posted on: Oct 12, 2026）
- Lambda Function URL: `https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.md`（2026-10-23 取得）
- AWS Lambda Web Adapter README（v1.1.0）: `https://github.com/awslabs/aws-lambda-web-adapter`
- App Runner availability change（新規受付停止、ECS Express Mode 推奨、追加料金なし）: `https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.md`（2026-10-23 取得）
- App Runner service based on source code（Node.js 22 止まり、EOS）: `https://docs.aws.amazon.com/apprunner/latest/dg/service-source-code.md`（2026-10-23 取得）
- ECS Express Mode が作るリソース（Fargate、ALB、既定 min 1 タスク、cpu/memory）: `https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-work.md`（2026-10-23 取得）
- CloudFront のセキュアな静的サイト（S3 + OAC + ACM）: `https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/getting-started-secure-static-website-cloudformation-template.md`（2026-10-23 取得）
- ADR 0007（API のランタイムと Web 標準の方針）: `docs/adr/0007-api-on-node-web-standard-app.md`
