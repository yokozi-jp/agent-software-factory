---
type: ADR
title: "ADR 0041: 非同期処理のキューは既定で SQS の標準キューにし、業務タスクごとにキューと DLQ を置き、DLQ へは maxReceiveCount だけで移す"
description: 非同期処理のキューの種類、分け方、再試行、DLQ、重複の扱いの決定。ADR 0013 の「FIFO キュー」を、既定は標準キュー、業務に順序が要るときだけ FIFO に直す。1 業務タスクに 1 つのキューと DLQ、可視性タイムアウト 180 秒、関数のタイムアウト 30 秒、maxReceiveCount 5、保持は 4 日と DLQ 14 日、DLQ へはアプリから送らず maxReceiveCount だけで移す、戻すのは SQS の redrive。通知メールは processed_message を確かめ、SES で送り、短いトランザクションで行を入れる（少なくとも 1 回。SES に冪等キーはない）。ワーカーは Hono にしない。比べた案は、FIFO、SES をトランザクションで包む形、先に記録して後で送る形、アプリと maxReceiveCount の二段構え、1 つのキューを共有する形、Lambda Web Adapter で HTTP のワーカーにする形。キューやコンシューマーを足すとき、FIFO にしたくなったとき、キューの値（可視性タイムアウト、maxReceiveCount、保持期間）を変えるとき、DLQ を設計するとき、外部の API を呼ぶコンシューマーを書くとき、ワーカーを Hono で書きたくなったときに読む。
tags: [adr, async, sqs, dlq, idempotency, mail, ses, lambda, ecs]
---

# ADR 0041: 非同期処理のキューは既定で SQS の標準キューにし、業務タスクごとにキューと DLQ を置き、DLQ へは maxReceiveCount だけで移す

