---
type: Convention
title: "ログのキー名の既存規約"
description: "OTel、ECS、各言語のロガー、Apache と nginx、クラウドと SaaS のログ基盤が使うキー名の比較。ログのキー名を決める根拠を確かめるとき、特定の基盤へマッピングするときに読む。"
tags: [logging, convention, opentelemetry, ecs]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forLog/log_guidelines.html
    title: ログ設計ガイドライン
    author: フューチャー株式会社
---

# ログのキー名の既存規約

ログのキー名の標準は OpenTelemetry Semantic Conventions (OTel) で、2023年に ECS が統合された。
各言語のロガー、Web サーバー、クラウドと SaaS の基盤のキー名を比べる。採用するキー名は [ログのキー名](keys.md) で決める。
出典は [ログ設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## 標準的な規約

Elastic Common Schema (ECS) 、OpenTelemetry Semantic Conventionsの2つが有名である。2023年にOpenTelemetry（OTel）にECSが統合された。そのため、OTelが実質的に標準と言える。

- [Announcing the Elastic Common Schema (ECS) and OpenTelemetry Semantic Convention Convergence](https://opentelemetry.io/blog/2023/ecs-otel-semconv-convergence/)

【OTel Semantic Conventions とECS 比較】

| \#             | OpenTelemetry Semantic Conventions                                                                           | Elastic Common Schema (ECS)                                                                        |
| :------------- | :----------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| 説明           | 開発者向けのオブザーバビリティ（トレース、メトリクス、ログの相関）に重点を置く。分散システムの挙動追跡に利用 | セキュリティ分析 (SIEM) と運用分析に重点を置く。豊富なイベント分類語彙、特にセキュリティ分野に強い |
| 構造           | フラットなAttributesとResource                                                                               | ネストされたJSONオブジェクト（論理的にグルーピング）                                               |
| 命名規則       | dot.case (例: service.name)                                                                                  | dot.case (例: service.name)                                                                        |
| タイムスタンプ | timestamp (トップレベル)                                                                                     | @timestamp (トップレベル)                                                                          |
| メッセージ     | body (トップレベル)                                                                                          | message (トップレベル)                                                                             |
| サービス名     | service.name (リソース属性)                                                                                  | service.name (フィールドセット)                                                                    |
| トレースID     | traceId (トップレベル)                                                                                       | trace.id (フィールドセット)                                                                        |

> [!TIP]
> **OTel ログデータ例**
>
> ```json
> {
>   "logRecords": [
>     {
>       "timeUnixNano": "1724737589123456789",
>       "observedTimeUnixNano": "1724737589124567890",
>       "severityNumber": 17,
>       "severityText": "ERROR",
>       "body": {
>         "stringValue": "Payment processing failed due to insufficient funds"
>       },
>       "attributes": [
>         {
>           "key": "http.request.method",
>           "value": { "stringValue": "POST" }
>         },
>         {
>           "key": "http.route",
>           "value": { "stringValue": "/api/v1/payment" }
>         },
>         {
>           "key": "customer.id",
>           "value": { "stringValue": "customer-00123" }
>         },
>         {
>           "key": "payment.processor.error_code",
>           "value": { "intValue": 2001 }
>         }
>       ],
>       "traceId": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
>       "spanId": "1a2b3c4d5e6f7a8b"
>     }
>   ]
> }
> ```

<!-- 前の注記と分ける -->

> [!TIP]
> **ECSデータセット例**
>
> ```json
> {
>   "@timestamp": "2025-08-27T13:46:29.123Z",
>   "ecs": {
>     "version": "8.11.0"
>   },
>   "log": {
>     "level": "error"
>   },
>   "message": "Payment processing failed due to insufficient funds",
>   "service": {
>     "name": "checkout-service",
>     "version": "1.2.5",
>     "instance": {
>       "id": "checkout-7b5b76d9c-x4z2l"
>     },
>     "environment": "production"
>   },
>   "http": {
>     "request": {
>       "method": "POST"
>     },
>     "route": "/api/v1/payment"
>   },
>   "trace": {
>     "id": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
>   },
>   "span": {
>     "id": "1a2b3c4d5e6f7a8b"
>   },
>   "labels": {
>     "customer_id": "customer-00123"
>   },
>   "payment": {
>     "processor": {
>       "error_code": 2001
>     }
>   }
> }
> ```

## 各言語のロガーが利用するキー名

各言語の構造化ロギングライブラリが利用するキー名称をまとめる。

| \#               | Java (Logback \+ logstash-encoder) | Go (標準ライブラリ `slog`) | Python (標準 `logging` \+ python-json-logger) |
| :--------------- | :--------------------------------- | :------------------------- | :-------------------------------------------- |
| タイムスタンプ   | `@timestamp`                       | `time`                     | `timestamp`                                   |
| メッセージ       | `message`                          | `msg`                      | `message`                                     |
| ログレベル       | `level`                            | `level`                    | `levelname`                                   |
| ファイル名       | `caller_file_name`                 | `source`                   | `filename`                                    |
| 行番号           | `caller_line_number`               | `source`                   | `lineno`                                      |
| クラス名         | `caller_class_name`                | 該当なし                   | 該当なし                                      |
| スレッド名       | `thread_name`                      | 該当なし                   | `threadName`                                  |
| ロガー名         | `logger_name`                      | （カスタム属性）           | `name`                                        |
| スタックトレース | `stack_trace ※2`                   | （カスタム属性）※3         | `exc_info` / `exc_text`                       |

- ※1: slogにはロガー名という概念が無い。slog.With("component", "my-service") のように、任意で紐づけるのみである
- ※2: `logger.error("エラー", e);` のように**例外オブジェクト**を渡した際に追加した場合のキー名
- ※3: stackもしくはstacktrace が多そうである

## Apache / nginx

Apacheとnginxのアクセスログでよく利用される、標準的なキー名をまとめる。

| 分類                | 項目                   | Apache           | nginx                |
| :------------------ | :--------------------- | :--------------- | :------------------- |
| Combined Log Format | クライアントIPアドレス | remote_host      | remote_addr          |
|                     | 認証ユーザー           | remote_user      | remote_user          |
|                     | タイムスタンプ         | time             | time_local           |
|                     | リクエストライン ※1    | request          | request              |
|                     | HTTPステータスコード   | status           | status               |
|                     | レスポンスサイズ       | bytes_sent       | body_bytes_sent      |
|                     | リファラ               | referer          | http_referer         |
|                     | ユーザーエージェント   | user_agent       | http_user_agent      |
|                     | リクエスト処理時間     | (追加設定が必要) | request_time         |
|                     | プロキシ先IP (XFF)     | x_forwarded_for  | http_x_forwarded_for |
| カスタム項目        | HTTPメソッド           | method           | request_method       |
|                     | リクエストURI          | request_uri      | request_uri          |

※1 requestは "GET /index.html HTTP/1.1" といった形式で、HTTPメソッドやURIが含まれる。分析を容易にするためカスタム属性で分解することもある。

## プラットフォーム

AWSとGoogle Cloudのログサービスにおける、特別なキー名をまとめる。

| \#             | AWS CloudWatch Logs (Insights)                                                 | Google Cloud Logging (LogEntry)                                                                            |
| :------------- | :----------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| タイムスタンプ | @timestamp                                                                     | timestamp                                                                                                  |
| ログメッセージ | @message                                                                       | jsonPayload                                                                                                |
| ログレベル     | (カスタム属性)                                                                 | severity（INFO, ERROR等の値に応じてUIのアイコンや色が変わり、フィルタリングも容易）                        |
| トレース連携   | ※専用フィールドなし（X-RayのトレースIDをカスタムキーとして含めることが一般的） | trace、spanId（Cloud Traceと自動で連携するためのID。ログエクスプローラ上でトレースへのリンクが生成される） |
| HTTPリクエスト | (カスタム属性)                                                                 | httpRequest。HTTPリクエスト情報（requestMethod, status, latency等）を入れることで、特別に表示される        |
| カスタム属性   | (カスタム属性)                                                                 | labels。インデックス化され、高速な検索・フィルタリングに使いたいキーを指定する                             |

- 見解
  - ソフトなベンダーロックインになるため、移植性を考慮するとOTelの規則を使う方がベター
  - OTelのエクスポーターなど、FWレイヤーでマッピングするイメージ
    - 例: `trace_id` を `logging.googleapis.com/trace` にマッピング
- 思想について
  - AWS CloudWatch Logs
    - `@`で始まるいくつかのメタデータフィールドを除き、ログメッセージ(`@message`)の中身は自由である。クエリ実行時(スキーマオンリード)に必要な情報をパースする考え方が基本
  - Google Cloud Logging
    - `LogEntry`という厳格なオブジェクト構造を持ち、`severity`や`httpRequest`といった定義済みのフィールドに沿って出力する(スキーマオンライト)ことで、特別なUI表示やCloud Traceとシームレスに連携させるという思想である

> [!TIP]
> **AWS CloudWatch Logs の Embedded Metric Format (EMF)**
>
> AWS CloudWatch Logsには、EMFというログイベント内にメトリクスデータを埋め込むためのJSON仕様がある。これを利用することで、PutMetricDataのような同期的APIを呼び出さず、特定のフォーマットで構造化されたログを標準出力に書き出すだけでメトリクス連携ができる。
>
> - [仕様: 埋め込みメトリクスフォーマット \- Amazon CloudWatch](https://docs.aws.amazon.com/ja_jp/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html)

## SaaSオブザーバビリティプラットフォーム

NewRelic、DataDogなどにも独自のキーがある。しかし、OTelのエクスポーターなどの対応が積極的であるため、その層で吸収する方針が妥当だと考えられる。

| \#                                   | DataDog キー | New Relic キー | OpenTelemetry 相当規約 |
| :----------------------------------- | :----------- | :------------- | :--------------------- |
| トレースID                           | dd.trace_id  | trace.id       | trace_id               |
| スパンID                             | dd.span_id   | span.id        | span_id                |
| サービス名                           | service      | entity.name    | service.name           |
| 環境                                 | env          | (カスタム属性) | deployment.environment |
| バージョン                           | version      | (カスタム属性) | service.version        |
| ホスト                               | host         | hostname       | host.name              |
| ログ重要度レベル                     | status       | TODO           | TODO                   |
| ログ生成元 （nginx、postgresqlなど） | source       | TODO           | TODO                   |
