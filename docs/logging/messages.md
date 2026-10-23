---
type: Convention
title: "ログメッセージの書き方"
description: "ログメッセージの書き方、トレース ID の出し方、ユーザー向けメッセージとの分離、英語化の要否を定める規約。ログを出すコードを書くとき、レビューするときに読む。"
tags: [logging, convention, message, i18n]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forLog/log_guidelines.html
    title: ログ設計ガイドライン
    author: フューチャー株式会社
---

# ログメッセージの書き方

メッセージは単体で「何が、なぜ起きたか」が分かるように書き、可変値はメッセージに埋め込まずトップレベルのキーに出す。
ユーザー向けメッセージとログは分け、トレース ID で紐づける。国際化が必要なら英語だけで出す。
出典は [ログ設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## トレースID

[トレースIDをどこで払い出すべきか | オブザーバビリティ | Web API設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forWebAPI/web_api_guidelines.html#%E3%83%88%E3%83%AC%E3%83%BC%E3%82%B9id%E3%82%92%E3%81%A8%E3%82%99%E3%81%93%E3%81%A6%E3%82%99%E6%89%95%E3%81%84%E5%87%BA%E3%81%99%E3%81%B8%E3%82%99%E3%81%8D%E3%81%8B) に記載したとおり、なるべく上流でトレースIDは払い出して出力する。

- クライアント側のアプリケーションの統制を行えるのであれば、（1）クライアント側でトレースIDを生成する
- 統制が無理な場合は、サーバーのミドルウェア（ServletFilterやインターセプターの層）でトレースIDを発番する

## ユーザーメッセージとログ

開発者/運用者向けの「ログメッセージ」と類似の概念として、エンドユーザーへ状況を伝え、次に行うべきアクションを促すことを目的とした「ユーザーメッセージ」が存在する。

推奨は以下の通り。

- ログのメッセージと、ユーザーに表示するエラーメッセージは、目的と対象者が異なるため、必ず分離して管理する
  - セキュリティリスクを避けるため（詳細: [ログのセキュリティ](security.md)章）
  - 保守性を上げるため（デバッグのためにログ情報を追加・変更したい場合でも、ユーザーメッセージの文言を気にしなくても済む。またその逆もある）
- ログ出力をしつつ、ユーザー向けにエラーを表示することがある。それらを紐づけるために、トレースIDをユーザーメッセージにも出力する
  - これにより、ユーザーからの「このIDの表示されたエラーが出ました」と問い合わせがあった際に、そのIDをキーに調査が可能となる（どのような操作をしたか？ 何時頃ですか？ といったやり取りを減らせる）

✅️出力例（開発者向けのログ）

```json
{
  "timestamp": "2025-09-12T14:46:16.234+09:00",
  "severity.text": "ERROR",
  "message": "Error processing payment.",
  "service.name": "payment-service",
  "thread.name": "http-nio-8080-exec-5",
  "logger.name": "com.example.MyPaymentService",
  "error.id": "E-1a2b3c4d",
  "error.code": "PAYMENT-003",
  "exception.type": "com.example.PaymentApiException",
  "exception.message": "Credit card company timeout",
  "exception.stack_trace": "com.example.PaymentApiException: Credit card company timeout\n\tat com.example.MyPaymentService.processPayment(MyPaymentService.java:42)\n\t... (スタックトレースが続く)"
}
```

✅️出力例（ユーザー向けのメッセージ）

```console
決済処理中にエラーが発生しました。お手数ですが、時間をおいて再度お試しください。
解決しない場合は、サポートまでお問い合わせください。(エラーコード:E10222  トレースID: E-00112233)
```

## メッセージの書き方

ログメッセージ単体でも、「何が・なぜ起きたのか」を理解できるように書くと、初動を上げられ、運用視点でも優れている。

推奨は以下の通り。

- 具体的かつ、一意に解釈できるよう書く
  - ❌️: 「DBエラーです」 (接続？クエリ？タイムアウト？)
  - ✅️: 「商品テーブルへのINSERTに失敗しました。原因: 主キーが重複しています。 productId: 12345」
- 調査で切り分けに使える（トレースできる情報）識別子を含めること
  - JavaではMDC、Goではcontextに入れて、フレームワーク側で自動的にログへ付与する設計にする
  - 識別子の例
    - リクエストID / トレースID: リクエストの入口から出口までを繋ぐ最も重要なID
    - ユーザーID / テナントID: 誰のリクエストで問題が起きたのかを特定
    - セッションID: 特定のセッションでの一連の操作を追跡
    - 注文ID / 商品IDなど: ビジネス上重要なID
- 事実とデータを分離する
  - ログメッセージの「テンプレート（事実）」と「可変値（データ）」を分離する
  - 可変値は構造化ログとして個別のキーとして切り出す
  - Goのslogを使った例
    - ❌️: logger.Info("ユーザー " \+ userId \+ " のカート追加時の在庫引当に失敗しました。SKU: " \+ skuId)
    - ❌️: logger.Info(“カート追加時の在庫引当が失敗しました。（ユーザー " \+ userId \+ "SKU: " \+ skuId+ “）”)
    - ✅️: logger.Info("カート追加時の在庫引当が失敗しました。", "user.id", userId,"sku.cd", skuId)
  - 可変値は、トップレベルでフラットにもたせる
    - ログ分析性を上げるため（detailsにすると視認性が上がるが、ログ基盤上のクエリが書きにくく性能劣化の可能性もあるため）

✅️: 可変値をフラットにし、テンプレートと分離した例

```json
{
  "timestamp": "2025-08-26T10:36:17.123+09:00",
  "severity.text": "INFO",
  "message": "カート追加時の在庫引当が失敗しました。",
  "user.id": "user-456",
  "sku.cd": "ABC-123-XYZ-RED-L"
}
```

❌️: メッセージ本文に可変値を埋め込んだ例

```json
{
  "timestamp": "2025-08-26T10:36:17.123+09:00",
  "severity.text": "INFO",
  "message": "カート追加時の在庫引当が失敗しました。（ユーザーID:user-456 SKU:ABC-123-XYZ-RED-L）"
}
```

❌️: details配下にまとめる例

```json
{
  "timestamp": "2025-08-26T10:36:17.123+09:00",
  "severity.text": "INFO",
  "message": "カート追加時の在庫引当が失敗しました。",
  "details": {
    "user.id": "user-456",
    "sku.cd": "ABC-123-XYZ-RED-L"
  }
}
```

## 国際化対応/英語の対応是非

開発、保守運用、SRE、サポートなどの一部がグローバル体制で組まれる場合は、英語でのログメッセージ化が必要になる。

- 推奨
  - もし、国際化対応が必要な場合、原則、英語の対応とする
    - 日本語やその他各国の言語でのログ出力は行わない
    - ログメッセージをSSoT（Single Source of Truth: 信頼できる唯一の情報源）で管理するため
  - ログごとに、運用が一意となるメッセージコードを付与する
    - それに紐づく運用マニュアルを各国拠点ごとに作成させるなどは、状況に応じて実施する

✅️出力例（英語での出力）

```json
{
  "timestamp": "2025-08-26T11:45:10.880+09:00",
  "severity.text": "WARN",
  "message.code": "BIZ-W-1001",
  "message": "Inventory update failed due to a data conflict (optimistic lock). Please retry the operation.",
  "process.name": "inventory_allocation",
  "order.id": "order-67890",
  "product.id": "product-ABC-001",
  "requested.quantity": 5,
  "current.version": 12,
  "attempted.version": 11
}
```

❌️出力例（message、message_jpを設けることで、英語・日本語の2種別で出力。冗長でログサイズの肥大化を招き、メッセージ管理の保守性も低下）

```json
{
  "timestamp": "2025-08-26T11:45:10.880+09:00",
  "severity.text": "WARN",
  "message.code": "BIZ-W-1001",
  "message": "Inventory update failed due to a data conflict (optimistic lock). Please retry the operation.",
  "message_jp": "在庫の更新がデータ競合（楽観ロック）により失敗しました。操作を再試行してください。",
  "process.name": "inventory_allocation",
  "order.id": "order-67890",
  "product.id": "product-ABC-001",
  "requested.quantity": 5,
  "current.version": 12,
  "attempted.version": 11
}
```
