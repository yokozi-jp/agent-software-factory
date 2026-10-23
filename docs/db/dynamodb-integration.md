---
type: Convention
title: "DynamoDB と他のデータストアの組み合わせ"
description: "DynamoDB の OLAP 連携と全文検索サービス連携の方式を定める文書。DynamoDB のデータを分析や全文検索に使うときに読む。"
tags: [db, dynamodb, convention, integration]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/dynamodb_guidelines.html
    title: DynamoDB設計ガイドライン
    author: フューチャー株式会社
---

# DynamoDB と他のデータストアの組み合わせ

OLAP 連携と全文検索サービス連携の方式を定める。
出典は [DynamoDB設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## 他のデータストアとの組み合わせ

AWSのPurpose-Built（目的別）データベースの考え方では、用途に合わせて複数のデータストアサービスを併用する。各機能のニーズに特化したデータベースを採用することで、システム全体の性能、拡張性、信頼性を最大化できる。

### OLAP連携

DynamoDBからDWHやデータレイクといったOLAP系システムへ連携する主要な方式は以下の通り。

| 観点             | （1）S3増分エクスポート                         | （2）DynamoDB Streams                              | （3）Glueジョブ                                                    |
| :--------------- | :---------------------------------------------- | :------------------------------------------------- | :----------------------------------------------------------------- |
| データ鮮度       | ⚠️バッチ（数分〜数時間）                        | ✅ ニアリアルタイム（秒〜分）                      | ❌バッチ（ジョブ実行時の断面）                                     |
| 費用             | ✅WCU/RCUの消費ゼロ。S3ストレージ課金           | ✅️Lambda費用                                       | ❌大。テーブルスキャンでRCUを大きく消費。Glueの実行時間（DPU）費用 |
| データ変換能力   | ❌なし。DynamoDB JSON形式                       | ⚠️中。後続のLambdaで変換可能                       | ✅高。Spark ETLで複雑な変換・集計・結合が可能                      |
| 削除データの扱い | ✅可能                                          | ✅可能。REMOVEイベントとしてストリームに流れる     | ❌不可。スキャン時点で存在しないデータは取得できない               |
| 実装の容易さ     | ✅️簡単。PITR有効化とエクスポートAPI呼び出しのみ | ✅️簡単。ストリームを有効化し、Lambdaトリガーを設定 | ⚠️中。Glueジョブのスクリプト開発と実行管理が必要                   |
| 主な制約         | PITRが有効である必要                            | DynamoDB Streamsの保持期限24時間など               | テーブルフルスキャンによるRCU消費の大きさがネック                  |

推奨は以下の通り。

- 原則、（1）S3増分エクスポートを第一に検討する
  - 費用が最も安く、Glueジョブなど後でETL処理を追加しやすいため
  - どうしても、即時反映が必要な場合のみ、（2）を採用する
- （3）は、ソーステーブルへのRCU負荷が非常に大きいため、原則利用しない
  - 削除されたデータを追跡できず、データレイク側との差分整合性が取れなくなる懸念もある

> [!TIP]
> **DynamoDBデータ形式を変換する**
>
> DynamoDBの[エクスポートデータ形式](https://docs.aws.amazon.com/ja_jp/amazondynamodb/latest/developerguide/S3DataExport.Output.html)は分析クエリに不向きなため、GlueジョブなどでApache Parquet（Apache Iceberg）などに変換すると効率が上がる。鮮度は劣るものの、SQLによるデータ調査などが行いやすくなる。

<!-- 前の注記と分ける -->

> [!TIP]
> **スキーマ変更への対応**
>
> アプリケーションの改修で新しい属性が追加された場合、OLAPシステム側の追従方法を考慮する必要がある。AthenaやRedshift Spectrumからのクエリは、Glueクローラーで定期的にスキャンさせれば、自動でスキーマ変更に追従できる。

<!-- 前の注記と分ける -->

> [!NOTE]
> **参考**
>
> - [Amazon DynamoDB の S3 への増分エクスポートについての発表](https://aws.amazon.com/jp/about-aws/whats-new/2023/09/incremental-export-s3-amazon-dynamodb/)
> - [Amazon DynamoDB の増分エクスポートを使用した継続的なデータ保持](https://aws.amazon.com/jp/blogs/news/use-amazon-dynamodb-incremental-exports-to-drive-continuous-data-retention/)
> - [https://aws.amazon.com/jp/blogs/database/use-amazon-dynamodb-incremental-export-to-update-apache-iceberg-tables/](https://aws.amazon.com/jp/blogs/database/use-amazon-dynamodb-incremental-export-to-update-apache-iceberg-tables/)

### 全文検索サービス連携

サービスの成長とともに、以下のような複雑な全文検索要件に対応する必要が出てくる場合がある。

- **関連度スコアリング**: 検索キーワードとの関連性が高い順に結果を並べ替える
- **形態素解析**: 単語の区切りを正しく認識し、検索精度を向上させる（例：「東京都」を「東京」と「都」に分割）
- **柔軟な検索**: あいまい検索、類義語検索、オートコンプリートなど

対応方針は大きく3つ考えられる。

| \#       | （1）OpenSearch連携                                                | （2）DynamoDB転置インデックス                                         | （3）Aurora PostgreSQL連携                                                           |
| :------- | :----------------------------------------------------------------- | :-------------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| 説明     | DynamoDBのデータをOpenSearch Serviceに同期し、検索処理をオフロード | GSIを使い、検索キーワードをPKとした転置インデックスを擬似的に作成する | DynamoDBのデータをRDBであるAuroraに同期し、拡張機能（`pg_bigm`など）で全文検索を行う |
| 検索機能 | ✅ 非常に高機能                                                    | ❌ 単一キーワードのみ                                                 | ✅️高機能。`pg_bigm`によるN-gram方式の全文検索や、`pg_trgm`によるあいまい検索が可能   |
| 性能     | ✅ 非常に高い                                                      | ✅️ Queryのため高速                                                    | ✅ 高い                                                                              |
| 費用     | ⚠️OpenSearchクラスタの運用費が別途必要                             | ⚠️GSIの追加書き込み（WCU）とストレージコストが増加                    | ⚠️Auroraクラスタの運用費が別途必要                                                   |

特に（1）、（3）を利用する場合は、データストアへの連携方針として以下の2方式が考えられる。

1. DynamoDB Streamsで同期
   - 非同期的な反映になるが、システム安定度や拡張性は増す
2. アプリケーション側で両投げ
   - 反映タイミングを制御しやすいが、アプリケーションロジック側にリトライなどが入り複雑化
   - アプリケーション上のテストやローカル環境の構築は行いやすい

推奨は以下の通り。

- 本格的な全文検索にはOpenSearch Serviceを利用する
  - OpenSearch Serviceを利用する場合は、アプリからの両投げを推奨する。ローカル環境構築の容易さ、テストのしやすさが理由。そのうえで拡張性などが必要な場合は、DynamoDB Streamsの採用を考える
- DynamoDB単体で複雑な検索条件に対応しすぎない
  - 検索条件の追加は基本的にGSIで対応する。Scanを使う必要がある場合は設計の破綻を示すため、他のデータストアとの併用を検討する
  - GSIで転置インデックスの実装も可能だが、形態素解析などを自前で行う必要があり、運用コストが高い。また、関連度スコアリングや、AND/OR検索の複数キーワード対応、あいまい検索などの実装ハードルも高い。RCU/WCUコストも想定外に膨れ上がる
