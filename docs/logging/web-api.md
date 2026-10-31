---
type: Convention
title: "Web API のログ出力"
description: "Web API のアクセスログを出すタイミングと項目を定める規約。API のミドルウェアでアクセスログを実装するとき、ヘルスチェックや OPTIONS のログを扱うときに読む。"
tags: [logging, convention, web-api, access-log]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forLog/log_guidelines.html
    title: ログ設計ガイドライン
    author: フューチャー株式会社
---

# Web API のログ出力

アクセスログはリクエストとレスポンスの両方で出す。ヘルスチェックのアクセスログは出さない。
[ログのキー名](keys.md) の共通スキーマに加えて、URL パス、HTTP メソッド、ステータスコード、処理時間などを出す。
出典は [ログ設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

Web APIアクセスに対して適切にログ出力することで、不具合検知やセキュリティインシデントの調査、性能分析などに役立てられる。

## アクセスログ

アクセスログは、システムに対するリクエストとレスポンスの記録である。出力タイミングは、推奨順に次の3パターンがある。

1. （推奨）リクエスト/レスポンスの両方で出力（リクエストとレスポンスの両方を出すことで、調査性を上げる。ログ量は倍になるが、保守運用性を高めることを優先するため）
1. レスポンス後に出力（処理時間やステータスコードを出力できるため）
1. リクエストが届いた瞬間に出力

> [!TIP]
> **ヘルスチェックのアクセスログは出力させない**
>
> ヘルスチェックに対するアクセスログは除外するような分岐を入れた方が良い。ヘルスチェックAPIはロードバランサーなどシステム内部側で利用されるため、ログを出力すると調査分析の妨げになり、余計なキャッシュアウトにも繋がるためである。

<!-- 前の注記と分ける -->

> [!TIP]
> **OPTIONSのログは出すべきか？**
>
> Web API設計ガイドライン > [機能配置](../web-api/aws-feature-placement-and-release.md#機能配置aws)では、CORS対応のためのOPTIONSメソッドはAPIゲートウェイなどで対応させることが推奨である。もし、アプリケーション側でOPTIONSメソッドを実装する場合は、トラブルシューティングやセキュリティ上の監視に役立つため、特にHTTPメソッドで絞らずそのままログを出しておく方が良い。

<!-- 前の注記と分ける -->

> [!NOTE]
> **参考**
>
> [OWASP/CheatSheetSeries](https://github.com/OWASP/CheatSheetSeries)の[cheatsheets/Logging_Cheat_Sheet.md](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Logging_Cheat_Sheet.md)

## ログ項目

[ログのキー名](keys.md) で定義した共通スキーマに加え、以下の項目を出力する。

| 項目             | キー名                       | 要求時 | 応答時 | 備考                                                                                                      |
| :--------------- | :--------------------------- | :----- | :----- | :-------------------------------------------------------------------------------------------------------- |
| タイムスタンプ   | timestamp                    | ✅️     | ✅️     | ISO 8601形式で、UTC (`Z`) のミリ秒3桁に固定する。2024-10-12T11:23:01.123Z。JST (`+09:00`) は使わない      |
| ログレベル       | severity.text                | ✅️     | ✅️     | info固定または、要求時をdebug・応答時にinfoにしても良い                                                   |
| リクエストID     | http.request.id              | ✅️     | ✅️     | トレース用のID。リクエストヘッダーに存在する場合はそれを、存在しなければサーバー側で採番した値を出力      |
| URLパス          | url.path                     | ✅️     | ✅️     | 相対パス。 `/api/v1/users`                                                                                |
| HTTPメソッド     | http.request.method          | ✅️     | ✅️     | HEAD,GET,POST,PUT,PATCH,DELETE                                                                            |
| 送信元IPアドレス | client.address               | ❓️     | ❓️     | パブリックAPIの場合、個人情報特定に繋がる可能性があるため、出力可否はプロジェクトのセキュリティ基準に従う |
| ユーザーID       | user.id                      | ❓️     | ❓️     | ログイン済みの場合、ユーザーIDを出力する                                                                  |
| ステータスコード | http.response.status_code    | ー     | ✅️     | HTTPステータスコード                                                                                      |
| 処理時間         | http.server.request.duration | ー     | ✅️     | 秒を推奨（OTel の http.server.request.duration の単位は秒）                                               |
| User Agent       | user_agent.original          | ✅️     | ✅️     | クライアントの特定に利用する。                                                                            |

## 認証、認可、入力の検証の失敗

[OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) は、認証、認可、セッション、入力の検証の失敗を記録するよう求める。このリポジトリでは、アクセスログの応答の行のあとに、次の応答に限って理由つきの 1 行を `info` で足す ([ADR 0049](../adr/0049-logging-with-pino-behind-a-logger-interface.md))。

| 応答           | `event.category` | 備考                                                                      |
| :------------- | :--------------- | :------------------------------------------------------------------------ |
| 401            | authentication   | Problem の `type` を `error.type` に出す                                  |
| 403            | iam              | 同上                                                                      |
| 400 の検証失敗 | web              | `type` が `/problems/validation` のとき。入力した値と `errors` は出さない |

それ以外の 4xx は足さない。`warn` にしないのは、攻撃を受けたときに通知が鳴り続ける (alarm fog) のを避けるため。5xx は `app.onError` が `error` で 1 行書く (`event.code` つき)。
