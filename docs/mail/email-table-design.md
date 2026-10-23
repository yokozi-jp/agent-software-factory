---
type: Convention
title: "メールアドレスのテーブル設計"
description: "メールアドレスを自システムで持たず IDaaS に委任する前提と、保持する場合のテーブル設計を定める規約。メールアドレスを DB に保存するとき、IDaaS と同期するときに読む。"
tags: [mail, convention, idaas, database]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forMail/mail_guidelines.html
    title: メール設計ガイドライン
    author: フューチャー株式会社
---

# メールアドレスのテーブル設計

認証・認可は IDaaS に委任し、原則メールアドレスを自システムで管理せず、必要ならキャッシュとして保持する。
IDaaS の Webhook でプロファイルの変更を同期する。
出典は [メール設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## メールアドレス保存のためのテーブル設計

本ガイドラインでは、認証・認可の責務をAuth0やAmazon CognitoといったIDaaSに委任し、自前のログイン機構を作り込まないことをシステム設計の前提とする。つまり、ユーザーに関する情報の信頼できる唯一の情報源はIDaaSとなる。自社サービスのデータベースが保持するユーザー情報は、IDaaSが持つ情報の「キャッシュ」か「アプリケーション固有の追加情報」となる。メールアドレスの変更や追加、削除といったライフサイクル管理は、すべてIDaaS側で行われる。

推奨は以下の通り。

- 原則、メールアドレスを自システムで管理せず、必要があればIDaaSに依存した作りとする
- メールアドレスが必要な場合は、usersテーブルにemailカラムを追加し、IDaaSからの情報をキャッシュとして保持することを許容する
- IDaaSが提供するWebhookやイベント通知の仕組みを利用し、プロファイルの変更を自社サービスに同期させる

> [!TIP]
> **ERDイメージ**
>
> IDaaSファーストのアーキテクチャでは、メールアドレスやパスワードといった認証情報はIDaaS側で管理するため、自システム側のデータモデルはシンプルになる。id (主キー): Auth0やAmazon CognitoといったIDaaSから発行される不変のユーザーID（subクレームなど）を文字列として格納する想定である。
>
> ```mermaid
> erDiagram
>     users {
>         varchar id PK "IDaaSから提供される一意のユーザーID (subなど)"
>         varchar mail_addr "メールアドレス"
>         varchar application_role "アプリケーション固有の属性（ロール情報など）"
>         varchar sync_message_id "IDaaS同期時のトランザクションID"
>         timestamp last_synced_at "IDaaSとの最終同期日時"
>         timestamp created_at "作成日時"
>         timestamp updated_at "更新日時"
>     }
> ```
>
> アプリケーション固有の情報: application_roleのように、自社サービス内でのみ意味を持つ役割や設定などの情報を保持する。

<!-- 前の注記と分ける -->

> [!TIP]
> **IDaaS同期フロー**
>
> IDaaSが提供するWebhookを利用することで、メールアドレスの変更ロジックを自前で実装する必要がなくなり、常にIDaaSを正とできる。
>
> 1. ユーザーがIDaaSの提供するアカウント管理画面で、自身のメールアドレスを変更する
> 2. IDaaSは「ユーザープロファイル更新」イベントを発行し、事前に登録されたWebhookエンドポイントへ通知する
> 3. 自システムが通知を受信し、必要に応じてDBを更新

<!-- 前の注記と分ける -->

> [!TIP]
> **もし、自システムでメールアドレス管理する場合**
>
> メールアドレスは、アカウント作成（サインアップ）時に必須項目として求めることが多いが、その値はライフサイクルを通じて不変ではない。以下を考慮したテーブル設計が必要である。
>
> - ユーザーがメールアドレスを変更する
> - リカバリ用の別のアドレスを追加で紐づける（ユーザー：アドレス \= 1:Nになる）
> - プライマリーで用いるメールアドレスを変更する
> - 複数登録済みであれば、プライマリー以外のメールアドレスを削除する
> - 有効性に、検証済み/未検証という区別がある
>
> 上記を考慮すると、ユーザーテーブルから、メールアドレスを専門に管理するuser_emailsテーブルを分離する必要がある。
>
> ```mermaid
> erDiagram
>     m_user {
>         string id "ユーザーID (主キー)"
>         string username "ユーザー名"
>         string status "ステータス (active, deleted)"
>     }
>
>     m_user_email {
>         string id PK "メールID (主キー)"
>         string user_id FK "ユーザーID (外部キー)"
>         string email UK "メールアドレス (ユニーク)"
>         boolean is_primary "メインのアドレスか"
>         boolean is_verified "有効性確認済みか"
>         timestamp verified_at "確認完了日時"
>     }
>
>     m_user ||--o{ m_user_email : "has"
> ```
