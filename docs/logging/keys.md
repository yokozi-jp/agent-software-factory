---
type: Convention
title: "ログのキー名"
description: "アプリケーションログに出すキー名 (共通スキーマと拡張スキーマ) を定める規約。ログの項目を追加、変更するとき、ロガーを設定するときに読む。"
tags: [logging, convention, opentelemetry]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forLog/log_guidelines.html
    title: ログ設計ガイドライン
    author: フューチャー株式会社
---

# ログのキー名

キー名は OTel の規約に従い、足りないものは ECS の語彙を使う。クラウドや SaaS 固有のキーはアプリから出さない。
全てのログに出す共通スキーマと、HTTP、DB、例外のときに足す拡張スキーマを持つ。
出典は [ログ設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

方針は以下の通り。

1. OTel準拠とECSの語彙を取り入れる
   - 可能な限りOpenTelemetryのセマンティック規約の命名規則に従う
   - 不足していれば、ECSの語彙を取り入れる
   - ログレベルが `severity.text` になるなど、取り入れることが厳しい場合は、 `level` などに一部だけ書き換えることを想定する。ただし、技術標準がある以上、長期的に準拠していく
2. プラットフォーム非依存
   - アプリケーションコード内で出力するキーは、特定のクラウドプロバイダーやSaaSベンダーに固有のキーを含まない
   - プラットフォーム固有のキーへのマッピングは、フレームワークレイヤー（ログコレクター）の責務に（できる限り）する
3. 全てのログに必須の「共通スキーマ」と、特定のコンテキスト（例: HTTPリクエスト、データベースクエリ）に応じて追加されるオプションの「拡張スキーマ」を持つ、階層的な構造とする

| 大分類       | 小分類           | キー名                                                                 | 説明                                                | 例                                    | 理由                                                                                                                                                                      |
| :----------- | :--------------- | :--------------------------------------------------------------------- | :-------------------------------------------------- | :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 共通スキーマ | コアフィールド   | timestamp                                                              | タイムスタンプ。UTC (`Z`) のISO 8601形式、ミリ秒3桁 | "2025-08-26T10:30:00.123Z"            | OTel, ECSの両方で必須                                                                                                                                                     |
|              |                  | severity.text （※使用しているライブラリによってはlevelのままでも許容） | 人間が読むための主要な重大度レベル                  | "ERROR"                               | OTel規約に準拠。ECSでは [log.level](https://www.elastic.co/docs/reference/ecs/ecs-log#field-log-level)                                                                    |
|              |                  | message                                                                | ログの主要なペイロード                              | "User login failed"                   | OTelのBodyに相当。ECSでは[message](https://www.elastic.co/docs/reference/ecs/ecs-base#field-message)                                                                      |
|              | ロガーで自動付与 | service.name                                                           | システム内でサービスを識別する最も重要な属性        | "authentication-service"              | OTel, ECS, DataDog, New Relic全てで中核                                                                                                                                   |
|              |                  | service.version                                                        | リリースの追跡とリグレッション分析に不可欠          | "1.2.3"                               | OTel, ECS, DataDogで標準                                                                                                                                                  |
|              |                  | deployment.environment                                                 | 本番/ステージング環境のフィルタリングに必須         | "production"                          | OTel, DataDogで標準                                                                                                                                                       |
|              | 計装で自動付与   | trace_id                                                               | 分散トレースへの基本的なリンク                      | "a1b2c3d4e5f6..."                     | OTel（[non-OTLP Log Formats](https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/)）, ECS, New Relicに準拠（DataDogはdd.trace_idにマッピング要） |
|              |                  | span_id                                                                | トレース内の特定の操作へのリンク                    | "f1e2d3c4b5a6..."                     | OTel（[non-OTLP Log Formats](https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/)）, ECS, New Relicに準拠（DataDogはdd.span_idにマッピング要）  |
| 拡張スキーマ | HTTP要求/応答    | http.request.method                                                    | HTTPメソッド                                        | "GET"                                 | OTelとECSのHTTP規約から規定                                                                                                                                               |
|              |                  | http.response.status_code                                              | HTTPステータスコード                                | 200                                   |                                                                                                                                                                           |
|              |                  | url.path                                                               | リクエストURL                                       | "/users/123?query=abc"                | OTelでは[url.path](https://opentelemetry.io/docs/specs/semconv/registry/attributes/url/#url-path)                                                                         |
|              |                  | user_agent.original                                                    | ユーザーエージェント                                | "Mozilla/5.0..."                      |                                                                                                                                                                           |
|              |                  | client.address                                                         | クライアントIPアドレス                              | "192.0.2.1"                           | OTelでは[client.address](https://opentelemetry.io/docs/specs/semconv/registry/attributes/client/#client-address)                                                          |
|              |                  | http.request.body.size                                                 | リクエストボディのバイト数                          | 1024                                  | OTelでは[http.request.body.size](https://opentelemetry.io/docs/specs/semconv/registry/attributes/http/#http-request-body-size)                                            |
|              |                  | http.server.request.duration                                           | 処理時間（秒）                                      | 0.125                                 | OTelでは[http.server.request.duration](https://github.com/open-telemetry/semantic-conventions/blob/v1.37.0/docs/http/http-metrics.md)（単位は秒）                         |
|              | DB               | db.system.name                                                         | データベースの種類                                  | "postgresql"                          | OTelのデータベース規約に基づく（`db.system` は非推奨で `db.system.name` に置き換わった）                                                                                  |
|              |                  | db.query.text                                                          | 実行SQL文                                           | "SELECT \* FROM users WHERE id \=?"   | OTelでは `db.statement` は非推奨で `db.query.text` に置き換わった                                                                                                         |
|              |                  | db.operation.name                                                      | 実行操作                                            | "SELECT"                              | OTelでは `db.operation` は非推奨で `db.operation.name` に置き換わった                                                                                                     |
|              |                  | db.client.operation.duration                                           | クエリ実行時間（秒）                                | 0.015                                 | OTelに `db.duration` 属性はなく、メトリクス `db.client.operation.duration`（単位は秒）に合わせる                                                                          |
|              | 例外             | exception.type                                                         | 例外クラス名                                        | "java.lang.NullPointerException"      | OTelでは[exception](https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs)を利用。ECSでは [error](https://www.elastic.co/docs/reference/ecs/ecs-error)   |
|              |                  | exception.message                                                      | エラーメッセージ                                    | "Cannot invoke method on null object" |                                                                                                                                                                           |
|              |                  | exception.stacktrace                                                   | スタックトレース                                    | "at com.example.MyClass..."           |                                                                                                                                                                           |
|              |                  | event.kind                                                             | イベントの種類                                      | "event"                               | ECSでは [event](https://www.elastic.co/docs/reference/ecs/ecs-event)                                                                                                      |
|              |                  | event.category                                                         | イベントのカテゴリ                                  | "error"                               |                                                                                                                                                                           |
|              |                  | event.outcome                                                          | イベントの結果                                      | "failure"                             |                                                                                                                                                                           |
