# PostgreSQL と Kysely で、競合と排他を書く方法と、結合テストで決定的に再現する方法を調べる（Effect で包んだときを含む）

## 問い

[Issue #346](https://github.com/yokozi-jp/agent-software-factory/issues/346) の調査。PostgreSQL と Kysely で競合と排他をどう書けるか、結合テスト（testcontainers の本物の PostgreSQL）で競合を決定的に再現するにはどうするかを、一次情報で調べる。

- Kysely での書き方: `forUpdate()` / `forNoKeyUpdate()` / `skipLocked()`、`setIsolationLevel`、楽観排他の `UPDATE … WHERE lock_no = ?` の更新件数（`numUpdatedRows`）の判定。
- エラーの見分け方: 一意制約の違反（23505）、シリアライズの失敗（40001）、デッドロック（40P01）、`lock_timeout`（55P03）を、`pg` のエラーの `code` からどう取り出すか。
- 決定的な再現の方法: 2 本の接続とバリア、`pg_advisory_lock`、`pg_locks` でロックの待ちを確かめてから次へ進む方法、`lock_timeout` を短くする方法など。各方法の標準、ベストプラクティス、アンチパターン。
- Effect 4 で包んだとき（ADR 0028: `Effect.tryPromise`、`acquireUseRelease`、`Context.Service`）に、トランザクションの境界とエラー（型に出す失敗と defect）がどう見えるか。`packages/shared` の `inTenantTransaction`（Promise の関数）との関係。

背景は、経費精算の主な競合が「同じ申請への同時の承認」であること（[#26](https://github.com/yokozi-jp/agent-software-factory/issues/26)）。決定は下さず、比較と、決めるべき論点で終える。

調べた日は 2026-10-29。実験は `/tmp/pgc`（リポジトリの外）で、`postgres:17`（17.11、リポジトリの結合テストと同じ `postgres:17`）を `@testcontainers/postgresql` 12.2.1 で起動して行った。使った版は kysely 0.29.7、pg 8.23.1、effect 4.0.6（リポジトリの catalog と同じ kysely と effect）。実験のスクリプトはこの文書に含めない（結果と要点だけを書く）。以下で「確かめた」は、この実験か、PostgreSQL 17 の公式ドキュメントと、インストールした kysely と pg のソースを読んだ結果。「判断」は私の考えで、一次情報にはない。

## 要約

- **楽観排他**: `UPDATE … WHERE id = ? AND lock_no = ?` の `numUpdatedRows` は `bigint`（`1n` か `0n`）で返る。READ COMMITTED で 2 本が同時に同じ `lock_no` を読んでから書くと、片方が `1n`、もう片方が `0n` になり、行は 1 回だけ更新された。バージョンの条件がないと両方が `1n` で、更新が失われた（確かめた）。どちらが勝つかは毎回変わる（5 回の実行で入れ替わった）。
- **エラー**: Kysely は `pg` のエラーを包まず、`pg.DatabaseError`（`instanceof` で判定できる）をそのまま投げる。`code` に 23505、40001、40P01、55P03 が入り、23505 では `constraint`、`table`、`schema` も入る。`NOWAIT` の失敗も `lock_timeout` の失敗も 55P03 で、`statement_timeout` は別の 57014 になる（確かめた）。
- **決定的な再現**: 「2 本の接続 + Promise のバリア」で read と write の間を揃え、「ロックの待ちは `pg_stat_activity` と `pg_blocking_pids()` で待つ」のが、`sleep` を使わずに済む組み合わせだった。デッドロックと SERIALIZABLE では、失敗する側は毎回同じではないので、「ちょうど 1 本が失敗する」を検証する（確かめた）。接続を 1 本にした pool（`max: 1`）ではバリアが永久に待つ。いまの `tenant-transaction.test.ts` は `max: 1` なので、競合の試験には別の pool が要る。
- **Effect で包む**: `Effect.tryPromise(() => db.transaction().execute(...))` の中断は DB のトランザクションを止めず、止めた後に残りの処理が commit された。`acquireUseRelease` の acquire で `db.startTransaction().execute()`、release で `Exit` を見て commit か rollback にすると、成功、型に出す失敗、defect、中断のすべてで期待どおりになった。ただし中断のときに実行中の SQL を止めるには、Effect の `AbortSignal` を Kysely の `execute({ signal, inflightQueryAbortStrategy: "cancel query" })` に渡す必要がある（確かめた。2014 ms が 178 ms になった）。
- **docs との食い違い**: `docs/db/postgresql-concurrency.md` は、UPDATE が取る `RowExclusiveLock` で他の更新が待つと書くが、PostgreSQL の公式ドキュメントでは `ROW EXCLUSIVE` は自分自身と衝突しない。待ちの実体は行のロックで、実験の `wait_event` は `transactionid` だった。詳しくは「リポジトリの docs との食い違い」。

## Kysely での書き方

### 行のロック

確かめたこと（kysely 0.29.7 の `SelectQueryBuilder` の型とコンパイル結果）:

| Kysely                                               | 生成される SQL                        |
| ---------------------------------------------------- | ------------------------------------- |
| `.forUpdate()`                                       | `select * from "t" … for update`      |
| `.forNoKeyUpdate().skipLocked()`                     | `… for no key update skip locked`     |
| `.forUpdate().noWait()`                              | `… for update nowait`                 |
| `.forShare()`、`.forKeyShare()`                      | `… for share`、`… for key share`      |
| `.forUpdate("claim").skipLocked()`（テーブルを渡す） | `… for update of "claim" skip locked` |

- `of` 句は別のメソッドではなく、`forUpdate(of?)`、`forNoKeyUpdate(of?)` などの引数で渡す（`.of()` というメソッドはなく、呼ぶと `TypeError`）。
- `skipLocked()` と `noWait()` は `SelectQueryBuilder` のメソッドで、ロックの節（`forUpdate` など）の後ろに付ける。
- PostgreSQL の意味: `FOR NO KEY UPDATE` は `FOR UPDATE` より弱く、同じ行への `SELECT FOR KEY SHARE` を止めない。`UPDATE` が（キー以外の列だけを変えるとき）取るのも `FOR NO KEY UPDATE` の側のロック（[Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html)）。`SKIP LOCKED` は「ロックできない行を飛ばす」ので、一貫しない見え方になり、複数の消費者がいるキューの表には使えるが、一般の用途には向かない（[SELECT](https://www.postgresql.org/docs/17/sql-select.html)）。
- 外部キーとの関係（確かめた）: 親の行（`claim`）を `FOR UPDATE` で握っている間、子の表（`approval`）への INSERT は外部キーの検査のロック待ちになり、`lock_timeout = 300ms` で 55P03 になった。`FOR NO KEY UPDATE` で握っているときは INSERT が通った。申請と承認の表が外部キーでつながるなら、この待ちが起きる。申請と承認が別の module（別のスキーマ）で外部キーを持たない構成（ADR 0029）なら当たらない。外部キーを持つかどうかは、このリポジトリのモジュール設計次第（未確認）。
- `SELECT … FOR UPDATE` には、その表の UPDATE 権限が要る（[SELECT](https://www.postgresql.org/docs/17/sql-select.html)）。`t_claim` の表の権限はまだ `app_user` にない（Issue #268）ので、モジュールのロールに権限を与えるときに、承認の処理が使うロックの種類と権限を揃える必要がある（判断）。

### 分離レベル

- `db.transaction().setIsolationLevel("serializable").execute(cb)` は、`begin` の代わりに `start transaction isolation level serializable` を送る（kysely 0.29.7 の `dialect/postgres/postgres-driver.js`）。使える値は型で `read uncommitted | read committed | repeatable read | serializable`。PostgreSQL は `read uncommitted` を `read committed` と同じに扱う。
- トランザクションの途中で分離レベルを変えることはできない（`BEGIN` の時点で決める）。`SET LOCAL` で `lock_timeout` を変えるのは、トランザクションの中でできる（確かめた。下の「`lock_timeout`」）。

### READ COMMITTED での挙動（公式）

READ COMMITTED で `UPDATE` / `SELECT FOR UPDATE` が、すでに他のトランザクションに更新された行に当たると、先のトランザクションが終わるのを待ち、commit されていれば `WHERE` を更新後の行で再評価して続ける（[Transaction Isolation](https://www.postgresql.org/docs/17/transaction-iso.html)）。このため `UPDATE … WHERE lock_no = ?` は、後から来た側が `lock_no` の増えた行を見て 0 件になる。実験の結果もそのとおりだった。

REPEATABLE READ と SERIALIZABLE では、同じ状況は 40001 になり、「アプリはこのレベルで、シリアライズの失敗のときにトランザクションを再試行する用意が必要」と公式が書く（同上）。更新を伴うトランザクションだけが再試行の対象で、読み取りだけのトランザクションは衝突しない（同上）。

### 楽観排他（`lock_no`）

確かめたこと:

```ts
const r = await trx
  .updateTable("claim")
  .set({ status: "approved", lock_no: sql`lock_no + 1` })
  .where("id", "=", 1)
  .where("lock_no", "=", row.lock_no)
  .executeTakeFirst();
r.numUpdatedRows; // 1n（更新できた）か 0n（他に先に更新された）
```

- `numUpdatedRows` は `bigint`。`=== 0n` で比べる（`=== 0` は常に偽）。`numChangedRows` は PostgreSQL では `undefined`。
- `.returning(["id","lock_no"]).executeTakeFirst()` でも判定できる。0 件のときは `undefined`。
- バージョンの条件がないと、両方が更新に成功して片方の更新が消える（実験 1b: 両方 `1n`）。

`docs/db/postgresql-concurrency.md` が推す案 2（`SELECT FOR UPDATE` してからバージョンを比べる）との違い: 案 1（上の形）は 1 回の SQL で、衝突は更新件数で分かる。案 2 は先にロックを握るので、衝突は早く分かるが、ロックの待ちが生まれる。実験 2 では、2 本目は `FOR UPDATE` で待ち、1 本目の commit 後に `lock_no` が増えた行を読んだ（比べる処理が要る）。

## エラーの見分け方

確かめたこと:

| 事象                                        | `code` | `pg` のエラー   | 備考                                                                       |
| ------------------------------------------- | ------ | --------------- | -------------------------------------------------------------------------- |
| 一意制約の違反（主キーも）                  | 23505  | `DatabaseError` | `constraint`（`t_u_key`、`t_pkey`）、`table`、`schema` が入る              |
| `FOR UPDATE NOWAIT` でロックを取れない      | 55P03  | `DatabaseError` | メッセージ `could not obtain lock on row in relation "t"`                  |
| `SET LOCAL lock_timeout` の超過             | 55P03  | `DatabaseError` | メッセージ `canceling statement due to lock timeout`                       |
| `statement_timeout` の超過                  | 57014  | `DatabaseError` | 55P03 ではない。待ちの原因がロックでも 57014                               |
| REPEATABLE READ / SERIALIZABLE の更新の衝突 | 40001  | `DatabaseError` | `could not serialize access due to concurrent update`。Kysely 経由でも同じ |
| デッドロック                                | 40P01  | `DatabaseError` | 検出された側の 1 本だけ。どちらが選ばれるかは実行ごとに変わった            |

- 取り出し方: `e instanceof pg.DatabaseError` で絞り、`e.code` を見る。`pg.DatabaseError` は `pg-protocol` のクラスを `pg` が再エクスポートしている（`pg/lib/index.js`）。Kysely は途中でエラーを包まない（トランザクションの `catch` は rollback して同じエラーを投げ直す。kysely の `kysely.js` の `TransactionBuilder.execute`）。
- コードの一覧は [PostgreSQL Error Codes](https://www.postgresql.org/docs/17/errcodes-appendix.html)（23505 `unique_violation`、40001 `serialization_failure`、40P01 `deadlock_detected`、55P03 `lock_not_available`、57014 `query_canceled`）。
- `statement_timeout` と `lock_timeout` は別。`lock_timeout` は「ロックを待つ時間だけ」に効き、各ロックの取得ごとに別に数える。`FOR UPDATE`（`NOWAIT` なし）と暗黙のロックの両方に効く（[Client Connection Defaults](https://www.postgresql.org/docs/17/runtime-config-client.html)）。
- 再試行できる失敗の目安: 40001 と 40P01 は、トランザクション全体を最初からやり直す（公式の勧め。同上の transaction-iso）。23505 と 55P03 は、再試行してよいかは業務による（判断）。
- `pg` の pool では、アイドル中の接続がサーバーに切られると `error` イベントが出る。`pool.on("error")` に処理がないと、プロセスが `Unhandled 'error' event` で落ちた（実験の後始末で `pg_terminate_backend` をしたときに起きた）。

## 決定的な再現の方法

### 前提

- 競合の試験には、同時に開く接続が 2 本以上要る。pool の `max` が 1 だと、1 本目がバリアで待つ間 2 本目が接続を取れず、永久に待つ（確かめた。1500 ms で打ち切った）。`apps/api/src/db/tenant-transaction.test.ts` は、前のトランザクションの設定が接続に残らないことを確かめるために `max: 1` にしている。競合の試験では `max: 2` 以上にする別の pool を使う（判断）。
- `docs/db/postgresql-test.md` の「各テストを BEGIN と ROLLBACK で包む」方式は、1 本の接続の中で動くので、競合の試験には使えない（別の接続からは、commit されていない行も、握っているロックも見える形にできない）。リポジトリは、テストごとに `CREATE DATABASE … TEMPLATE` で複製した DB を使う（ADR 0025）ので、競合の試験も commit して、2 本の接続で動かせる。

### 方法ごとの比較

| 方法                                                                   | 何を決定的にするか                                 | 確かめた結果                                                                                                                                                                                       | 位置づけ（判断）                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Promise のバリア（read の後、write の前で 2 本を揃える）               | 2 本が同じ状態を読んでから書くこと                 | 楽観排他は毎回 1 本が成功、1 本が `0n`。勝つ側は毎回変わる。SERIALIZABLE の write skew は毎回 1 本が 40001                                                                                         | 標準的。作業のコールバックに「待つ場所」が要る       |
| `pg_stat_activity` と `pg_blocking_pids()` でロックの待ちを待つ        | 「B が A のロックで待っている」状態に入ること      | `wait_event_type = 'Lock'`、`wait_event = 'transactionid'`、`pg_blocking_pids` が 1 件になるまで待てた                                                                                             | `sleep` の代わりになる標準的な方法                   |
| テストが別の接続で行ロックを握り、待ちを確かめてから放す               | 本番のコードを変えずに「待たされる」状態にすること | 握る側をトランザクションのコールバック内に置く形は実験 2 で確かめた。別の接続で `for update` を握って待たせる形は 55P03 の実験で確かめた（放した後に続きが進む形までは、別の接続では試していない） | 本番のコードに待つ場所を足さずに済む。第一候補       |
| `pg_advisory_lock` をテストが握り、本番のコードが advisory lock を取る | 待ちの開始                                         | `pg_locks` の `locktype = 'advisory' and not granted` で待ちを見つけられた                                                                                                                         | 本番のコードが advisory lock を使うときだけ          |
| `NOWAIT` / 短い `lock_timeout`                                         | 待たずに、すぐ 55P03 になること                    | `NOWAIT` と `set local lock_timeout='200ms'` のどちらも 55P03                                                                                                                                      | 待ちを作らずに「ロックが取れない」ときの処理を試せる |
| `sleep` で順序を作る                                                   | なし（確率的）                                     | 実験していない                                                                                                                                                                                     | アンチパターン（下）                                 |

- 「待ちを確かめる」: `SELECT … FROM pg_stat_activity WHERE pid = $1` の `wait_event_type = 'Lock'` と `cardinality(pg_blocking_pids($1)) > 0` を、短い間隔で取って待つ（実験は 5 ms 間隔、5 秒で打ち切り）。`pg_blocking_pids()` は、ロックを持って止めている側と、待ち行列で先にいる側（soft block）の両方を返す（[System Information Functions](https://www.postgresql.org/docs/17/functions-info.html)）。待つ側の PID は、そのトランザクションの中で `select pg_backend_pid()` して渡した。
- 待つ側と待たせる側は別の接続（別の `pg_backend_pid`）にする。監視用の接続も別に 1 本要る（実験は `pg.Client` を 1 本）。
- デッドロック（確かめた）: T1 が行 1、T2 が行 2 を更新してバリアで揃え、T1 が行 2、T2 が行 1 を更新する。`deadlock_timeout`（既定 1 秒）の後に 1 本が 40P01 になる。どちらが選ばれるかは 5 回の実行で入れ替わった。検証は「ちょうど 1 本が 40P01、もう 1 本は成功」にする。公式は、デッドロックの最善の防御は、複数の行を一定の順序で取ることと書く（[Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html)）。
- SERIALIZABLE の write skew（確かめた）: 2 本が同じ集合を読んでから、別々の行を更新する。ちょうど 1 本が 40001 になった。どちらかは毎回変わる。
- 失敗する側が決まらない試験で、特定の側の失敗を検証すると壊れる。検証は「成功が 1 本、失敗が 1 本、最終状態がどちらの結果とも一致する」の形にする（判断）。

### アンチパターン（判断）

- `sleep` で順序を作る: 遅い CI では順序が崩れ、速い機械では待ちすぎる。ロックの待ちは `pg_stat_activity` で確かめられるので、不要。
- `pg_sleep` でトランザクションを長くして窓を広げる: 窓の幅に依存する。バリアの方が確実。
- 実行順だけで「先に着いた方が勝つ」を前提にする: 5 回の実験で勝つ側は入れ替わった。
- `max: 1` の pool で並行を試す: 試験が動かない（上）。
- 1 本の接続の BEGIN / ROLLBACK で競合を試す: 別の接続から見えない。

## Effect 4 で包んだとき

ADR 0028 の前提: Kysely の呼び出しは `infrastructure` が `Effect.tryPromise` で包む。DB の故障は defect にし、型に出すのは `application` が分岐する失敗（一意制約の違反、楽観排他の衝突の 409）だけ。`Effect.runPromise` などの実行の関数は `application` と `infrastructure` では止める（ADR 0028 のルール。この調査では lint を動かしていない）。

### 形 1: `Effect.tryPromise(() => db.transaction().execute(cb))`

- エラーの見え方（確かめた）: `catch` で 23505 だけを `UniqueViolation`（`Data.TaggedError`）に変え、それ以外は `Effect.die` にすると、`Effect.catchTag("UniqueViolation", …)` は 23505 では動き、他の `pg` のエラー（`select 1/0`）は defect になって `catchTag` を素通りした。ADR 0028 の「defect が混ざると `catchTag` が動かない」と合う。
- 中断（確かめた）: `Effect.timeout("150 millis")` で中断しても、Kysely のトランザクションは止まらず、`pg_sleep(0.6)` の後に 2 つ目の INSERT も commit された（行が 2 つ残った）。Effect 側は `TimeoutError` の失敗で返るのに、DB には書かれる。`tryPromise` の `try` が引数（`AbortSignal`）を受けても、`db.transaction().execute(cb)` はシグナルを受けない（`execute(callback)` の署名にオプションがない。kysely 0.29.7）。
- 作業が Effect のとき: `cb` の中で Effect を動かすには実行の関数が要り、`infrastructure` では止められている（ADR 0028）。形 1 は、作業が Promise のコードのとき（例: `inTenantTransaction(db, scope, (trx) => …)` の `cb` が Promise）にだけ素直に使える。

### 形 2: `acquireUseRelease` と `db.startTransaction()`

確かめたこと:

```ts
const withTx = <A, E, R>(use: (trx: ControlledTransaction<DB>) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({ try: () => db.startTransaction().execute(), catch: (e) => e }),
    use,
    (trx, exit) =>
      Effect.promise(() =>
        Exit.isSuccess(exit) ? trx.commit().execute() : trx.rollback().execute(),
      ).pipe(Effect.orDie),
  );
```

| ケース                                                  | 結果（確かめた）                                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 成功                                                    | commit され、行が残った                                                                                                          |
| 型に出す失敗（`Effect.fail(new Conflict())`）           | rollback された                                                                                                                  |
| defect（`Effect.die`）                                  | rollback された                                                                                                                  |
| 中断（`Effect.timeout`）、既定の設定                    | 最終的に rollback された。ただし中断から 2014 ms かかった（実行中の `pg_sleep(2)` が終わるまで待った）。行は残らず、接続も返った |
| 中断、`signal` と `"cancel query"` を渡す               | rollback され、178 ms で戻った。行は残らなかった                                                                                 |
| 失敗を 40001 にして `Effect.retry({ times: 5, while })` | 3 回目で成功した。`withTx` 全体をやり直すので、毎回新しいトランザクションになる                                                  |

- 中断のときに実行中の SQL を止めるには、`Effect.tryPromise({ try: (signal) => … })` の `signal` を Kysely のクエリの `execute({ signal, inflightQueryAbortStrategy: "cancel query" })` に渡す（確かめた。kysely 0.29.7 の `util/abort.d.ts`。`"ignore query"` が既定で、待つのをやめるだけでサーバーの上では動き続ける。`"kill session"` はセッションごと終わらせる）。公式の説明: `tryPromise` の `try` が引数を宣言すると `AbortSignal` を受け、中断で abort される。ただし下の操作は、そのシグナルを見るときだけ止まる（effect 4.0.6 の `Effect.d.ts` の `tryPromise`）。
- `acquireUseRelease` は acquire と release を中断できない領域で動かし、release は acquire が成功したら必ず動く（同上の `acquireUseRelease`）。このため、中断されても rollback が実行された。
- `startTransaction()` が返す `ControlledTransaction` は `commit()`、`rollback()`、`savepoint()` を持つ。`db.transaction().execute(cb)` と違い、`cb` が終わっても自動では commit しないので、release で必ず commit か rollback を呼ぶ必要がある（呼び忘れると接続が pool に戻らない。判断）。
- トランザクションを `Context.Service`（たとえば `Tx`）として `use` に渡す形は、`Effect.provideService` で `Tx` を渡せば作れる（作りは標準的。この調査では型検査まで確かめていない）。

### `inTenantTransaction` との関係

`packages/shared/src/tenant-transaction.ts` の `inTenantTransaction(db, scope, work)` は Promise の関数で、`db.transaction().execute(cb)` の中で `set_config('app.current_tenant', $1, true)` を実行してから `work(trx)` を呼ぶ。`set_config` の第 3 引数 `true` は `SET LOCAL` と同じで、トランザクションの終わりで消える（この関数のコメント）。

| 取り得る形                                                                              | 利点                                                | 欠点                                                                         |
| --------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `inTenantTransaction` を `Effect.tryPromise` で包む（作業は Promise の関数）            | 既存のコードをそのまま使う。形 1 の中断の問題が残る | 作業の中で Effect の合成（依存の `Context.Service`、型付きの失敗）が使えない |
| Effect 版の `inTenantTransaction` を新しく書く（形 2 で begin し、`set_config` を実行） | 型付きの失敗と中断の rollback が揃う                | `shared` に 2 つの関数ができる。`set_config` を実行する手順を 2 か所に持つ   |
| 共通の「begin してテナントを設定する」部分だけ関数にし、commit / rollback の側を分ける  | 重複が最小                                          | 分け方の設計が要る                                                           |

`set_config` を `startTransaction()` の形で動かす確認はしていない（普通のトランザクション内の SQL なので動くはず。判断）。`scope.module` の `SET LOCAL ROLE` は Issue #268 で足される予定で、同じ場所に入る。

### Effect の `effect/sql`（参考）

`effect` 4.0.6 には `dist/sql/SqlClient.d.ts` があり、`withTransaction` と、`BeginTransaction` で `BEGIN ISOLATION LEVEL SERIALIZABLE` に変える手段がある（型定義を読んだ。動かしていない）。ADR 0028 は `effect/sql` と `@effect/sql-pg` を使わないと決めている（`pg` のドライバと合わないため）。この調査はその決定を前提にし、比較に入れていない。

## リポジトリの docs との食い違い

`docs/` は古いことがあるため、一次情報と食い違う点を挙げる。直していない（合意した範囲の外）。

1. **`docs/db/postgresql-concurrency.md` の「DBによる行ロック」**: 「UPDATE などで `RowExclusiveLock` を取るため、他のトランザクションからの更新を待たせる」「`RowExclusiveLock` を先取りした側が優先される」と書く。PostgreSQL の公式では、`ROW EXCLUSIVE` は `SHARE`、`SHARE ROW EXCLUSIVE`、`EXCLUSIVE`、`ACCESS EXCLUSIVE` と衝突し、自分自身とは衝突しない（[Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html)）。同じ行への UPDATE を待たせるのは、行のロックと、行を更新したトランザクションの終了待ちで、実験の待ちは `wait_event_type = 'Lock'`、`wait_event = 'transactionid'` だった。結論（後から来た側が待つ）は合っているが、理由の名前が違う。
2. **同じ文書の `FOR UPDATE`**: 楽観排他の案 2 と `SELECT … FOR UPDATE` の例が `FOR UPDATE` だけを挙げる。外部キーで子の表から参照される行では、`FOR UPDATE` が子の INSERT を待たせるが、`FOR NO KEY UPDATE` は待たせない（確かめた）。キー列を更新しない処理には `FOR NO KEY UPDATE` が選べる、という点が文書にない。
3. **`docs/db/postgresql-test.md` の「アプリ単体テストは BEGIN と ROLLBACK」**: 競合の試験は、2 本の接続が別々に commit するので、この方式に入らない。リポジトリの実際の方式（テンプレートの DB を複製。ADR 0025、ADR 0036）に合わせて、競合の試験の扱いを書く必要がある。
4. **ADR 0025 の「楽観排他の書き方は、サンプル機能の仕様を書くときに決める」**: この調査の範囲では、Kysely 側の書き方（`numUpdatedRows`、`forNoKeyUpdate` など）に問題はなかった。決める項目は下の「決めるべき論点」に出した。
5. **ADR 0028 の失敗の分け方**: 「DB の故障は defect、楽観排他の衝突の 409 と一意制約の違反は型に出す」は、実験の形（23505 だけ `catchTag` できる）と矛盾しなかった。40001、40P01、55P03 をどちらにするかは、ADR に書かれていない。

## 比較（まとめ）

### 排他の書き方

| 方式                                          | Kysely                                       | 衝突の知り方                             | 待ち          | 主なエラー              | 向く場面（判断）                             |
| --------------------------------------------- | -------------------------------------------- | ---------------------------------------- | ------------- | ----------------------- | -------------------------------------------- |
| 楽観排他（案 1: 条件付き UPDATE）             | `.where("lock_no","=",n)` + `numUpdatedRows` | `0n`                                     | なし          | なし                    | 承認など、衝突が少なく 1 回の SQL で済む更新 |
| 楽観排他（案 2: `FOR UPDATE` してから比べる） | `.forUpdate()` / `.forNoKeyUpdate()`         | 読んだ行の `lock_no` の比較              | あり          | 55P03（`NOWAIT` 時）    | 複数の表を続けて更新する処理                 |
| 行ロックで直列化                              | `.forUpdate().noWait()` / `skipLocked()`     | 55P03、または行が見えない                | NOWAIT なら即 | 55P03                   | キューや在庫の引き当て                       |
| SERIALIZABLE                                  | `.setIsolationLevel("serializable")`         | 40001                                    | なし          | 40001                   | 条件が複数行にまたがる検査（write skew）     |
| advisory lock                                 | `` sql`select pg_advisory_xact_lock(…)` ``   | 待ち、または `pg_try_advisory_xact_lock` | あり          | 55P03（`lock_timeout`） | 行にならないもの（集計、採番）の排他         |

### Effect での包み方

| 形                                               | 作業の型 | 中断                            | DB の故障                   | 備考                                 |
| ------------------------------------------------ | -------- | ------------------------------- | --------------------------- | ------------------------------------ |
| 形 1: `tryPromise` + `transaction().execute`     | Promise  | トランザクションが続いて commit | `catch` で分類              | 既存の `inTenantTransaction` と同じ  |
| 形 2: `acquireUseRelease` + `startTransaction()` | Effect   | rollback（待ちは SQL 次第）     | `Exit` で commit / rollback | `signal` を渡すと中断が速い          |
| 形 2 + `signal` と `"cancel query"`              | Effect   | rollback、178 ms                | 同上                        | 各クエリに `signal` を渡す手間が要る |

## 決めるべき論点

1. 承認の衝突を、楽観排他の案 1（条件付き UPDATE）で書くか、案 2（`FOR UPDATE` / `FOR NO KEY UPDATE`）で書くか。`docs/db/postgresql-concurrency.md` は案 2 を推奨している。案 1 は 1 回の SQL で済み、待ちが生まれない。
2. 案 2 を採るなら、ロックの種類を `FOR UPDATE` と `FOR NO KEY UPDATE` のどちらにするか。申請と承認の間に外部キーがあるかどうかに依存する（ADR 0029 のモジュールの分け方と合わせて決める）。
3. 衝突のときの待ち方: `NOWAIT`、`lock_timeout`（何ミリ秒か）、待つ。`docs/db/postgresql-concurrency.md` は画面からの要求に `NOWAIT` を勧める。
4. 40001、40P01、55P03、23505 を、Effect で型に出す失敗にするか defect にするか。再試行する失敗（40001、40P01）を、どの層が何回再試行するか。ADR 0028 は `Schedule` による再試行を使わないとしているので、`Effect.retry({ times, while })` の形（実験では `Schedule` の import なしで動いた）を許すか、`application` の自前のループにするか。
5. Effect で包む形: 形 1 のまま（作業は Promise）にするか、形 2（Effect 版のトランザクション）を `shared` か `infrastructure` に足すか。足すなら、`inTenantTransaction` との重複をどう避けるか。
6. 中断（リクエストの取り消し、タイムアウト）のとき、実行中の SQL を止めるか。止めるなら、すべてのクエリに `signal` と `inflightQueryAbortStrategy` を渡す書き方を共通の関数に入れるか。
7. 競合の結合テストの置き場所と共通の道具: 2 本以上の接続を持つ pool、バリア、`pg_stat_activity` で待ちを確かめる関数を、`packages/db/src/testing` に足すか。`max: 1` の既存の pool とどう分けるか。
8. 試験で何を検証するか: 失敗する側が決まらないもの（デッドロック、SERIALIZABLE）は「ちょうど 1 本が失敗する」とし、決まるもの（`FOR UPDATE` の待ち順、`NOWAIT`、`lock_timeout`）は順序まで検証する、という分け方でよいか。
9. `docs/db/postgresql-concurrency.md` と `docs/db/postgresql-test.md` の食い違い（上の 1 から 3）を、いつ、どの Issue で直すか。

## 未確認のこと

- `set_config('app.current_tenant', …, true)` と RLS を、`startTransaction()` の形（形 2）で動かすこと。RLS のポリシーがある表で `FOR UPDATE` / `FOR NO KEY UPDATE` が、`app_user` やモジュールのロール（Issue #268）で動くこと（`SELECT FOR UPDATE` に UPDATE 権限が要ることは公式で確かめたが、このリポジトリの表では動かしていない）。
- 申請と承認のモジュールの間に外部キーが入るかどうか（外部キーによる `FOR UPDATE` の待ちは別の簡単な 2 表で確かめただけ）。
- ADR 0028 の lint（`no-restricted-properties`）が、形 2 のコードを通すか。この調査では lint を動かしていない。
- `Context.Service` で `Tx` を渡す形の型検査。
- 負荷をかけたときの `deadlock_timeout`、`lock_timeout` の適切な値。Aurora PostgreSQL（本番）での挙動の違い。実験は `postgres:17`（17.11）の単体のコンテナだけ。
- `sleep` で順序を作ったときの不安定さ（実験していない）。
- 各実験の繰り返しの数: バリアの楽観排他、`FOR UPDATE` の待ち、SERIALIZABLE、デッドロックは 7 回、その他は 1 回ずつ。回数の多い統計は取っていない。
- `effect/sql` の `withTransaction` と分離レベルの切り替えは、型定義を読んだだけで動かしていない。

## 出典

- PostgreSQL 17: [Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html)（行ロックの種類、`ROW EXCLUSIVE` の衝突表、デッドロック、advisory lock）、[Transaction Isolation](https://www.postgresql.org/docs/17/transaction-iso.html)（READ COMMITTED の再評価、REPEATABLE READ と SERIALIZABLE の再試行）、[SELECT](https://www.postgresql.org/docs/17/sql-select.html)（ロックの節、`NOWAIT`、`SKIP LOCKED`、UPDATE 権限）、[PostgreSQL Error Codes](https://www.postgresql.org/docs/17/errcodes-appendix.html)、[Client Connection Defaults（`lock_timeout`）](https://www.postgresql.org/docs/17/runtime-config-client.html)、[System Information Functions（`pg_blocking_pids`）](https://www.postgresql.org/docs/17/functions-info.html)、[The Cumulative Statistics System（`pg_stat_activity` の `wait_event`）](https://www.postgresql.org/docs/17/monitoring-stats.html)
- Kysely 0.29.7（`/tmp/pgc/node_modules/kysely/dist` のソースと型定義）: `query-builder/select-query-builder.d.ts`（`forUpdate`、`forNoKeyUpdate`、`skipLocked`、`noWait`）、`kysely.js`（`TransactionBuilder.execute`、`setIsolationLevel`、`ConnectionBuilder`）、`dialect/postgres/postgres-driver.js`（`begin` / `start transaction isolation level`、`cancelQuery`、`killSession`）、`util/abort.d.ts`（`signal`、`inflightQueryAbortStrategy`）、`query-builder/update-result.d.ts`（`numUpdatedRows: bigint`）。公式サイト: [Kysely](https://kysely.dev/)
- node-postgres 8.23.1: `pg/lib/index.js`（`DatabaseError` の再エクスポート）、[Transactions](https://node-postgres.com/features/transactions)（トランザクションは同じ client で）、[Pool](https://node-postgres.com/apis/pool)
- Effect 4.0.6（`/tmp/pgc/node_modules/effect/dist`）: `Effect.d.ts`（`tryPromise` の `AbortSignal`、`acquireUseRelease`）、`sql/SqlClient.d.ts`（`withTransaction`、`BeginTransaction`）。公式: [Effect の MIGRATION.md](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)
- このリポジトリ: `docs/db/postgresql-concurrency.md`、`docs/db/postgresql-test.md`、`docs/adr/0025-kysely-and-dbmate-sql-first.md`、`docs/adr/0028-effect-in-application-and-infrastructure.md`、`packages/shared/src/tenant-transaction.ts`、`apps/api/src/db/tenant-transaction.test.ts`、`packages/db/migrations/20261027200000_create_module_schemas.sql`（`claim.t_claim` の `lock_no`）
- 実験（2026-10-29、`/tmp/pgc`、postgres:17 の 17.11、kysely 0.29.7、pg 8.23.1、effect 4.0.6、Node.js 24.22.1）: 行ロックの SQL 生成、`numUpdatedRows`、エラーの `code`、バリアと `pg_stat_activity` による決定的な再現（楽観排他、`FOR UPDATE` の待ち、SERIALIZABLE、デッドロック、advisory lock）、`max: 1` の pool とバリア、外部キーと `FOR UPDATE` / `FOR NO KEY UPDATE`、Effect の `tryPromise` と `acquireUseRelease` での commit、rollback、中断
