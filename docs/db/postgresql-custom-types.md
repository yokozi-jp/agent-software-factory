---
type: Convention
title: "PostgreSQL の独自型（DOMAIN・ENUM・ltree）"
description: "PostgreSQL の DOMAIN、ENUM、ltree といった独自型の利用方針を定める文書。独自のデータ型や階層データを扱うか決めるときに読む。"
tags: [db, postgresql, convention, custom-type]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/postgresql_guidelines.html
    title: PostgreSQL設計ガイドライン
    author: フューチャー株式会社
---

# PostgreSQL の独自型（DOMAIN・ENUM・ltree）

DOMAIN・ENUM・ltree の独自型は、利点と運用コストを踏まえて利用方針を定める。
出典は [PostgreSQL設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## 独自型

### DOMAIN

CREATE DOMAINで新しいデータドメイン（特別な制約（設定可能な値集合に対する制限）を持つ）を作成できる。DOMAINの利用によりデータの整合性を保ち、コードの再利用性と読みやすさを向上できる。

```sql
-- 正の数値を持つドメインとテーブルを作成
CREATE DOMAIN posint AS integer CHECK (VALUE > 0);
CREATE TABLE example (id posint);

-- 成功
INSERT INTO example VALUES(1);
-- 失敗
INSERT INTO example VALUES(-1);
```

便利なDOMAINであるが、以下の観点から利用は禁止とする。

- DOMAINの変更が必要になった場合、ALTER DOMAINで定義を変更できる。ただし、該当のDOMAINを利用しているテーブルが新しい制約に準拠しているかチェックするためテーブルロックがかかり、メンテナンスウィンドウが必要となる
- ドメインをvarcharなどの基本型に戻す場合はALTER TABLEを行うが、`ACCESS EXCLUSIVE`ロックを取ってしまい、メンテナンスウィンドウが必要となる
- DOMAINの内容はビジネスロジックと密接で、リリースライフサイクルがアプリケーションコード側と一致することが多い。通常、DBのスキーママイグレーションとアプリケーションでは、アプリケーション側のリリースのほうが容易であるため、アプリケーション側にバリデーションを寄せる
  - データ整合性に対する全てのバリデーションをDB層に寄せることはそもそも不可能であり、アプリケーション側にバリデーション処理が残るのであればそちらに寄せる設計ポリシーが妥当である
- データ移行など大量データの取り扱いで性能劣化の懸念がある

### ENUM

以下のように、独自のENUM型を作成しカラムの制約として利用できる。

```sql
CREATE TYPE order_state AS ENUM ('Pending', 'Processing', 'Shipped', 'Delivered');

CREATE TABLE order (
    order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    order_date TIMESTAMPTZ NOT NULL,
    order_status order_state NOT NULL
);
```

適切にENUMを利用することで、DB層で整合性が保たれメリットも大きい。

ENUMのメンテナンスは作業内容によって以下の制約がある。

|                          | 作業内容                                                                                                                                                                                                                                                                                                                                                                                              | メンテナンスウィンドウ                             |
| :----------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------- |
| １．ENUMの区分値リネーム | ALTER TYPE name RENAME VALUE …                                                                                                                                                                                                                                                                                                                                                                        | 瞬時                                               |
| ２．ENUMの区分値追加     | ALTER TYPE name ADD VALUE …                                                                                                                                                                                                                                                                                                                                                                           | 瞬時                                               |
| ３．ENUMの区分値削除     | ALTER TYPEで削除する構文が提供されていないため、元のENUMをリネーム、新規でENUM作成、ALTER TABLEで変更。 -- ENUMをリネーム ALTER TYPE order RENAME TO order_old; -- 区分値を減らしたENUMを作成 CREATE TYPE order_state AS ENUM ('Pending', 'Processing', 'Shipped'); -- テーブル側のカラムの型変更 ALTER TABLE order ALTER COLUMN order_status TYPE order_state USING order_status::text::order_state; | ALTER TABLEで、ACCESS EXLUSIVEロックを取ってしまう |

ENUMの代わりに、CHECK制約で代替することも考えられる。CHECK制約の場合は、区分値の削除時でもロックを限定的にできる（※NOT VALID、VALIDATEを利用すれば）ためである。その場合はCHECK制約側の利用ポリシーに依存する。

推奨は以下の通り。

- ENUMは原則利用を禁止する
  - 区分値の削除のメンテナンスが大変であるため
- 区分値削除が必ず発生しないカラムに限り、アーキテクト / DBAと相談の上で利用を許容する
  - 同じ区分値だが、ENUMを使うカラム・使わないカラムが揺れないように、ポリシーを決定の上で検討すること

> [!NOTE]
> **参考**
>
> - [ALTER TYPE](https://www.postgresql.jp/docs/17/sql-altertype.html)
> - [Native enums or CHECK constraints in PostgreSQL? | The Making of Close](https://making.close.com/posts/native-enums-or-check-constraints-in-postgresql)

### ltree

ltreeとは、格納されているデータのラベルを階層型ツリー構造で表すためのデータ型である。PostgreSQL拡張を有効にすると利用でき、Amazon RDS、Google CloudSQLなどでも利用できる。

推奨は以下の通り。

- 新規開発者の負荷が高いため通常利用しない
- 性能・開発生産性上、大きなメリットがある場合は、アーキテクト / DBAと相談して決定する
- 特定のPostgreSQL拡張を有効にすることで利用できるデータ型についても同様である

> [!NOTE]
> **参考**
>
> [Postgresqlのltreeを活用した階層構造の便利な利用法 - RAKUS Developers Blog | ラクス エンジニアブログ](https://tech-blog.rakus.co.jp/entry/20241008/postgresql)
