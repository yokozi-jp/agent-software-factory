---
type: Runbook
title: "PostgreSQL のスキーママイグレーション"
description: "PostgreSQL のスキーマ変更の対応手順と、マイグレーションツールの利用方針を定める文書。スキーマを変更するときに読む。"
tags: [db, postgresql, migration]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/postgresql_guidelines.html
    title: PostgreSQL設計ガイドライン
    author: フューチャー株式会社
---

# PostgreSQL のスキーママイグレーション

巨大なテーブルのスキーマ変更はロックのリスクを抑える手順で行う。
スキーママイグレーションツールの利用方針を定める。
出典は [PostgreSQL設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## スキーママイグレーション

### スキーマ変更の対応手順

巨大なテーブル（多くはパーティションテーブル）に対してのスキーマ変更は、時間がかかりすぎることへの懸念や、適用中に思わぬ`ACCESS EXCLUSIVE`ロックを取得してバックグラウンドのアプリケーションが動かなくなるなどリスクがある。リスクを抑える手順が存在するスキーマ変更を下表にまとめる。

| 項目                       | 手順                                                                                                                                                                                                                                                                                                                                                                                     | ロック                                    | 全レコード探索                | 備考                                                                                                                                                                                                                                                            |
| :------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------- | :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| テーブル名変更             | ALTER TABLE {テーブル名} RENAME TO {テーブル名};                                                                                                                                                                                                                                                                                                                                         | AccessExclusive                           |                               |                                                                                                                                                                                                                                                                 |
| カラム名変更               | ALTER TABLE {テーブル名} RENAME COLUMN {カラム名} TO {カラム名};                                                                                                                                                                                                                                                                                                                         | AccessExclusive                           |                               |                                                                                                                                                                                                                                                                 |
| 文字列カラムの桁数を上げる | ALTER TABLE {テーブル名} ALTER COLUMN {カラム名} TYPE VARCHAR(桁数);                                                                                                                                                                                                                                                                                                                     | AccessExclusiveLock                       |                               | パーティションの子テーブル単位での実行は不可。一瞬で終わる                                                                                                                                                                                                      |
| 数値型カラムの桁数を上げる | ALTER TABLE {テーブル名} ALTER COLUMN {カラム名} TYPE NUMERIC(桁, 精度)                                                                                                                                                                                                                                                                                                                  | AccessExclusiveLock                       | ✔                             | パーティションの子テーブル単位での実行は不可。おそらくレコードを見ている? 低速な場合は、新規カラム追加、データコピー、古いカラムを削除、新規カラムをリネームの手順も取れるが、一時的にカラムが存在しなくなる                                                    |
| デフォルト値無しカラム追加 | -- カラム追加 ALTER TABLE {テーブル名} ADD COLUMN {カラム名} {型}; -- アップデート UPDATE …                                                                                                                                                                                                                                                                                              | AccessExclusive                           |                               | カラム追加後のUPDATEは、静止点が取れるのであれば別テーブルで作成しSELECT INSERTでデータ登録。リネームで切り替えが安心である。                                                                                                                                   |
| デフォルト値ありカラム追加 | ALTER TABLE {テーブル名} ADD COLUMN {カラム名} {型} DEFAULT {デフォルト値};                                                                                                                                                                                                                                                                                                              | AccessExclusive                           |                               | PostgreSQL 11でALTER時にはデフォルト値のUPDATEは行なわない仕様に改善されたため                                                                                                                                                                                  |
| NOT NULL制約の追加         | -- (1) CHECK制約を追加 ALTER TABLE {テーブル名} ADD CONSTRAINT {検査名} CHECK ({カラム名} IS NOT NULL) NOT VALID; -- (2) CHECK制約の既存行への適用 ALTER TABLE {テーブル名} VALIDATE CONSTRAINT {検査名}; -- (3) NOT NULL制約を追加 ALTER TABLE {テーブル名} ALTER COLUMN {カラム名} SET NOT NULL; -- (4) 不要になったCHECK制約を削除 ALTER TABLE {テーブル名} DROP CONSTRAINT {検査名}; | AccessExclusive +ShareUpdateExclusiveLock | ✔ShareUpdateExclusiveLockの際 | PostgreSQL 12以降で可能。直接ALTER TABLE ALTER COLUMN SET NOT NULLすると、AccessExclusive＋全探索になる                                                                                                                                                         |
| インデックス新規追加       | １．各パーティションテーブルに対して、CREATE INDEX CONCURRENTLY ２．親テーブルにCREATE INDEXする                                                                                                                                                                                                                                                                                         | 1:ロック無し 2:ShareLock                  | ✔1の場合 2は無し              | 親テーブルにはCONCURRENTLYオプションを指定できない。CONCURRENTLYオプション無しだと、ShareLock（書き込みロック）を取る。回避策は子パーティションテーブルにCONCURRENTLYオプションを付けてインデックスを作成してから、親テーブルにインデックスを作成する方法がある |
| インデックス項目追加       | １．ALTER INDEX {インデックス名} RENAME TO {インデックス名}\_old; ２．CREATE INDEX CONCURRENTLY {インデックス名} ON {テーブル名}(カラム1, カラム2); ３．DROP INDEX {1でリネームしたインデックス名};                                                                                                                                                                                      |                                           |                               | 同名で作成する場合はDROP & CREATEになるが、リネームしてから同名でCREATEしても良い。ヒント句などでインデックス名を指定している場合に便利。パーティションテーブルの場合は、新規追加と同じ手順を組み合わせて実施する                                               |

> [!NOTE]
> **参考**
>
> - [PostgreSQL 11でALTER TABLE ... NOT NULL DEFAULTが簡単になっていた | 株式会社ヌーラボ(Nulab inc.)](https://nulab.com/ja/blog/nulab/alter-table-not-null-default-on-postgresql-11/)
> - [A Missing Link in Postgres 11: Fast Column Creation with Defaults — brandur.org](https://brandur.org/postgres-default#under-the-hood)
> - [令和最新版: PostgreSQLの安全なSET NOT NULL | Wantedly Engineer Blog](https://www.wantedly.com/companies/wantedly/post_articles/433252)
> - [CREATE INDEX](https://www.postgresql.jp/document/16/html/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)

### スキーママイグレーションツール

スキーママイグレーションツールを利用することで、テーブル定義変更の取りこぼしを防ぎ手順の標準化ができる。以下に主要なツールとその特徴を挙げる。

| ツール名                                                   | 説明                                                                                                                                                                                           |
| :--------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Flyway](https://github.com/flyway/flyway)                 | マイグレーションファイルを手動で準備し、適用はFlywayのプロセスに任せる。実行履歴はflyway_schema_historyというテーブルに記録される。                                                            |
| [sqldef](https://github.com/sqldef/sqldef)                 | DDLファイルと実際のスキーマを比較し、その差分に基づいて自動的にマイグレーションスクリプトを生成できる。MySQLなど複数のDBに対応                                                                 |
| [pg-schema-diff](https://github.com/stripe/pg-schema-diff) | スキーマファイルとDB間の差分から、DDLを作成する。なるべくダウンタイムを極小化するDDLを生成する（前説のNOT NULL制約の追加のような手順をツール側が作成してくれる）。名前の通り、PostgreSQLに対応 |

本ガイドラインでは、各ツールの進化も著しくある断面で推奨を出すことは難しいため、具体的なマイグレーションツールは指定せず、利用法の例のみを紹介する。

このリポジトリは、版付きの SQL のマイグレーションファイルを正本にし、dbmate で適用する（[ADR 0025](../adr/0025-kysely-and-dbmate-sql-first.md)）。下の利用例の理想の状態の `ddl.sql` と pg-schema-diff は使わない。

#### 利用例

1. Flywayとpg-schema-diffの2つを利用
2. DBの理想的な状態をddl.sqlファイルに記述し、Gitコミットする
3. pg-schema-diffで、ALTER文などが記載されたマイグレーションファイルを作成する
4. 3で作成したファイルをチェックし、必要に応じて修正する
5. 4で確認したファイルを、Flywayのマイグレーションファイルとして保存する

リリース時にFlywayを実行して各環境のマイグレーションを実行する。

> [!WARNING]
> **pg-schema-diffを信用しすぎない**
>
> 2025年5月時点の最新である `v0.9.0` において、以下の変更には対応していない（READMEにも記載がある）
>
> - View
> - 権限
> - 型（enumのみ対応している）
> - リネーム（テーブルなどのオブジェクトの名前を変更すると、削除&作成になる）
>
> 例えば、VIEWについては、新規作成・変更・削除されてもpg-schema-diffのplan/apply上で何も表示されないし変更されない。そのため、pg-schema-diffだけに頼らず、あくまで補助的なツールとしての利用に留める必要がある。
> pg-schema-diffが生成したスキーマ変更を必ずレビューし、過不足がないことを確認した上で適用すること。

## このリポジトリの migration の書き方

このリポジトリの migration は [dbmate](https://github.com/amacneil/dbmate) で流す版付きの SQL のファイルで、決定と根拠は [ADR 0025](../adr/0025-kysely-and-dbmate-sql-first.md) にあります。次の書き方を守ります。

- **置き場所**: `apps/api/db/migrations/<UTC の日時 14 桁>_<名前>.sql`。足すときは `dbmate new` ではなく、下のひな形を写します。`dbmate new` のひな形は down が空だからです。
- **流し方**: `apps/api` の `pnpm db:migrate` (`DATABASE_URL` に `migrator` の接続 URL を渡す)。dbmate の引数 (`migrate`、`--migrations-table migrations.schema_migrations`、`--migration-lock`、`--no-dump-schema`) は `apps/api/db/migrate.ts` の 1 か所にあり、テストも同じ関数で流します。
- **ロール**: `migrator`、`app_user`、`auth_service` は migration ではなく、`apps/api/db/bootstrap.sql` が作ります (冪等。master user が migration の前に流す)。表とスキーマの所有者は `migrator` で、権限の `GRANT` は migration に書きます。
- **`lock_timeout`**: up の先頭に `SET LOCAL lock_timeout = '5s';` を書きます。ロックを待ち続けて、後ろの要求を詰まらせないためです。
- **`transaction:false`**: `CREATE INDEX CONCURRENTLY` のように、トランザクションの中で実行できない文を含むファイルだけ、`-- migrate:up transaction:false` にします。トランザクションの外では `SET LOCAL` が効かないので、`lock_timeout` は要りません。
- **down**: `DO $$ BEGIN RAISE EXCEPTION 'irreversible …'; END $$;` だけを書きます。dbmate は down が空だと `rollback` が成功して履歴だけを消すので、失敗させるためです。
- **表の形**: テナントの表は、`tenant_id` を先頭にした複合の主キー、連番のサロゲートキー (`bigint GENERATED ALWAYS AS IDENTITY`)、[共通カラム](postgresql-keys.md#共通カラム)、`ENABLE` と `FORCE ROW LEVEL SECURITY` とテナントのポリシーを持ちます。最初の例は `20261027200000_create_module_schemas.sql` の `claim.t_claim` で、共通カラムの型と桁もそこに合わせます。共通カラムの日時は既定値を持たず、アプリがバインドします。
- **型**: モジュールのスキーマ (`claim`、`approval`、`closing`) の表を変えたら、`pnpm exec nx db-types api` で Kysely の型 (`packages/<モジュール>/src/infrastructure/db.gen.ts`) を生成し直して、migration と同じ commit に入れます。CI が、生成し直した型と違うと失敗します ([PostgreSQL のクライアント管理](postgresql-client.md))。
- **前に進めるだけ**: 適用済みの migration は書き換えません。直すときは前向きの migration を足します。互換を壊す変更は expand と contract に分けます。expand (列や表を足す) を出し、アプリを新しい形に切り替えてから、contract (古い列や表を消す) を出します。前の版のアプリが PR の migration を適用した後のスキーマで動くことは、CI の更新の試験が確かめます ([ADR 0036](../adr/0036-migration-compatibility-test-against-base.md)、[CI](../tooling/ci.md#ciyml-の検証))。

```sql
-- migrate:up
SET LOCAL lock_timeout = '5s';

ALTER TABLE example ADD COLUMN note text;

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'irreversible: 前に進めるだけ (docs/adr/0025)'; END $$;
```

down が `RAISE EXCEPTION` だけであることと、up の先頭の `SET LOCAL lock_timeout` (`transaction:false` を除く) は、repo-policy が `db/migrations/*.sql` の全部で検査します (`tools/scripts/src/checks/repo-policy/rules.ts`)。