サンプル機能の非同期処理は、承認依頼と差戻しの通知メールです。[ADR 0013](0013-api-on-ecs-and-lambda-web-functions.md) は「Outbox から SQS の FIFO キュー（DLQ あり）に送る」としていました。ところが、取り込んだ規約の [順序保証](../async/ordering.md) は、FIFO で厳密な順序が要るなら DLQ を使わないとしています。[DLQ](../async/dlq.md) は FIFO に DLQ を付けて順序を諦める形を推奨しており、両者が食い違っていました。通知メールに順序は要らないので、キューを既定で標準キューにし、食い違いを既定から外します。決定は [通知メールの非同期処理の再配送、重複、順序、DLQ の扱いと試験を決める](https://github.com/yokozi-jp/agent-software-factory/issues/353) の解決コメントにあります。

## ルール

- **キューの種類**: 既定は SQS の標準キューです。FIFO は、業務に順序が要る処理にだけ使います。モジュールをまたいで状態を写すイベント ([ADR 0029](0029-module-data-ownership-and-shared-outbox.md)) で順序が要るときは、FIFO にするか、写す側で版の番号を比べて古いイベントを捨てるかを、そのイベントを足すときに決めます。
- **キューの分け方**: 1 業務タスクに 1 つのキュー、1 つのコンシューマー、1 つの DLQ を置きます ([非同期処理の論理構成方針](../async/component-structure.md)、[DLQ](../async/dlq.md) の (2))。承認依頼と差戻しは、メッセージの形 (宛先、テンプレート、差し込む値) が同じなので、1 つの通知メールのキューにします。1 つのイベントを複数の業務タスクで受け取るときは、SNS を挟んで配ります。
- **Outbox を送る処理**: 関数は 1 つのまま ([ADR 0013](0013-api-on-ecs-and-lambda-web-functions.md)) で、Outbox の行のイベントの種類で送り先のキューを選びます。
- **値**: 関数のタイムアウトを 30 秒、可視性タイムアウトを 180 秒、`maxReceiveCount` を 5、保持期間を元のキュー 4 日 (既定)、DLQ 14 日 (最大) にします。ECS の構成でも同じ値を使います。新しいキューは、この値を初期値にし、明らかに合わない処理だけ変えます。
- **DLQ への退避**: `maxReceiveCount` による SQS の自動の移動だけにします。回復しないエラー (メッセージの形の違反、宛先がない) でも、アプリは例外を投げるだけで、DLQ へ直接送りません。
- **Lambda の失敗の返し方**: 標準キューを読む Event Functions は、失敗したメッセージだけを `batchItemFailures` に入れます。最初の失敗以降をすべて入れる ADR 0013 の規則は、FIFO のキューにだけ当てはまります。
- **重複除去**: どのキューでも、受け取る処理は `processed_message` で重複を除きます ([ADR 0029](0029-module-data-ownership-and-shared-outbox.md))。FIFO の重複除去には頼りません。
- **外部の API を呼ぶコンシューマー** (通知メール): `processed_message` の行を確かめ、行がなければ外部の API (SES) を呼び、その後に短いトランザクションで行を入れます。外部の API を呼ぶ間、DB のトランザクションを開いたままにしません。先に行を入れて後で送る形にはしません。落ちたときにメールが 1 通も届かなくなるためです。
- **2 通届くことを認める**: SES の `SendEmail` には冪等キーがありません。そのため、SES の後、行の commit の前に落ちたとき、または可視性タイムアウトが切れて 2 つのワーカーが同じメッセージを処理したときは、2 通届きます。届け方は少なくとも 1 回です ([QoS](../async/qos.md))。
- **戻し方**: DLQ のメッセージは、原因を直してから、SQS の redrive (`StartMessageMoveTask`。コンソールからも実行できる) で元のキューに戻します。手順の Runbook は、キューを作る実装と一緒に置きます。戻すと 2 通目が出ることがあると、その Runbook に書きます。
- **ワーカーの入口**: ワーカーは Hono のアプリにしません。業務の処理はモジュールの `application` の層の関数にし、入口は ADR 0013 の形 (ECS は SQS を読む繰り返し、Lambda は `handler(event)`) のままにします。外部からのイベントを HTTP で受けるとき (Webhook、SNS の HTTP の購読) は、ワーカーではなく API の route にします。

## 試験

[テスト](../async/testing.md) に従い、本物のキューを使う結合テストは正常の流れと代表の DLQ に絞ります。

| 場所          | 動かすもの                                                                                                                                           | 確かめること                                                                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ローカルと CI | ElasticMQ と Mailpit。ECS のワーカーの繰り返しを ElasticMQ に向ける。Lambda のワーカーは、SQS のイベントの形の値を作って `handler(event)` を直接呼ぶ | 重複 (同じメッセージを 2 回渡すと 1 通)、再配送 (1 回目に失敗させると 2 回目で届く)、順序の逆転 (差戻しを承認依頼より先に処理しても両方届く)、DLQ (5 回失敗させると DLQ に移る)、`batchItemFailures` (失敗した 1 件だけを返す) |
| 検証環境      | 本物の SQS、Lambda の event source mapping、SES                                                                                                      | 正常の流れ 1 本と、`batchItemFailures` を受けて失敗した 1 件だけが戻り、DLQ に移ること                                                                                                                                         |

## 標準との違い

- **既定を標準キューにする**: 取り込んだ規約の [重複排除と冪等性](../async/idempotency.md) は原則 FIFO で、5 分の重複排除の窓を超える場合は標準キューと冪等なコンシューマーにする、としています。Lambda の構成の Outbox を送る処理は、取りこぼしを 15 分ごとに拾うので、送り直しが 5 分の窓を超えます。重複を除くのは `processed_message` で、FIFO の重複除去はこの構成では効きません。規約の例外の条件に当たると判断し、既定にしました (判断)。[順序保証](../async/ordering.md) の「可能な限り順序制御を必要としない設計を目指す」には沿います。
- **DLQ への退避を maxReceiveCount だけにする**: [DLQ](../async/dlq.md) は、アプリの即時の退避と `maxReceiveCount` の二段構えを推奨しています。理由は、FIFO で処理できないメッセージが同じグループの後ろを止める (ヘッドオブラインブロッキング) のを早く解くためです。標準キューでは後ろが止まらないので、この理由がありません。アプリから DLQ へ送ると、送信と削除がアトミックでなく、メタデータの継承も要ります。
- **外部の API を呼ぶ間トランザクションを開かない**: 取り込んだ規約の [非同期処理ステータス設計](../async/status-management.md) は、処理中の印に行ロックを勧めています。行ロックで包むと、可視性タイムアウトが切れたときの 2 通目も止まります。ただし、SES の応答を待つ間、DB の接続とロックを持ち続けます。Lambda のワーカーは接続プールが 1 本です (ADR 0013)。外部の呼び出しをトランザクションに入れない方針は [ADR 0040](0040-idempotency-key-in-module-schema.md) とも揃います。可視性タイムアウトを処理時間より十分に長くする規約 ([リトライとメッセージロックのタイムアウト](../async/retry-and-visibility-timeout.md)) で、同時の処理はまれになります (判断)。
- **Idempotent Consumer との違い**: microservices.io の [Idempotent Consumer](https://microservices.io/patterns/communication-style/idempotent-consumer.html) は、トランザクションの開始の直後にメッセージの id を入れ、業務の更新と一緒に commit します。通知メールの業務の処理は DB の更新でなく SES への送信で、トランザクションに入らないので、行は送信の後に入れます。
- **AWS の推奨に沿う値**: 可視性タイムアウトを関数のタイムアウトの 6 倍以上、`maxReceiveCount` を 5 以上、DLQ の保持期間を元のキューより長くするのは、AWS の推奨のとおりです (「出典」)。
- **避けるアンチパターン**: FIFO の重複除去で「ちょうど 1 回」と思い込むこと。FIFO に DLQ を付けて厳密な順序を保てると思い込むこと。DB のトランザクションを開いたまま外部の API を呼ぶこと。複数の業務タスクを 1 つのキューに混ぜること。

## Considered Options

- **FIFO のまま、SES をトランザクションで包む**: ADR 0013 と規約の原則のままで済み、可視性タイムアウトが切れたときの 2 通目も止まります。ただし、申請ごとの順序には使い道がありません (承認依頼は上長宛、差戻しは申請者宛)。それなのに、1 件の失敗が同じグループの後ろを止め、DLQ に移せば順序は崩れます。`MessageGroupId`、`MessageDeduplicationId`、最初の失敗以降をすべて返す実装、DLQ か即時停止かの判断が増えます。包む部分には、SDK のタイムアウト、`lock_timeout`、待ちが切れたら失敗として返す処理、`idle_in_transaction_session_timeout` の手当てが要ります。
- **FIFO で包まない**: 重複の起き方は標準キューと同じで、FIFO の費用だけが残ります。
- **標準キューで SES をトランザクションで包む**: 可視性タイムアウトが切れたときの 2 通目を止められます。ただし、まれな場合のために上の 4 つの手当てが要り、外部の API を呼ぶ間 DB の接続を持ち続けます。
- **先に `processed_message` を入れて、後で送る**: 2 通届くことはなくなります。ただし、送る前に落ちるとメールが 1 通も届きません。通知が消えるより、まれに 2 通届くほうが害は小さいと判断しました。
- **SES の冪等キーで止める**: SES v2 の `SendEmail` の要求に、冪等キーの項目がありません (「出典」)。
- **アプリと maxReceiveCount の二段構え** ([DLQ](../async/dlq.md) の推奨): 上の「標準との違い」のとおり、標準キューでは利点が小さく、実装が増えます。
- **1 つのキューを業務タスクで共有する**: キューの数は減ります。ただし、片方の障害や遅延がもう片方に及び、どの業務が失敗したのかを切り分けにくくなります ([非同期処理の論理構成方針](../async/component-structure.md))。
- **ワーカーを Hono で書き、Lambda Web Adapter の pass-through で SQS のイベントを HTTP で受ける**: API とワーカーを同じ形で書けます。ただし、ADR 0013 は Lambda Web Adapter を退けており、ECS のワーカーは自分で SQS を読むので HTTP の経路がありません。`batchItemFailures` を HTTP の応答に詰め直す層も増えます。`@hono/aws-lambda` が扱うのは HTTP のイベントだけです。

## Consequences

- ADR 0013 の「FIFO キュー」の規則を、この ADR に合わせて直しました。
- 順序が要るイベントを足すときは、FIFO と版の比較のどちらにするかを、そのつど決めます。決めないまま標準キューに載せると、古いイベントが新しい値を上書きし得ます。
- 通知メールは、まれに 2 通届きます。1 通も届かないのは、DLQ に移ったメッセージを 14 日のうちに戻さなかったときだけです。DLQ の監視は、[監視](../async/monitoring.md) に従って別に決めます。
- 再試行は 180 秒ごとで、DLQ に移るまでに最長でおよそ 15 分かかります。通知メールの遅れとしては許せると判断しました。

## 確かめられなかったこと

- ElasticMQ が、redrive の方針 (`maxReceiveCount` による DLQ への移動) と `StartMessageMoveTask` をどこまで再現するかは確かめていません。実装の前に確かめます。
- SES の 1 回の呼び出しにかかる時間 (数百ミリ秒の見込み) は、測っていません。
- ワーカーのコードは書いていません。

## 出典

- SES v2 の `SendEmail` の要求の項目 (冪等キーの項目がない): [SendEmail - Amazon Simple Email Service API v2](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html) (2026-10-29 に確かめた)
- 可視性タイムアウトを関数のタイムアウトの 6 倍以上、`maxReceiveCount` を 5 以上、関数のタイムアウトが可視性タイムアウトを超えると event source mapping の作成が失敗すること: [Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html) (2026-10-29 に確かめた)
- 標準キューのメッセージの期限は DLQ に移っても最初の enqueue の時刻から数えること、DLQ の保持期間を元のキューより長くすること、厳密な順序が要るなら FIFO に DLQ を使わないこと: [Using dead-letter queues in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html) (2026-10-29 に確かめた)
- SQS のイベントを HTTP の POST で渡す pass-through: [Lambda Web Adapter: Non-HTTP Event Triggers](https://aws.github.io/aws-lambda-web-adapter/features/non-http-events.html) (2026-10-29 に確かめた)
- Hono の Lambda の adapter: [Hono: AWS Lambda](https://hono.dev/docs/getting-started/aws-lambda) (2026-10-29 に確かめた)
- 処理済みのメッセージの id を表に記録する形: [Pattern: Idempotent Consumer](https://microservices.io/patterns/communication-style/idempotent-consumer.html) (2026-10-29 に確かめた)
