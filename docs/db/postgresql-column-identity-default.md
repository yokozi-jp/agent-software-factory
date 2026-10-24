---
type: Convention
title: "PostgreSQL の IDENTITY 列とデフォルト値"
description: "PostgreSQL の採番に使う IDENTITY 列と、文字列のデフォルト値の扱いを定める文書。採番や既定値を設計するときに読む。"
tags: [db, postgresql, convention, column, identity]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/postgresql_guidelines.html
    title: PostgreSQL設計ガイドライン
    author: フューチャー株式会社
---

# PostgreSQL の IDENTITY 列とデフォルト値

採番は SERIAL ではなく SQL 標準準拠の IDENTITY 列を使う。
文字列のデフォルト値の扱いを定める。
出典は [PostgreSQL設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## IDENTITY列

PostgreSQL 10から、挿入する列に数値を割り当てる「GENERATED AS IDENTITY」構文が追加された。SERIAL/BIGSERIAL型と似ているが、SQL標準準拠である点が異なる。

以下が定義例である。

```sql
CREATE TABLE color (
    color_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    color_name VARCHAR NOT NULL
);
```

また、IDENTITY列には、`BY DEFAULT` `ALWAYS` のオプションがある。

| 名称         | 説明                                                                                                         | 備考                                                           |
| :----------- | :----------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------- |
| `BY DEFAULT` | アプリケーション側で明示的に値を指定可能。`SERIAL`/`BIGSERIAL` と同等の挙動                                  | アプリケーション側からの誤登録がより起こりやすい懸念           |
| `ALWAYS`     | アプリケーション側で明示的に指定できない。 ただし、INSERT文に `OVERRIDING SYSTEM VALUE` を記載すれば登録可能 | COPYを利用した場合は、IDENTITY列に明示的に値を指定しても登録可 |

推奨は以下の通り。

- `SERIAL`/`BIGSERIAL`ではなく、よりSQL標準準拠なIDENTITY列を利用する
- `ALWAYS`オプションを利用することで、アプリケーション側からの誤登録を防ぐ

次のように `DEFAULT` キーワードを指定して明示的なクエリを記載できるが、`DEFAULT` の記載は禁止とする。

例: color_idにDEFAULTを指定。

```sql
INSERT INTO color (color_id, color_name) OVERRIDING SYSTEM VALUE VALUES (DEFAULT, 'Black');
```

> [!WARNING]
> **利用時の注意事項**
>
> テーブル名、カラム名がそれぞれ29文字以上の場合、シーケンス名がオミットされて作成される。29文字超過時に自動生成された命名を利用するか、明示的にシーケンス名を変えるのか、一律体系を変えるのかはチームごとにポリシーを作成し統一すること。

<!-- 前の注記と分ける -->

> [!NOTE]
> **参考**
>
> - [PostgreSQL 10 に関する技術情報](https://www.sraoss.co.jp/tech-blog/pgsql/10-0/)
> - [PostgreSQL: Documentation: 17: 5.3. Identity Columns](https://www.postgresql.org/docs/current/ddl-identity-columns.html)
> - [PostgreSQLで連番を自動生成するIDENTITY列。SERIALとどちらを使うべきか | フューチャー技術ブログ](https://future-architect.github.io/articles/20241113a/)

## 文字列のデフォルト値

文字列型のデフォルト値には、以下の3流派が存在する。

| 項目         | １．何もしない                                                                    | ２．空文字のみに限定                  | ３．NULLのみに限定                    |
| :----------- | :-------------------------------------------------------------------------------- | :------------------------------------ | :------------------------------------ |
| デフォルト値 | 任意                                                                              | 空文字                                | NULL                                  |
| 制約         | なにもしない                                                                      | NOT NULL制約                          | CHECK制約で空文字を拒否する           |
| 備考         | 空文字 / NULLを併用することになる。 SQLで文字列結合する際にエスケープの考慮が必要 | WHERE句では IS NULLを使わないよう注意 | Oracle DBの挙動に近づけたい場合に有効 |

これらの対応が求められた背景を具体例とともに説明する。

- 1の場合、`項目A || 項目B` はどちらかがNULLだと連結結果もNULLとなる
- 回避するためには、 `coalesce(項目A) || coalesce(項目B)` や `concat(項目A, 項目B)` といった処理が必要
- デフォルト値を空文字にした場合、`項目A || 項目B`としても、空文字でない方の項目の値が取得できる。これにより、機能横断的な考慮（≒NULL許容のカラムを文字列結合している全クエリで、適切な関数を使っているかのチェック）が不要になる

1、2の手法のメリット、デメリットを下表にまとめる。

| 観点           | １．何もしない                          | ２．空文字のみに限定                                                                 |
| :------------- | :-------------------------------------- | :----------------------------------------------------------------------------------- |
| 文字列結合     | `concat(項目A, 項目B)` などのエスケープ | `項目A \|\| 項目B` で実装可                                                          |
| 初期値の比較   | `IS NULL` / `IS NOT NULL` を指定        | `= ''` `<> ''` などを指定する。数値や日付型は IS NULL などなので使い分けの注意が必要 |
| ストレージ容量 | 有利                                    | 空文字という値を確保するメタデータ分、わずかに不利                                   |

推奨は以下の通り。

- 新規構築（≒Oracle DBを利用したシステムのリプレイスではない）であれば、1または2を選択することが合理的であり、3は選択しない
- より品質が安定すると考えられる2を採用する
  - NOT NULLの文字列カラムと、NULLを許容するカラムで回避処理の有無を開発者が個別に判断するのは抜け漏れの懸念があり、レビュアーの負荷も大きいため
  - NOT NULLの文字列カラムも含めて、一律エスケープさせるのは手間がかかり、可読性も低いと考えられるため
  - INSERT/UPDATE時にNULLを空文字にエスケープする処理は、アプリケーション側のフレームワークなどで一律でカバーしやすいため

何かしらの事情で2ではなく1の手法を採用する場合は、SQLによる文字列結合に一律`concat()` を用い、 `||` での文字列結合を禁止することを推奨する。

```sql
select concat('hello', ' ', null, 'world');
   concat
-------------
 hello world
(1 row)
```

文字列型を空文字にする場合は、以下の点に注意する。

- NOT NULLの文字列カラムを、デフォルト空文字に変更した場合、ユニークインデックスがあると、NULLとは異なり重複が許容されない。通常NULLになりえる項目を含んだユニークインデックスを作成することは無いと考えられるが留意すること

```sql
-- sampleテーブルにユニークインデックスを追加
postgres=# CREATE TABLE sample (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name varchar(10)
);
CREATE TABLE
postgres=# CREATE UNIQUE INDEX sample_name_idx ON sample (name);
CREATE INDEX

-- 空文字の場合は、重複を許容しない
postgres=# INSERT INTO sample (name) VALUES ('');
INSERT 0 1
postgres=# INSERT INTO sample (name) VALUES ('');
ERROR:  duplicate key value violates unique constraint "sample_name_idx"
DETAIL:  Key (name)=() already exists.

-- NULLの場合は許容される
postgres=# INSERT INTO sample (name) VALUES (null);
INSERT 0 1
postgres=# INSERT INTO sample (name) VALUES (null);
INSERT 0 1
```

この挙動はOracleと異なる。OracleではNULL値でも重複を許容しない。PostgreSQLにてOracle風の動作をさせたい場合は、`NULLS NOT DISTINCT` オプションを利用する必要がある。
