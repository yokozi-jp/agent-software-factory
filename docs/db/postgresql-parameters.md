---
type: Convention
title: "PostgreSQL のパラメータ"
description: "PostgreSQL の fillfactor、shared_buffers、work_mem、plan_cache_mode などのパラメータの設定方針を定める文書。パラメータを調整するときに読む。"
tags: [db, postgresql, convention, parameter, tuning]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/postgresql_guidelines.html
    title: PostgreSQL設計ガイドライン
    author: フューチャー株式会社
---

# PostgreSQL のパラメータ

fillfactor、shared_buffers、work_mem、plan_cache_mode などのパラメータの設定方針を定める。
出典は [PostgreSQL設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## パラメータ

### fillfactor

fillfactorは、テーブルやインデックスに新しいデータを挿入する際に、ページにどれだけ空きスペースを残すかを設定するパラメータである。値を小さくすると、挿入時に使用できる領域は減る一方で、更新時には新しいページを作成せず空き領域を利用するため、更新性能が向上する。

推奨は以下の通り。

- 追記のみのテーブルはfillfactor=100を設定（データパッチも通常、行わないと想定）
- その他、fillfactor=90（テーブルの場合はデフォルト100である）

例えば追記のみ（InsertのみでUpdate/Deleteを行わない）のワークテーブルは、fillfactor=100にする。

```sql
-- テーブルおよびPKにfillfactor=100%を指定
CREATE TABLE w_user (
    user_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_name text,
    email text
) WITH (fillfactor = 100);

ALTER INDEX w_user_pkey SET (fillfactor = 100);
```

なお、インデックスについても同様で追記のみであればfillfactor=100、そうでなければ90とする。デフォルト値は90でありテーブルとは異なる。

### shared_buffers

PostgreSQLの共有メモリバッファの調整には `shared_buffers` を利用する。AWS RDSなどマネージドサービスでは、推奨の設定値に調整済みである（例えば、RDS DB インスタンスは合計メモリの 25％、 Auroraは50％～75％）。

推奨は以下の通り。

- 特別の理由が無い限りプロバイダー提供の初期値から変更しない

> [!NOTE]
> **参考**
>
> [Aurora PostgreSQL の shared_buffers DB パラメータのデフォルト値が Amazon RDS PostgreSQL のデフォルト値よりも大きいのはなぜですか? | AWS re:Post](https://repost.aws/ja/knowledge-center/rds-aurora-postgresql-shared-buffers)

### work_mem

`work_mem` はクエリ実行時に、ソート（ORDER BYやDISTINCT）やハッシュデータ（ハッシュ結合などで発生）を格納する際に用いられるメモリ量である。この `work_mem` を超過するとスワップが発生し、性能劣化の懸念がある。

Amazon Auroraについてはデフォルト値を推奨する。性能検証などで特定のクエリ（例えばソート時にディスクアクセスしてしまい性能劣化するなど）にどうしても調整が必要であれば、`SET LOCAL work_mem TO parameter_value;` でそのセッションのみ変更する。

推奨は以下の通り。

- 値の変更はアーキテクト / DBAに相談の上で実施する
- DBクラスタのパラメータグループの設定値自体は変更しない

> [!NOTE]
> **参考**
>
> [Aurora PostgreSQL のメモリパラメータの調整](https://docs.aws.amazon.com/ja_jp/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.BestPractices.Tuning-memory-parameters.html)

### plan_cache_mode

`plan_cache_mode` は クエリプランキャッシュの動作を制御するために使用され、設定値は3種ある。

| 設定値                 | 説明                                                   | 有効なユースケース                                                   |
| :--------------------- | :----------------------------------------------------- | :------------------------------------------------------------------- |
| `auto`（デフォルト値） | キャッシュを使用するかどうかDBMS側の判断に委ねる       | 大半のケース                                                         |
| `force_custom_plan`    | クエリの引数ごとにプランが作成され、キャッシュされない | 引数の値により、実行計画を変動させた方が性能上有利な可能性がある場合 |
| `force_generic_plan`   | どの引数に対しても同じプランが使用される               | 引数により実行計画に差が無い、同じクエリが大量に呼ばれる場合         |

基本的にはデフォルト値の `auto` でよい。ただし以下2つの考慮ポイントを踏まえ、適切な設定値を選択することが望ましい。

- 100超えパーティションが存在する場合（パーティションによってデータの偏りが大きい場合は、`force_custom_plan`、逆に同じ実行計画で良い場合は `force_generic_plan`）
- N回目以降にSQL応答性能が劣化する場合（毎回同じ実行計画を強制したい場合は、 `force_generic_plan`）
  - 一度、汎用実行計画が選択されると、以降その実行計画が採用される

### その他のパラメータ

AWS RDS/Auroraの場合は、原則デフォルトパラメータ値を利用する。性能検証などで課題が見つかり次第、アーキテクト / DBAと相談の上パラメータを変更する。
