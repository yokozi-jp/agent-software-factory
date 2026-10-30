---
type: Convention
title: モジュール間のイベントの契約
description: モジュールをまたぐイベントのペイロードを、zod のスキーマ、整数の version、項目の追加だけの変更、過去の版の fixture のテストで契約にする規約。AsyncAPI を使わない理由も書く。イベントを足す、変えるとき、イベントの版を上げるとき、過去の版の fixture を足すとき、AsyncAPI を入れたくなったときに読む。
tags: [async, convention, events, zod, testing]
---

# モジュール間のイベントの契約

モジュールをまたぐイベントは、Outbox の行として DB に残ります。デプロイの途中や再送で、古いコードが書いた行を新しいコードが読みます。送り手と受け手は同じリポジトリと同じデプロイにあるので、型の共有で足り、実行時に残る古い版への互換だけをテストで守ります。正式な Data Contract は入れません ([Data Contract を取り込むかを決める](https://github.com/yokozi-jp/agent-software-factory/issues/214)、[Issue #299](https://github.com/yokozi-jp/agent-software-factory/issues/299))。置き場所は [ADR 0046](../adr/0046-review-split-from-claim-and-events-in-sender-package.md) にあります。

## 書き方

- **スキーマ**: イベントを送るモジュールは、そのモジュールの events の package (`packages/<module>/events`) の `src/index.ts` で、`shared` の `defineEvent(kind, version, shape)` で作ったイベントを公開します。型は `z.infer<typeof event.schema>` で導きます。受け手は `schema` で検証してから処理します。
- **共通の項目**: `id` (uuid。受け手の `processed_message` のキー)、`tenantId`、`kind`、`version`、`occurredAt` (UTC で小数 3 桁の RFC 3339) は `defineEvent` が足します。種類ごとの項目を `shape` に書きます。
- **種類の名前**: `<モジュール>.<過去形の事実>` です (`claim.submitted`、`approval.sent_back`)。1 つの種類に 1 つのスキーマで、受け手が違っても分けません。
- **版**: `version` は 1 から始まる整数で、`defineEvent` の引数と、メッセージの `version` の項目です。受け手は `version` を見て分岐せず、今のスキーマで読みます。
- **変更は項目の追加だけ**: 追加する項目は省略可能にし、`version` を 1 上げます。項目の削除、名前の変更、型の変更はしません。そうしたい変更は、新しい種類のイベントを足します。知らない項目はスキーマが捨てるので、古い受け手は新しい版のメッセージも読めます。

## 過去の版のテスト

events の package ごとに、`test/fixtures/<種類>.v<版>.json` に、その版のメッセージを 1 つずつ置きます。`test/versions.test.ts` が `eventFixtureProblems` (`packages/shared/src/event.ts`) で、次を確かめます。

- 今のスキーマが、すべての fixture を読める。
- fixture の名前の版と、メッセージの `version` が同じ。
- 公開しているすべてのイベントに、今の版の fixture がある。

スキーマを足す、変えるときは、同じ変更でその版の fixture を足します。過去の版の fixture は消さず、書き換えません。項目を削除するか型を変えると、この fixture が落ちます。検出力は `packages/shared/src/event.test.ts` の、項目の削除と型の変更の 2 件が確かめます。

## 標準との違い

[ドキュメント](documentation.md) は、メッセージのスキーマを AsyncAPI で書くことを推奨しています。ここでは AsyncAPI のファイルを使いません (判断)。

- AsyncAPI は、チームの外へ渡す契約の記述に向きます。このリポジトリのイベントは、同じリポジトリと同じデプロイの中のモジュールの間だけで流れ、外には出ません。
- zod のスキーマが送り手の書き込みと受け手の検証の両方で使われるので、定義と実装が食い違いません。別のファイルを正にすると、同期する作業が増えます。
- データ基盤への連携や、別チームがイベントを使う仕様が出たら、zod のスキーマから AsyncAPI を生成して入れる条件にします。
