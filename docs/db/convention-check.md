---
type: Reference
title: DB の規約の検査（カタログのテスト）
description: docs/db の規約のうち、migration を流した DB のカタログで機械的に確かめる項目と、確かめない項目、例外の書き方、検査を足す手順。DB の規約を検査から外す、検査を足す、検査が失敗したとき、表やカラムの規約を確かめたいときに読む。
tags: [db, postgresql, testing, convention, sensor]
---

# DB の規約の検査（カタログのテスト）

`docs/db/` と ADR の規約のうち、migration を流した DB のカタログ (`pg_catalog`) で判定できるものを、`packages/db` のテストで確かめます。
実装は `packages/db/src/convention-catalog.ts` の `checkConventions` で、`convention-catalog.test.ts` が、テンプレートの DB (ADR 0025) を複製して毎回呼びます。
SQL の静的な解析は使いません。決定は [Issue #361](https://github.com/yokozi-jp/agent-software-factory/issues/361) です。
モジュールのロールと表の所有を確かめる検査は別にあります (`module-roles-catalog.ts`、[ADR 0029](../adr/0029-module-data-ownership-and-shared-outbox.md))。

## 確かめる項目

失敗の文の先頭の `[名前]` が、検査の名前です。例外の `check` も同じ名前を使います。

| 検査の名前           | 確かめること                                                                                                           | 出典                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `naming`             | スキーマ、表、カラムの名前が snake_case (`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`)                                              | [物理名の命名ポリシー](postgresql-naming-physical.md)       |
| `reserved-word`      | スキーマ、表、カラムの名前が PostgreSQL の予約語 (`pg_get_keywords()` の `R` と `T`) でない                            | [物理名の命名ポリシー](postgresql-naming-physical.md)       |
| `common-columns`     | 12 個の共通カラムがそろい、型 (`timestamptz`、`varchar`、`integer`) と NOT NULL が合い、`lock_no` の既定値が 1         | [キー設計](postgresql-keys.md)                              |
| `column-types`       | `serial`、`money`、`float`、`real`、タイムゾーンなしの `timestamp` を使わない。IDENTITY 列は `bigint`                  | [カラム](postgresql-column.md)                              |
| `primary-key`        | 主キーがある。複合の主キーが `tenant_id` で始まる                                                                      | [ADR 0011](../adr/0011-tenant-id-and-rls-from-the-start.md) |
| `foreign-key`        | 外部キー制約がない (スキーマをまたぐものは ADR 0029 の検査も止める)                                                    | [制約](postgresql-constraints.md)                           |
| `check-constraint`   | CHECK 制約がない                                                                                                       | [制約](postgresql-constraints.md)                           |
| `unique-constraint`  | UNIQUE 制約がない (ユニークインデックスを使う)                                                                         | [制約](postgresql-constraints.md)                           |
| `row-level-security` | `tenant_id` を持つ表が、RLS を `ENABLE` と `FORCE` にしている                                                          | [ADR 0011](../adr/0011-tenant-id-and-rls-from-the-start.md) |
| `privileges`         | `app_user` と `auth_service` が、スキーマとデータベースに `CREATE` できず、表を所有しない。`PUBLIC` に余計な権限がない | [ADR 0025](../adr/0025-kysely-and-dbmate-sql-first.md)      |

共通カラムの「14 個」は、Issue の記載です。[キー設計](postgresql-keys.md)の表は 12 個なので、表に合わせました。

`PUBLIC` の余計な権限は、PostgreSQL の既定の権限 (ACL が NULL のときの `acldefault`) まで数えます。次は既定なので許します。`public` スキーマの `USAGE`、データベースの `CONNECT` と `TEMPORARY`。関数の `EXECUTE` は既定で `PUBLIC` にあるので、モジュールのスキーマに関数を作るときは `REVOKE ALL ON FUNCTION … FROM PUBLIC` が要ります。

## 確かめない項目

人がレビューで見ます。

- 名前が意味に合うか。テーブル種別のプレフィックス (`t_`、`m_` など) は、機械では確かめません。
- 結合する列の index が足りているか。
- 業務として必要な一意性があるか。
- 共通カラムの桁 (`varchar(64)`)。
- 予約語以外の SQL のキーワード (`name`、`type` など)。規約は「すべてのキーワードを避ける」ですが、全部を止めると `name` や `status` が使えなくなります。PostgreSQL の表で `reserved` のものに絞りました (判断)。

## 例外

`conventionExceptions` (`convention-catalog.ts`) に `{ scope, check, reason }` で書きます。

- `scope`: スキーマ (`auth`) か、表 (`auth.rateLimit`)。
- `check`: 外す検査の名前。`all` はすべて。
- `reason`: 理由。空だと例外は効かず、`[exception]` の失敗になります。

失敗があるときは、外している検査と理由が、失敗の後ろに出ます。

今の例外は 2 つです。

- `auth`: 命名、予約語、共通カラム、型、RLS、外部キー、一意制約。Better Auth が生成する定義のままにするためです ([ADR 0025](../adr/0025-kysely-and-dbmate-sql-first.md))。Issue には命名、共通カラム、型、RLS だけが挙がっていましたが、Better Auth の表は外部キー (`ON DELETE CASCADE`) と UNIQUE 制約も持つので、この 2 つも外しました。
- `migrations`: dbmate の履歴の表。すべての検査を外します。

## 検査を足す手順

1. `convention-catalog.ts` に、`Violation` の一覧を返す関数を足し、`checkConventions` に並べます。`conventionChecks` に名前を足します。
2. `convention-catalog.test.ts` の `breakages` に、規約を破る最小の SQL を足します。規約を満たす表 `claim.t_x` に 1 か所だけ手を入れ、その 1 件だけが出ることを確かめます。
3. 既存の表が通らなければ、直すか、理由を付けて例外に書きます。
