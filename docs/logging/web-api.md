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
> Web API設計ガイドライン > [機能配置](https://future-architect.github.io/arch-guidelines/documents/forWebAPI/web_api_guidelines.html#機能配置aws)では、CORS対応のためのOPTIONSメソッドはAPIゲートウェイなどで対応させることが推奨である。もし、アプリケーション側でOPTIONSメソッドを実装する場合は、トラブルシューティングやセキュリティ上の監視に役立つため、特にHTTPメソッドで絞らずそのままログを出しておく方が良い。

<!-- 前の注記と分ける -->

> [!NOTE]
> **参考**
>
> [OWASP/CheatSheetSeries](https://github.com/OWASP/CheatSheetSeries)の[cheatsheets/Logging_Cheat_Sheet.md](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Logging_Cheat_Sheet.md)

## ログ項目

[ログのキー名](keys.md) で定義した共通スキーマに加え、以下の項目を出力する。

| 項目             | キー名                       | 要求時 | 応答時 | 備考                                                                                                                 |
| :--------------- | :--------------------------- | :----- | :----- | :------------------------------------------------------------------------------------------------------------------- |
| タイムスタンプ   | timestamp                    | ✅️     | ✅️     | ISO 8601形式でミリ秒まで保持する。タイムゾーンはUTC 2024-10-12T11:23:01.123Z またはJST 2024-10-12T20:23:01.123+09:00 |
| ログレベル       | severity.text                | ✅️     | ✅️     | info固定または、要求時をdebug・応答時にinfoにしても良い                                                              |
| リクエストID     | request.id                   | ✅️     | ✅️     | トレース用のID。リクエストヘッダーに存在する場合はそれを、存在しなければサーバー側で採番した値を出力                 |
| URLパス          | url.path                     | ✅️     | ✅️     | 相対パス。 `/api/v1/users`                                                                                           |
| HTTPメソッド     | http.request.method          | ✅️     | ✅️     | HEAD,GET,POST,PUT,PATCH,DELETE                                                                                       |
| 送信元IPアドレス | client.address               | ❓️     | ❓️     | パブリックAPIの場合、個人情報特定に繋がる可能性があるため、出力可否はプロジェクトのセキュリティ基準に従う            |
| ユーザーID       | user_id                      | ❓️     | ❓️     | ログイン済みの場合、ユーザーIDを出力する                                                                             |
| ステータスコード | http.response.status_code    | ー     | ✅️     | HTTPステータスコード                                                                                                 |
| 処理時間         | http.server.request.duration | ー     | ✅️     | ミリ秒を推奨                                                                                                         |
| User Agent       | user_agent.original          | ✅️     | ✅️     | クライアントの特定に利用する。                                                                                       |
