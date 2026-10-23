---
type: Convention
title: "PostgreSQL の拡張機能"
description: "PostgreSQL の拡張機能の利用方針と、全文検索サービスとの棲み分けを定める文書。拡張機能を導入するか検討するときに読む。"
tags: [db, postgresql, convention, extension]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/postgresql_guidelines.html
    title: PostgreSQL設計ガイドライン
    author: フューチャー株式会社
---

# PostgreSQL の拡張機能

拡張機能の利用方針と、全文検索サービスとの棲み分けを定める。
出典は [PostgreSQL設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## 全文検索サービスとの棲み分け

2024年10月時点では、PGroongaはAmazon RDS（Aurora）で利用できない。そのため、 `pg_bigm` で業務要件が達成できない場合は、Elasticsearch（OpenSearch）など外部サービスとの連携が必要となる。

機能比較の概要を下表に示す。

| 機能                                                                        | pg_bigm | Elasticsearch                   |
| :-------------------------------------------------------------------------- | :------ | :------------------------------ |
| 処理方式                                                                    | 2-gram  | 様々（2-gram、形態素解析など）  |
| 全文検索 部分一致検索                                                       | ✅️      | ✅️                              |
| あいまい検索 （字やタイプミスを含む検索を許容）                             | ⚠️      | ✅️得意（Levenshtein距離を使用） |
| 検索結果順位のスコアリング （リレバンススコアリングなど）                   | ⚠️      | ✅️得意                          |
| サジェスト機能 （入力中のキーワードに対するオートコンプリートやサジェスト） | ⚠️      | ✅️                              |

あるカラムの部分一致検索といった要求事項であれば、システム構成要素を増やさずに済む `pg_bigm` での対応を推奨とする。一方で、UI/UXなどの観点からあいまい検索への対応や検索結果順位が重要である場合は、Elasticsearch（OpenSearch）など別の全文検索エンジンの導入を検討する。

また、pg_bigmで中間一致検索したい場合は対象カラムにGINインデックスを作成する必要がある。
