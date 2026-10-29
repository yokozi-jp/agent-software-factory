---
type: Runbook
title: "競合と原子性のテストの書き方"
description: "同時の更新、楽観排他の衝突、一意制約の衝突を決定的に再現する手順と、失敗した処理が行を残さないことを確かめる手順を定める文書。競合や原子性を確かめる結合テストを書くとき、sleep や Promise.all で競合を作りたくなったときに読む。"
tags: [db, postgresql, testing, concurrency, runbook]
---

# 競合と原子性のテストの書き方

競合のテストは、本物の PostgreSQL に対して、application の公開 API の関数を呼んで確かめます。
この文書は、このリポジトリが決めた書き方です。取り込んだ [PostgreSQL の排他制御](postgresql-concurrency.md) には、テストの書き方がありません。
決定と根拠は [Issue #352](https://github.com/yokozi-jp/agent-software-factory/issues/352) の解決コメントにあります。

## 置き場所と道具

DB を使う結合テストは `apps/api/src/**/*.test.ts` に置きます ([ADR 0038](../adr/0038-db-package.md))。
道具は `@agent-software-factory/db/testing` にあります。

| 道具                                         | 使い方                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `awaitBlocked(pool, { waiter, holder })`     | 接続 `waiter` が接続 `holder` のロックを待つまで、`pg_blocking_pids()` で確かめ続ける。上限は既定で 10 秒 |
| `snapshotRowCounts(pool)`、`diffRowCounts()` | `auth` と `migrations` を除く全表の行数を取り、前後の差を返す。superuser の接続を渡す                     |

## 競合を決定的に再現する

同時の承認と、一意制約の衝突は、次の手順で再現します。

1. 接続 A でトランザクションを開き、行を更新して、commit せずに止めます。
2. 接続 B を別の接続で走らせます。B は A の終わりを待ちます。pid は、B が塞がる前に `SELECT pg_backend_pid()` で取っておきます。
3. `awaitBlocked` で、B が A を待っていることを確かめます。
4. A を commit します。
5. B の結果を確かめます。更新なら 0 行 (楽観排他の衝突)、INSERT なら 23505 (一意制約の衝突) です。

楽観排他の衝突は並行にしません。古い `lockNo` で 2 回更新し、2 回目が 0 行になる (409) ことを確かめます。

使わない書き方があります。

- 素の `sleep` で待つ。長くすればテストが遅くなり、短くすれば環境しだいで偽の失敗になります ([Fowler, Eradicating Non-Determinism in Tests](https://martinfowler.com/articles/nonDeterminism.html) が、素の sleep を使わず、コールバックかポーリングを使うよう勧めています)。
- `Promise.all` で同時に走らせ、重なるのを期待する。重ならなければ、競合を確かめないまま通ります。
- `pg_locks` を自己結合して待ちを調べる。PostgreSQL の文書が、正しく書くのが難しいとして `pg_blocking_pids()` を勧めています ([pg_locks](https://www.postgresql.org/docs/current/view-pg-locks.html))。

`awaitBlocked` が見つけられるのは、重いロックの待ちだけです ([isolationtester の README](https://github.com/postgres/postgres/blob/master/src/test/isolation/README))。行ロックの待ちは、相手の transactionid の待ちとして見えます ([pg_locks](https://www.postgresql.org/docs/current/view-pg-locks.html))。一意索引の待ちも、相手のトランザクションの終わりを待つので、これに当たります。
重いロックでない待ち (入出力や軽量ロックの待ち) は見えません。その待ちを再現したいときは、`awaitBlocked` は上限の時間まで待って失敗するので、別の手順を考えます。
`pg_blocking_pids()` を呼ぶ接続は、待ち合わせに使う 2 つの接続とは別にします。

## 対照を付ける

競合のテストごとに、わざと安全でない書き方を同じ手順で流す対照を付けます。
たとえば、`lock_no` の条件がない `UPDATE` は、待った後に両方成功して先の更新が失われます。条件がある `UPDATE` は 0 行になります。
対照があると、手順が本当に競合を作れていることの証明になります。対照が通らなくなったら、手順が競合を作れていません。

`packages/db/src/testing/await-blocked.test.ts` に、この対照の書き方があります。

## 失敗した処理が行を残さないことを確かめる

処理の前に `snapshotRowCounts` を取り、処理を失敗させ、後に取り直して `diffRowCounts` が空であることを確かめます。
表の名前を書かないので、業務の表、`messaging.outbox`、`processed_message` のどれにも行が残らないことを、まとめて確かめられます。
新しく足した表も数えます。

- **superuser の接続を渡します。** そうでない接続は RLS で行が見えず、少なく数えて「行が残っていない」と誤って通るので、`snapshotRowCounts` は数える前に失敗します。
- **数えるのは行数だけです。** 既存の行の更新や、行を 1 つ足して 1 つ消す変化は、差に出ません。原子性の証明の全部ではなく、行が残らないことの確認です。更新の取り消しは、行の値を読んで確かめます。
- **数えない表があります。** `auth` と `migrations` のスキーマ、一時テーブル、パーティション表の親 (子と二重になるため) です。

## 確かめられる範囲

- この手順は、1 つの DB の 1 つのクラスタの中の競合を確かめます。複数のプロセスのタイミングや、ネットワークの断は確かめません。
- `awaitBlocked` は、待つ側の文がエラーで終わったときも、上限の時間の後に失敗します。失敗のメッセージの「待たせている接続」が空なら、待つ側は何も待っていないので、手順 (A が先にロックを取っているか) を見直します。
- `pg_blocking_pids()` を呼ぶ pool は、待ち合わせに使う 2 つの接続とは別にします。`max: 1` の pool に 2 つの接続を取らせると、止まります。
- HTTP を通す競合のテストは、競合の種類ごとには書きません。404 と 409 が Problem Details に変わることを、代表で 1 本確かめます ([ADR 0035](../adr/0035-problem-details-for-api-errors.md))。
