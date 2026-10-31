---
type: Runbook
title: 通知メールの DLQ のメッセージを元のキューに戻す
description: 通知メールのキューの DLQ に溜まったメッセージを、原因を直してから SQS の redrive（StartMessageMoveTask）で元のキューに戻す手順。戻すと 2 通目のメールが出ることがある理由、戻してはいけない場合、必要な権限、ローカルで確かめられないことを書く。通知メールのメッセージが DLQ に移ったとき、DLQ のメッセージを戻すとき、キューの redrive を実装や CDK に足すときに読む。
tags: [tooling, runbook, sqs, dlq, mail, async]
---

# 通知メールの DLQ のメッセージを元のキューに戻す

通知メールのメッセージが `maxReceiveCount` (5) 回失敗すると、SQS が DLQ に移します。アプリは DLQ へ送りません ([ADR 0041](../adr/0041-standard-queue-per-task-with-dlq.md))。
戻すのは、原因を直した後に、SQS の redrive で行います。原因が残ったまま戻すと、同じメッセージがまた 5 回失敗して DLQ に戻ります。

## 手順

1. **メッセージと原因を調べる**: ワーカーは、失敗したメッセージごとに、メッセージの id とエラーの名前と文を 1 行の JSON (`"event":"notification_failed"`) でログに書きます。メッセージの本文は宛先のアドレスを含むので、ログには書きません。DLQ のメッセージは、SQS のコンソールの「メッセージを受信」で読めます。読んでいる間、そのメッセージは可視性タイムアウト (180 秒) の間だけ見えなくなります。
2. **原因を直す**: エラーの種類ごとに、次のように直します。

   | ログのエラー                                       | 原因                                             | 直し方                                                                                                                                    |
   | -------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
   | `MailSendFailed` (`The mail could not be sent: …`) | SES の拒否、制限、障害。ネットワークの断         | SES の状態 (サンドボックス、送信の制限、検証済みの From) と経路を直す。宛先のアドレスが無効なら、メッセージは戻さず、送り手のデータを直す |
   | `MissingTemplateValue`                             | メッセージの `values` が、テンプレートに足りない | 送り手 (Outbox を送る処理) を直す。DLQ のメッセージは値が足りないままなので戻さない                                                       |
   | `ZodError` や `SyntaxError`                        | メッセージの形が違う、または JSON ではない       | 送り手を直す。受け手が新しい版を読めないなら、受け手を直して配る。DLQ のメッセージは、直した受け手が読める形のときだけ戻す                |
   | DB の接続や権限のエラー                            | pool が空、DB が止まっている、ロールの権限の不足 | DB とロールを直す                                                                                                                         |

3. **戻す**: DLQ を指定して redrive を始めます。送り先を省くと、メッセージは元のキューに戻ります。

   ```sh
   aws sqs start-message-move-task \
     --source-arn <DLQ の ARN> \
     --max-number-of-messages-per-second 5
   aws sqs list-message-move-tasks --source-arn <DLQ の ARN>
   ```

   コンソールからは、DLQ を開いて「DLQ の redrive を開始」を選び、「ソースキューに redrive」を選びます。速度は小さい値から始めて、元のキューが詰まらないことを見てから上げます。

4. **確かめる**: DLQ が空になり、元のキューのメッセージがなくなり、メールが届いていることを確かめます。戻したメッセージがまた DLQ に移ったら、原因が残っています。手順 1 に戻ります。
   戻す途中で止めたいときは、`aws sqs cancel-message-move-task --task-handle <start-message-move-task が返した値>` を実行します。止めるまでに移ったメッセージは、元のキューに残ります。

## 戻すと 2 通目が出ることがある

届け方は少なくとも 1 回です ([ADR 0041](../adr/0041-standard-queue-per-task-with-dlq.md))。次のとき、戻した後に、すでに届いたメールと同じ内容のメールがもう一度届きます。

- そのメッセージの処理で、SES が送った後、`processed_message` に行を入れる前に失敗していた。SES の `SendEmail` に冪等キーはなく、行がないので、戻した後にもう一度送ります。
- 失敗の原因が、送信の後の DB への書き込みだった。メールは 1 通目が届いており、`processed_message` の行はありません。

SES が断るなどして、メールを 1 通も送れていないメッセージは、戻して初めて 1 通届くだけで、2 通目は出ません。
redrive は、戻すメッセージに新しい MessageId と enqueue の時刻を付けます ([DLQ の redrive を設定する](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html)、2026-10-31 に確かめた)。重複を除くのはメッセージの本文の `id` (Outbox のイベントの id) と `processed_message` で、SQS の MessageId ではないので、`processed_message` に行がある通知は戻しても `Duplicate` で送りません。

## 制約

- **保持期間**: 標準キューのメッセージの期限は、DLQ に移っても最初の enqueue の時刻から数えます。DLQ の 14 日を過ぎたメッセージは、戻せません ([ADR 0041](../adr/0041-standard-queue-per-task-with-dlq.md))。戻したメッセージの保持期間は、新しい enqueue の時刻から数え直されます。
- **同時の task**: 1 つのキューで動かせる move task は 1 つで、1 回の task は最大 36 時間動きます。redrive は、メッセージを選んだり書き換えたりできません。
- **対象のキュー**: SQS をソースにした DLQ だけが対象です。通知メールのキューは、これに当たります。
- **権限**: 戻す人のロールには、DLQ の `sqs:StartMessageMoveTask`、`sqs:CancelMessageMoveTask`、`sqs:ListMessageMoveTasks`、`sqs:ReceiveMessage`、`sqs:DeleteMessage`、`sqs:GetQueueAttributes`、`sqs:ListDeadLetterSourceQueues` と、元のキューの `sqs:SendMessage` が要ります。キューを KMS で暗号化したときは `kms:Decrypt` と `kms:GenerateDataKey` も要ります。ここに挙げた範囲は、戻す操作の最小の権限で、実際のロールは CDK のキューを作るときに決めます。

## ローカルと CI では試せない

ElasticMQ では、`StartMessageMoveTask` が標準キューで動くかを確かめていません ([ADR 0041](../adr/0041-standard-queue-per-task-with-dlq.md) の「確かめられなかったこと」)。FIFO のキューでは何も移さないことが分かっています。DLQ へ移ること自体は、ローカルと CI の試験 (`apps/worker/src/ecs-worker.test.ts`) が確かめます。redrive は、検証環境の本物の SQS で、一度流して確かめます。
