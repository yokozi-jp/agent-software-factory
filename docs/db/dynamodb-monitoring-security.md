---
type: Runbook
title: "DynamoDB の監視とセキュリティ"
description: "DynamoDB の監視、IAM によるアクセス制御、暗号化、ネットワークセキュリティ、監査を定める文書。監視やセキュリティを設計するときに読む。"
tags: [db, dynamodb, monitoring, security]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/dynamodb_guidelines.html
    title: DynamoDB設計ガイドライン
    author: フューチャー株式会社
---

# DynamoDB の監視とセキュリティ

監視の方針を定める。
IAM によるアクセス制御、暗号化、ネットワークセキュリティ、監査を定める。
出典は [DynamoDB設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## 監視

DynamoDB | CloudWatch Metrics メトリクス監視 | [AWS設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forAWS/aws_guidelines.html#dynamodb) を参照すること。

## セキュリティ

### アクセス制御（IAM）

適切な権限を設定することで、情報漏洩やデータ改ざんリスクを軽減できる。

推奨は以下の通り。

- 最小権限の原則を追求する
  - 開発者に対する権限は、本当に必要な操作のみに絞る（例えば、本番データ調査が必要であればGetItemのみ、データパッチする必要があるユーザーのみPutItemを付与など）
  - アプリケーションへの権限付与は、少なくともDynamoDBを操作するアプリケーションのみに `dynamodb:*` を付与する
  - テーブル単位xAPI単位などの細かい粒度制御は、アプリケーションの環境変数との整合性をチェックするツールなどの開発とセットで検討する。手動でのメンテナンスは設定ミスを誘発するため、行わない

> [!WARNING]
> **マルチテナントの場合は、アイテムレベルのアクセス制御を実装する**
>
> マルチテナントではデータ分離が強く求められる。そのため、アイテムレベルのアクセス制御（Row-Level Securityに相当）をIAMポリシーで強制することが望ましい。
>
> 【実装例】パーティションキーにテナントIDを含め、IAMポリシーのCondition句とポリシー変数を使い「リクエスト元のユーザーIDとアクセスしようとしているアイテムのパーティションキーが一致する場合のみ操作を許可する」というルールを課す。AssumeRole時のセッションタグにUserIDを設定しているイメージ。
>
> ```json
> {
>   "Version": "2012-10-17",
>   "Statement": [
>     {
>       "Effect": "Allow",
>       "Action": ["dynamodb:*"],
>       "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/YourTable",
>       "Condition": {
>         "ForAllValues:StringEquals": {
>           "dynamodb:LeadingKeys": ["${aws:PrincipalTag/UserID}"]
>         }
>       }
>     }
>   ]
> }
> ```

<!-- 前の注記と分ける -->

> [!TIP]
> **環境識別子で絞り込む**
>
> デプロイメント環境をdev、stg、prodごとに作成することは、AWS設計ガイドラインでも求められている。これに従う場合も、本ガイドラインの命名規則は ${ENV}\_TableName といったプレフィックスを付与する方針である。そのため、IAMポリシーのResource句でワイルドカードを使い、特定のプレフィックスを持つテーブルへのみ許可する。これにより、開発用のIAMロールが誤って本番テーブルを操作するといったヒューマンエラーのリスクを軽減できる。
>
> ```json
> {
>   "Version": "2012-10-17",
>   "Statement": [
>     {
>       "Effect": "Allow",
>       "Action": "dynamodb:*",
>       "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/${env}_*"
>     }
>   ]
> }
> ```

### 暗号化

DynamoDBテーブルの暗号化設定は、以下の3つのキーで行える。

| AWS所有キー                            | AWSマネージドキー                                                       | カスタマー管理キー（CMKs）                                                                                            |
| :------------------------------------- | :---------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| デフォルト。追加料金なしで暗号化できる | KMSで管理されるキー。監査証跡（CloudTrail）でキーの使用状況を追跡できる | ユーザーが自身で管理するKMSキー。キーのローテーションや無効化を能動的に制御でき、任意のコンプライアンス要件に対応可能 |

DynamoDBテーブルの暗号化は透過的に復号されるため、AWSの管理者すら平文を読めなくする必要がある場合は、クライアントサイドで暗号化する必要がある（この場合、DynamoDBでのフィルターなどは行えなくなる）。

推奨は以下の通り。

- 特別なコンプライアンス要件をまず確認する
  - 例えば、PCI DSS対応する場合、カスタマー管理キーにする必要がある
- もし、遵守すべきコンプライアンス要件が無ければ、AWS所有キーでの暗号化で十分とし、KMS・カスタマー管理キーでの暗号化は不要とする
  - インフラコスト・管理コストを下げられるため

> [!NOTE]
> **参考**
>
> - [保管時の DynamoDB 暗号化](https://docs.aws.amazon.com/ja_jp/amazondynamodb/latest/developerguide/EncryptionAtRest.html)
> - [Payment Card Industry Data Security Standard (PCI DSS) v4.0 on AWS](https://d1.awsstatic.com/whitepapers/compliance/pci-dss-compliance-on-aws-v4-102023.pdf)
>   - 「You should use KMS Customer Managed Keys (CMKs) for encryption of account data」とあるように、PCI DSSではカスタマーCMKsが求められる

### ネットワークセキュリティ

意図しないネットワークからのアクセスを遮断することで、セキュリティを強化できる。

推奨は以下の通り。

- 原則、VPCエンドポイントを利用する
- VPCエンドポイントポリシーの利用は推奨しない
  - IAM設定側に寄せることで、定義を一元管理する方が直感的で分かりやすいため
  - VPCエンドポイントで制御する場合、複数の経路それぞれが間違いなく動くようにしなければならず、複雑性と変更時の影響範囲が増えてしまうため

### 監査

インシデント発生時に、誰が・いつ・何をしたか、原因調査を可能とする。

推奨は以下の通り。

- AWS CloudTrailを有効化し、DynamoDBへのAPIコール（コントロールプレーン操作とデータプレーン操作）をすべて記録する
  - 「誰がテーブルを作成したか」「誰がどのアイテムにアクセスしたか」を監査可能とする
  - アプリケーションでのデータプレーン操作は出力を抑制し、ユーザー操作は全て出力するといった濃淡を付けたい場合は、CloudTrailレイヤーでは対応できないため、CloudTrail \-\> EventBridgeでフィルタリングする
