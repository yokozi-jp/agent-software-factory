---
type: Convention
title: "PostgreSQL のパーティション設計"
description: "PostgreSQL の宣言的パーティショニングの制約、パーティションキー、対象テーブル、手法、メンテナンスを定める文書。巨大なテーブルをパーティション化するときに読む。"
tags: [db, postgresql, convention, partitioning]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/postgresql_guidelines.html
    title: PostgreSQL設計ガイドライン
    author: フューチャー株式会社
---

# PostgreSQL のパーティション設計

巨大で改廃が必要なトランザクションテーブルはパーティション化し、DROP で効率的に改廃する。
パーティション数は100程度に保ち、日次・月次はレンジパーティションを使う。
出典は [PostgreSQL設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## テーブル物理設計

### パーティション設計

PostgreSQL 10以降は「宣言的パーティショニング」が利用可能となった。従来のトリガー関数を用いた実装が不要となり、利用時の敷居が下がった。PostgreSQL 11以前は、パーティション数が多すぎると実行計画作成に時間がかかりすぎ性能劣化の可能性があるため、100以下が推奨だった。PostgreSQL 12以降はパーティション数が多い場合でも、**興味のある**パーティションテーブルのみを参照するように実行計画の作成が改善された。

> [!NOTE]
> **参考**
>
> - [パーティショニングの概要｜PostgreSQLインサイド : 富士通](https://www.fujitsu.com/jp/products/software/resources/feature-stories/postgres/article-index/partitioning-overview/)
> - [PostgreSQL 12は ここがスゴイ！ ～性能改善やpluggable storage engineなどの新機能を徹底解説～ （NTTデータ テクノロジーカンファレンス 2019講演資料）](https://www.slideshare.net/slideshow/postgresql12-performance-improvement-pluggable-storage-engine-ntt-sawada/175323517#8)

PostgreSQL 13ではパーティション結合時の改善、14では更新 / 削除時のパーティションプルーニング運用性向上など、機能改善が続いている。

一方で、複数パーティションを参照しうるクエリは、引き続き実行計画作成に時間がかかる。そのため、大量のパーティションを作成することは非推奨とする。トータルのデータ量次第であるが、本ガイドラインでは引き続きパーティション数を100程度に保つことを推奨とする。

#### パーティションの制約

[5.11. テーブルのパーティショニング](https://www.postgresql.jp/docs/17/ddl-partitioning.html#DDL-PARTITIONING-DECLARATIVE-LIMITATIONS) を参照する。

特に、以下の点に注意する。

- PostgreSQL 17時点では、パーティションキーを含まない「グローバルインデックス」を作成できない

過去に存在した制約は、アップデートで改善した内容も多いので注意する。

- PostgreSQL 10以前は、パーティションにまたがるUPDATEやINSERT ON CONFLICTが不可だった。PostgreSQL 11以降はパーティション間の行の移動が可能となった。

##### パーティションキー

「日付（年月日）」カラムでのパーティション化を最初に検討する。この際、保持期間が最大100日となることが許容できない場合は、月次でのパーティション化（100ヶ月≒8年4ヶ月）を検討する。パーティションキーの更新は負荷が高くなるため、避けること。

##### パーティション化対象テーブル

データ量が巨大（数百万レコード以上）かつ、データ改廃が必要になるトランザクションテーブルはパーティション化する。DELETE改廃ではなく、DROPでパーティションごと改廃することで、自動バキュームを誘発せず効率的である。

##### パーティション化手法

パーティション化手法には、PostgreSQL 10では「レンジ (範囲)」 「リスト」、PostgreSQL 11に追加された「ハッシュ」の3種類が存在する。日次パーティションや月次パーティションを取る場合は、「レンジ」を用いること。

```sql
CREATE TABLE item_order
(
    order_id varchar(10) NOT NULL,
    order_date date  NOT NULL,
    name     varchar(12) NOT NULL,
    CONSTRAINT item_order_PKC PRIMARY KEY (order_date, order_id)
) PARTITION BY RANGE (order_date);

CREATE TABLE item_order_20241026 PARTITION OF item_order
    FOR VALUES FROM ('2024-10-26') TO ('2024-10-27');
CREATE TABLE item_order_20241027 PARTITION OF item_order
    FOR VALUES FROM ('2024-10-27') TO ('2024-10-28');
CREATE TABLE item_order_20241028 PARTITION OF item_order
    FOR VALUES FROM ('2024-10-28') TO ('2024-10-29');
```

「リスト」 「ハッシュ」のパーティション化は、それぞれに適した要件があれば、適時採用する。パーティションごとの件数の偏りが起こらないよう、できる限り実データを用いて検証する。

以下にそれぞれの特徴をまとめる。

| 手法     | 説明                                                                                 | パーティションキー例                       |
| :------- | :----------------------------------------------------------------------------------- | :----------------------------------------- |
| レンジ   | 指定された範囲に基づいてパーティショニング振り分けを実行                             | 帳票作成日、帳票作成年月                   |
| リスト   | 値のリストによってパーティショニング振り分けを実行                                   | 店舗グループ地域コード、商品カテゴリコード |
| ハッシュ | パーティション対象のキーのハッシュ値に対して、指定された分割数の剰余で振り分けを実施 | テナントID、顧客ID                         |

##### コンポジットパーティション

複数のパーティションを組み合わせた、コンポジットパーティション（サブパーティション）の構成を取ることも可能である。

推奨は以下の通り。

- パーティショニング数を著しく増やす要因にもなるため、原則利用しない
  - データ改廃は親パーティション単位で行い、参照性能はテーブル設計 / インデックス設計を上手く設計することで回避できることが多いため

##### 継承を用いたパーティション

パーティショニングはテーブルの継承を使用して実装可能であり、以下のメリットがある。

- 子テーブルは親テーブルに存在しない列を持てる
- ユーザーが選択した方法に従って範囲、リスト、ハッシュ以外の分割が可能

推奨は以下の通り。

- 継承を用いたパーティショニングは禁止

> [!NOTE]
> **参考**
>
> [5.11. テーブルのパーティショニング](https://www.postgresql.jp/document/16/html/ddl-partitioning.html#DDL-PARTITIONING-USING-INHERITANCE)

##### パーティション追加メンテナンス

[PostgreSQLエンタープライズ・コンソーシアム WG2(移行WG) 2022年度活動成果報告 PostgreSQLのパーティショニング運用](https://www.pgecons.org/wp-content/uploads/2023/05/PGECons_2022_WG2_Seminar_presentation_20230524.pdf) によれば、パーティションの追加方法は以下の2種類が考えられる。

|      | （1）CREATE TABLE                | （2）ATTACH                        |
| :--- | :------------------------------- | :--------------------------------- |
| Pros | ✅️1SQLでパーティション追加できる | ✅️ロックによる業務影響は発生しない |
| Cons | ❌️テーブルロックが発生する       | ❌️複数のSQLを用いる                |

2.ATTACHの例を示す。

```sql
-- ①パーティションの元のテーブルを作成
create table PART_T_P2023_03 (like PART_T including
defaults including constraints) with ( FILLFACTOR = 80);

-- ②パーティションテーブルに①をパーティションとして組み込みを行う。
alter table PART_T attach partition PART_T_P2023_03
for values from ('2023-03-01') to ('2023-04-01');
```

メンテナンスウィンドウを確保できない場合は、2のATTACHによる手法を用いること。

##### パーティション削除メンテナンス

[5.11. テーブルのパーティショニング](https://www.postgresql.jp/docs/17/ddl-partitioning.html) から、パーティションの削除運用には以下の3つの手法が考えられる。

| No  | 手順                                                                                                                                             |
| :-- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | -- 直接drop DROP TABLE measurement_y2006m02;                                                                                                     |
| 2   | -- detachしてからdrop ALTER TABLE measurement DETACH PARTITION measurement_y2006m02; その後にDROPする。                                          |
| 3   | -- concurrentlyオプション付きでdetachしてから、drop ALTER TABLE measurement DETACH PARTITION measurement_y2006m02 CONCURRENTLY; その後にDROPする |

1, 2の方法は、親テーブルには`ACCESS EXCLUSIVE`ロックを必要とする。メンテナンスウィンドウを確保できない場合は、3の手法を取る。
