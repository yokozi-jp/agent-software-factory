---
type: Convention
title: "ドキュメント"
description: "非同期処理のイベントフロー図、インタフェース定義 (AsyncAPI)、キュー定義一覧、機能設計書の書き方を定める規約。非同期処理の設計ドキュメントを書くときに読む。"
tags: [async, convention, documentation]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forAsync/async_guidelines.html
    title: 非同期設計ガイドライン
    author: フューチャー株式会社
---

# ドキュメント

イベントの連鎖が分かるイベントフロー図かシーケンス図を作り、まず「なぜ非同期なのか」という設計意図を記載する。
メッセージのインタフェース定義を AsyncAPI で記述し、キュー定義一覧と DLQ 運用一覧、機能設計書を整備する。
出典は [非同期設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## ドキュメント

非同期処理は、キューへのメッセージ登録が、事実上API呼び出しとして考えることができる。そのため、キューにどのようなペイロードを送信すべきか、インタフェース定義を記載することが望ましい。また、処理が非同期でぶつ切れになるため、機能単位の設計書レベルから全体像を掴むことが難しくなる。そのため、どのようにイベントが伝播するか構成図で捉えられるようにすることが求められる。

推奨は以下の通り。

- （非同期に限った話ではないが）フロー図・インタフェース定義・機能定義書それぞれの紐づけは、機能IDで可能とする

### イベントフロー図

非同期処理を導入する場合、なぜ非同期なのかという設計意図は重要である。これが無いと、後々の運用メンバーが「同期」に戻すべきではないかと悩みが発生する。また、どのコンポーネントがどのキューに依存するかが分からないと、影響度調査などで大きな苦労を伴う（依存関係を調査する必要があり、時間がかかってしまう）。特にコンシューマーが別のキューにメッセージを送信するという、別の非同期が連鎖的に呼ばれる場合は複雑度が増すため、構成図を作成し全体像が分かるようにする必然性が増す。

推奨は以下の通り。

- 各イベントの連鎖が分かるようなイベントフロー図を構築するか、Web API機能設計書にPlantUMLや[mermaid.js](http://mermaid.js) でシーケンス図を書く
  - メッセージ種別が少なければシステム構成図でまとめても良い
  - 非同期が連鎖する場合は、イベントフロー図や上流のWeb API設計書のシーケンス図を参照するようリンクを付ける
- まず「なぜ非同期なのか」という設計意図を記載する
  - 例: 「外部APIの遅延からUIを解放するため」「負荷平準化のため」

> [!TIP]
> **イベントフロー図とシーケンス図のサンプル**
>
> ```mermaid
> ---
> title: イベントフロー図サンプル (注文処理)
> ---
> flowchart LR
>   Front["フロントエンド"] --> API["Order API (Producer)"]
>   API -.->|"非同期メッセージ"| OQ[("order-queue")]
>   OQ -.-> OP["Order Processor (Consumer 1)"]
>   OP -.->|"非同期メッセージ"| PQ[("payment-queue")]
>   PQ -.-> PP["Payment Processor (Consumer 2)"]
>   PP -->|"同期呼び出し"| SaaS["SaaS Payment API"]
>   OQ --> ODLQ[("order-dlq")]
>   PQ --> PDLQ[("payment-dlq")]
>   N1["非同期化の理由:<br>注文処理が重い処理であるため、非同期化を行い応答性を上げるため<br>(詳細: ADR-91)"]
>   N2["非同期化の理由:<br>Payment SaaSと分散トランザクションになるため非同期化で切り離す<br>(詳細: ADR-311)"]
>   API -.- N1
>   PP -.- N2
> ```
>
> 凡例: 破線の矢印 (-.->) は非同期メッセージ、実線の矢印 (-->) は同期呼び出しを表す。
>
> シーケンス図のサンプル（mermaid.js）。機能設計書であれば本来はビジネスロジックやDBへのCRUDを丁寧に書くべきであるが、サンプルのため割愛。
>
> ```mermaid
> %%{init: {'sequence': {'mirrorActors': false}}}%%
> sequenceDiagram
>     actor C as Client (フロントエンド)
>     participant API as Order API (Producer)
>     participant OQ as order-queue
>     participant OP as Order Processor (Consumer 1)
>     participant DB as Order DB
>     participant PQ as payment-queue
>     participant PP as Payment Processor (Consumer 2)
>     participant ExtAPI as External Payment API
>
>     %% --- 1. 注文リクエスト ---
>     activate C
>     C->>API: 1. POST /orders (注文リクエスト)
>     activate API
>
>     note right of API: 設計意図: 注文処理が重い処理であるため<br>非同期化で応答性を上げる<br>重い処理を非同期化(詳細: ADR-91)
>
>     API->>OQ: 2. Send Order Message (非同期)
>     API-->>C: 3. 202 Accepted (受付応答)
>     deactivate API
>     deactivate C
>
>     %% --- 2. 注文処理 (Consumer 1) ---
>     OQ-->>OP: 4. Receive Order Message
>     note over OQ: リトライ超過でorder-dlqへ
>     activate OP
>
>     OP->>DB: 5. 注文をDBに保存 (同期)
>     activate DB
>     DB-->>OP: 6. 注文保存完了
>     deactivate DB
>
>     OP->>PQ: 7. Send Payment Message (非同期)
>     deactivate OP
>
>     %% --- 3. 決済処理 (Consumer 2) ---
>     PQ-->>PP: 8. Receive Payment Message
>     note over PQ: リトライ超過でpayment-dlqへ
>     activate PP
>
>     note right of PP: 設計意図: SaaSと分散トランザクションになるため<br>非同期で分離する（ADR-311）
>
>     alt Happy Path (決済成功)
>         PP->>ExtAPI: 9a. 決済実行 (同期)
>         activate ExtAPI
>         ExtAPI-->>PP: 10a. 決済OK
>         deactivate ExtAPI
>     else Failure Path (決済失敗/タイムアウト)
>         PP->>ExtAPI: 9b. 決済実行 (同期)
>         activate ExtAPI
>         ExtAPI-->>PP: 10b. 決済NG (e.g., 503)
>         deactivate ExtAPI
>
>     end
>     deactivate PP
> ```

### インタフェース定義

特定のWeb APIからのみキューに送信する場合、実質Web API定義に包含されるようなメッセージ定義となる。そのため、メッセージのインタフェース定義は余計な作業ではないかという意見もある。

推奨は以下の通り。

- 限られたWeb APIからのみしか、キューに送信されなかったとしても、メッセージのインタフェース定義を作成する
  - 一律、インタフェース定義を設けることで、抜け漏れを防ぎやすい
  - プロデューサーではなく、コンシューマー側との認識齟齬を防ぐことができるため。特にスキーマ変更が発生した場合のやり取りを定型的な手順にできるため
  - リランなど運用時への情報提供にも繋がるため
- キューに送信するメッセージのスキーマは、[AsyncAPI](https://www.asyncapi.com/)で記述する
  - JSON Schemaに比べてより表現力が豊富なため（JSON Schemaがペイロードの構造を定義できるが、AsyncAPIは「どのトピック/キューに」 「どの操作（Pub/Sub）で」 「どのペイロードスキーマ」を流すかといった、非同期特有のプロトコル全体を定義できるため）
  - 定義ファイルをGitで構成管理したり、コード生成に利用することで、インタフェース定義と実装の陳腐化を防ぐことができるため

> [!TIP]
> **AsyncAPI例**
>
> ```yaml
> asyncapi: "3.0.0"
> info:
>   title: Order Processing API
>   version: "1.0.0"
>   description: 注文作成から決済処理への非同期イベント連携定義
>
> # 接続定義
> servers:
>   productionSqs:
>     host: sqs.ap-northeast-1.amazonaws.com
>     protocol: sqs
>     description: AWS SQS (Tokyo Region)
>
> # キュー定義
> channels:
>   order-created-queue:
>     address: "https://sqs.ap-northeast-1.amazonaws.com/123456789012/order-created-queue"
>     description: 注文が作成されたときにイベントが送信されるSQSキュー
>
>     # 操作の定義
>     operations:
>       sendOrderCreated:
>         action: "send"
>         summary: (プロデューサー) 注文サービスが注文作成イベントを送信する
>         messages:
>           - $ref: "#/components/messages/OrderCreatedEvent"
>
>       receiveOrderCreated:
>         action: "receive"
>         summary: (コンシューマー) 決済サービスがイベントを受信し処理する
>         messages:
>           - $ref: "#/components/messages/OrderCreatedEvent"
>
> components:
>   messages:
>     OrderCreatedEvent:
>       name: OrderCreatedEvent
>       summary: 注文が作成されたことを示すイベント
>       contentType: application/json
>       payload:
>         $ref: "#/components/schemas/OrderCreatedPayload"
>       headers:
>         type: object
>         properties:
> ```

### キュー定義

インフラレベルのキュー設定（例えば保持期間などの情報）は、Terraformなどで管理されていればダブルメンテになるため、SSoT（信頼できる唯一の情報源）の観点から記載しない。一方で、IaCからは読み取れない設計情報や運用時に必要な情報は、まとめて記載する必要がある。

キュー定義一覧例:

- 目的: 「どのキューが、どのビジネス処理のために、どのコンポーネント間で使われているか」を一覧化する

| キュー名           | ビジネス上の用途     | プロデューサー (機能ID)       | コンシューマー (機能ID)       | DLQ              |
| :----------------- | :------------------- | :---------------------------- | :---------------------------- | :--------------- |
| order-queue        | 注文情報の非同期登録 | API-001 (注文API)             | Consumer-001 (注文処理タスク) | order-dlq        |
| payment-queue      | 決済処理の実行       | Consumer-001 (注文処理タスク) | Consumer-002 (決済処理タスク) | payment-dlq      |
| notification-queue | 完了通知の送信       | Consumer-002 (決済処理タスク) | Consumer-003 (通知タスク)     | notification-dlq |

DLQ運用一覧例:

- 目的: 障害発生時（DLQにメッセージが入った時）に、「誰が、何をすべきか」を明確にすること

| DLQ名 （※）      | 担当者         | 手順概要                                                             | リカバリ手順                |
| :--------------- | :------------- | :------------------------------------------------------------------- | :-------------------------- |
| order-dlq        | EC開発チーム   | 顧客CSチームに連絡後、原因調査。バグ修正デプロイ後に手動でリドライブ | \[手順書Aへのリンク\] (...) |
| payment-dlq      | 決済基盤チーム | 決済GWの障害復旧を確認後、リランバッチを実行                         | \[手順書Bへのリンク\] (...) |
| notification-dlq | EC開発チーム   | 即時リカバリ不要。週次バッチでリトライ。7日経過後は消失を許容        | \[手順書Cへのリンク\] (...) |

※IaC側で記載されているのであれば、該当ファイルへのリンク化することが望ましい。DLQ転送条件やメッセージ保持期間もIaCファイルでカバーする。

### プロデューサー/コンシューマーの機能設計書

非同期プログラムそれぞれの設計書は、通常のビジネスロジック定義（Web API、バッチ、I/Fなど）と変わらないため、必要なCRUDやシーケンス図などを記載する。

> [!NOTE]
> **参考**
>
> - [プログラム設計書 | Markdown設計ドキュメント規約](../markdown-design-docs/program-design-batch.md#プログラム設計書バッチ非同期タスクなど)
