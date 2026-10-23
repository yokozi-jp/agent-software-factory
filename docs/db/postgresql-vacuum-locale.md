---
type: Convention
title: "PostgreSQL の VACUUM とロケール"
description: "PostgreSQL の VACUUM の運用方針とロケールの設定方針を定める文書。自動バキュームを設定するとき、照合順序を決めるときに読む。"
tags: [db, postgresql, convention, vacuum, locale]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/postgresql_guidelines.html
    title: PostgreSQL設計ガイドライン
    author: フューチャー株式会社
---

# PostgreSQL の VACUUM とロケール

VACUUM の運用方針とロケールの設定方針を定める。
出典は [PostgreSQL設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## VACUUM

VACUUMには大きく分けて次の2種類がある。

| #           | 説明                                                                                                | ディスク領域の縮小 | ロック                                                        |
| :---------- | :-------------------------------------------------------------------------------------------------- | :----------------- | :------------------------------------------------------------ |
| VACUUM      | ゴミ箱化された行を回収し、空いたスペースを他のDB操作で再利用可能とする。 自動バキュームで実行される | ❌️                 | 参照 / 更新が可能（VACUUM対象のページはロックが取られている） |
| VACUUM FULL | テーブル全体を再編成し、空いているディスク領域を解放する                                            | ✅️                 | `ACCESS EXCLUSIVE` ロックにより、参照 / 更新が不可            |

推奨は以下の通り。

- 原則VACUUMを実行し、テーブルのアクセスが不可となるVACUUM FULLは実行しない方針とする
- VACUUMの実行は手動では実行せず、自動バキュームに任せる

手動でVACUUMを実行する必要があるユースケースは以下である。

- 更新 / 削除が多いテーブルで、自動バキュームが改廃ジョブなどと被って失敗し、すぐVACUUMをしたい場合

VACUUM FULLは以下のような特殊なワークロードのテーブルに対して、必要が生じた場合に限り利用する。

- 特定のテーブルが使用されていない行でいっぱいになり、再びそれほど大きくならないと想定される場合（一時的に更新 / 削除が大量に行われ、かつ自動VACUUMが動かなかったとされる場合）

> [!NOTE]
> **参考**
>
> - [Amazon RDS for PostgreSQL 環境の自動バキュームを理解する | Amazon Web Services ブログ](https://aws.amazon.com/jp/blogs/news/understanding-autovacuum-in-amazon-rds-for-postgresql-environments/)
> - [Cloud SQL for PostgreSQL - VACUUM について深く掘り下げるためのよくある質問と回答](https://cloud.google.com/blog/ja/products/databases/deep-dive-into-postgresql-vacuum-garbage-collector)
> - [PostgreSQL の autovacuum は定期的な VACUUM ANALYZE 実行の代替となる - ぱと隊長日誌](https://taityo-diary.hatenablog.jp/entry/2025/02/24/071321) にPostgreSQL 15のドキュメント更新で、定期的な `VACUUM ANALYZE` の実行の推奨が撤廃され、autovacuum の活用が前提となった旨の解説がある

## ロケール

（ロケールの概要や挙動説明については諸事情で省略する）

> [!WARNING]
> **ロケールは後から変更することができないため、データベース作成時に設計する必要がある**
>
> `lc_collate` `lc_ctype` の設定により、「ソート順」 「照合順（文字列比較）」の動作が異なってしまい、最悪の場合検索要件を満たせない可能性がある。DBを構築する前に要件を確認し正しく設定する必要がある。
> 万が一、初期構築時の設定が要件を満たせない場合、以下のいずれかの対応を検討する。
>
> - データベースを再作成する (pg_dump -> 新規DB作成 -> pg_restore)
> - 必要なSQL全てにオプションを追加
>
>   ```sql
>   -- データベースのデフォルトが ja_JP.UTF-8 でも、一時的に 'C' (バイト順) でソート
>   SELECT product_name FROM products ORDER BY product_name COLLATE "C";
>   ```
>
> - ALTER TABLE で列定義を個別に修正（利用しているインデックスが存在した場合は、再作成すること）
>
>   ```sql
>   ALTER TABLE products
>   ALTER COLUMN product_name SET COLLATION "C";
>   ```

<!-- 前の注記と分ける -->

> [!NOTE]
> **参考**
>
> [ロケール(国際化と地域化) | Let's Postgres](https://lets.postgresql.jp/documents/technical/text-processing/2)
