---
type: Runbook
title: "DynamoDB の SDK とテスト"
description: "DynamoDB の Go 言語での SDK 利用方針と、ローカルモック・Streams との統合テストを定める文書。DynamoDB のコードや自動テストを書くときに読む。"
tags: [db, dynamodb, sdk, testing, go]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/dynamodb_guidelines.html
    title: DynamoDB設計ガイドライン
    author: フューチャー株式会社
---

# DynamoDB の SDK とテスト

Go 言語での SDK 利用方針を定める。
ローカルモックと DynamoDB Streams との統合テストの方針を定める。
出典は [DynamoDB設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## SDK

### Go言語

GoでDynamoDBを操作する選択肢は、大別すると以下3つがある。

1. 公式のAWS SDK(aws-sdk-go-v2)を利用する
2. [guregu/dynamo](https://github.com/guregu/dynamo)
3. [Go CDK](https://gocloud.dev/)（旧gocloud）

| \#                 | AWS SDK                 | guregu/dynamo                                                  | Go CDK (docstore)                                                      |
| :----------------- | :---------------------- | :------------------------------------------------------------- | :--------------------------------------------------------------------- |
| 説明               | 公式のAWS SDK for Go v2 | 公式SDKをラップし、より高レベルで直感的な操作を提供する        | Googleが中心となって開発する、マルチクラウド対応を目的としたライブラリ |
| 機能網羅性         | ✅高い                  | ✅️ほぼ全ての操作が可能（テーブル作成など管理系の操作は対象外） | ❌抽象化のため低い                                                     |
| 開発生産性         | ❌低い                  | ✅高い                                                         | ✅高い                                                                 |
| マルチクラウド対応 | ❌ なし                 | ❌ なし                                                        | ✅ あり                                                                |

推奨は以下の通り。

- 原則、`guregu/dynamo` を選択する
  - 開発生産性が高く、機能の網羅性も高い。フューチャー社内実績も多く、品質が高いと評判が良いため
- `guregu/dynamo` がサポートしていない機能（管理系の機能や、例えばDAXのネイティブ利用など）のみ、公式SDKを利用する
- Go CDKは、クラウドベンダーロックインに対する要求度が高い場合に限り、導入を検討する

> [!NOTE]
> **参考**
>
> - [DynamoDB×Go連載\#1 GoでDynamoDBでおなじみのguregu/dynamoを利用する | フューチャー技術ブログ](https://future-architect.github.io/articles/20200225/)
> - [DynamoDB×Go連載\#2 AWS SDKによるDynamoDBの基本操作 | フューチャー技術ブログ](https://future-architect.github.io/articles/20200227/)
> - [DynamoDB×Go\#3 Go CDKでどこまでいける？機能を調べてみた | フューチャー技術ブログ](https://future-architect.github.io/articles/20200228/)

## テスト

### ローカルモック

代表的なローカルモックには[DynamoDB local](https://docs.aws.amazon.com/ja_jp/amazondynamodb/latest/developerguide/DynamoDBLocal.html) と [LocalStack](https://docs.localstack.cloud/aws/services/dynamodb/) がある。LocalStackは内部的にDynamoDB localを使用しているため機能自体に大きな差はない。ただしTTLのサポートやリソースブラウザ（GUI）の提供など、DynamoDB localにはない機能も持つ。

| \#                           | DynamoDB local                                                                                      | LocalStack                                                       |
| :--------------------------- | :-------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
| 説明                         | AWSが公式に提供するDynamoDBのエミュレータ                                                           | LocalStack社が提供するエミュレータ。内部的にDynamoDB localを使用 |
| 起動                         | JAR / Docker                                                                                        | Docker                                                           |
| プロビジョニングスループット | ❌ 非サポート                                                                                       | ❌ 非サポート                                                    |
| DynamoDB Streams             | ✅ サポート                                                                                         | ✅ サポート                                                      |
| TTL                          | ❌ 非サポート                                                                                       | ✅ サポート                                                      |
| GUI                          | ❌ 提供なし（[dynamodb-admin](https://github.com/aaronshaf/dynamodb-admin)等のGUIと組み合わせ可能） | ✅ 提供                                                          |

推奨は以下の通り。

- ユニットテストでは、テスト効率の観点から実物のDynamoDBへ接続せず、原則、ローカルモックを使用する
- 第一に公式のDynamoDB localの使用を検討する
- ただし他のAWSサービス（例. S3 、SQS、Lambda）のエミュレータとしてLocalStackを使用する場合、ツール統合の観点から LocalStackの利用を推奨する

### DynamoDB Streamsとの統合

DynamoDB local および LocalStackはDynamoDB Streamsをサポートしている。ただしDynamoDB StreamsをトリガーとしたLambda等の起動をローカルでエミュレートするには工夫が必要となる。

- LambdaのエミュレータとしてLocalStack Lambdaを使用する場合
  - ローカルのストリームARNに対してイベントソースマッピングを設定できるため、シームレスに統合できる
- LocalStack Lambdaを使用しない場合
  - 自前でDynamoDB Streamsのクライアントを作成し、ストリームの変更をポーリングして（AWS SAM Local等と）統合する

推奨は以下の通り。

- DynamoDB Streamsを多用するアーキテクチャにおいては、LocalStack Lambda / LocalStack Dynamo をはじめ、LocalStackを中心的なモックツールとすること
