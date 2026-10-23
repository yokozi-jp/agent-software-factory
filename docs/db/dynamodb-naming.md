---
type: Convention
title: "DynamoDB の命名規則"
description: "DynamoDB のテーブル名などの AWS リソース名と、アイテムの属性名の命名規則を定める文書。DynamoDB のテーブルや属性に名前を付けるときに読む。"
tags: [db, dynamodb, convention, naming]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/dynamodb_guidelines.html
    title: DynamoDB設計ガイドライン
    author: フューチャー株式会社
---

# DynamoDB の命名規則

テーブルなどの AWS リソースは AWS インフラ命名規約に準拠する。
アイテムの属性は PostgreSQL 設計ガイドラインの命名規約を適用する。
出典は [DynamoDB設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## 命名規則

DynamoDBの命名規則は、AWSリソース全般の命名規約と、データ属性に関する2つの側面から定義する。これにより、インフラ層からデータ層まで一貫した思想に基づく命名を実現する。

- テーブルやインデックスといったAWSリソース: [AWSインフラ命名規約](https://future-architect.github.io/coding-standards/documents/forAWSResource/AWS%E3%82%A4%E3%83%B3%E3%83%95%E3%83%A9%E3%83%AA%E3%82%BD%E3%83%BC%E3%82%B9%E5%91%BD%E5%90%8D%E8%A6%8F%E7%B4%84.html) に準拠し、リソースの役割と環境を明確に識別できるようにする。
- アイテムの属性: [PostgreSQL設計ガイドライン](postgresql-table-types.md) の命名規約を適用する。これにより、データモデルの可読性と一貫性を担保する。

推奨は以下の通り。

- テーブル名
  - 「AWSインフラ命名規約」に準拠し、単語の区切り文字はハイフン(`-`)とする。基本的なフォーマットと例は以下の通り。

```sh
{env}-{product}-{usage}

# 例1: ステージング環境のfugaプロダクトにおけるユーザーテーブル
stg-fuga-user

# 例2: 本番環境のfugaプロダクトにおけるユーザーアクセスログテーブル
prod-fuga-user-access-log
```

- 属性名
  - 「PostgreSQL設計ガイドライン」の命名規約に準拠し、主要なルールをDynamoDBの文脈に合わせて適用する
  - 基本
    - `snake_case`を採用する。(例: `user_name`, `created_at`)
    - 予約語（例: key, type, size など）は避ける。やむを得ず使用する場合は式属性名で対応する。
- プライマリーキー
  - そのキーが何を示すか明確な名前をつける。(例: `user_id`, `order_id`)
- グローバルセカンダリインデックス(GSI)名
  - gsi1, gsi2, …のように、汎用的な連番で命名する。キーの属性名を組み合わせた `user_id-created_at-index`のような命名は非推奨とする
    - GSIのキー構成や射影する属性は、将来の要件変更に伴い変更される可能性があるため

> [!TIP]
> **属性名の長さはアイテムの合計サイズに影響する**
>
> [DynamoDB のコストを最小限に抑える | AWS re:Post](https://repost.aws/ja/knowledge-center/dynamodb-minimize-costs)では、属性名を短くするとストレージコストやRCU/WCUを抑制できる可能性に触れられている。また、DynamoDBの公式ドキュメントの例示では `snake_case` ではなく `CamelCase` を利用することが多い。
>
> 本ガイドラインでは、多少のコスト削減よりRDBに親しんだ開発運用者への混乱を少しでも抑えるという思想で、 `snake_case` を推奨している。
