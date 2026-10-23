---
type: Convention
title: "QoS と Pub/Sub 機能の利用可否"
description: "配信保証 (QoS) のレベル選択と、PostgreSQL/Redis の Pub/Sub 機能を業務の非同期実行基盤に使わないことを定める規約。配信保証のレベルを選ぶとき、DB/キャッシュの Pub/Sub を使おうとするときに読む。"
tags: [async, convention, qos]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forAsync/async_guidelines.html
    title: 非同期設計ガイドライン
    author: フューチャー株式会社
---

# QoS と Pub/Sub 機能の利用可否

QoS は欠損のある At most once を避け、At least once 以上を用いる。QoS に関わらずタスクは冪等に作る。
メッセージ永続性が無いため、PostgreSQL NOTIFY/LISTEN と Redis PUBLISH/SUBSCRIBE は業務ロジックの非同期実行基盤に使わない。
出典は [非同期設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## QoS

キューにおけるQoS（Quality of Service）は、以下の3レベルで表現される。なお、すべてのレベルで順序保証がされるわけではない。

| レベル        | 説明                                              | リスク                                                                                     |
| :------------ | :------------------------------------------------ | :----------------------------------------------------------------------------------------- |
| At most once  | メッセージが1回以下（0回または1回）送信されること | ❌️メッセージ欠損がありえる                                                                 |
| At least once | メッセージが少なくとも1回は送信されること         | ❌️コンシューマーが2回以上重複して起動されることがありえる                                  |
| Exactly once  | メッセージがちょうど1回送信されること             | ✅️メッセージの受け渡しは1回であるが、送信側が2重で送信した場合に重複排除されるわけではない |

推奨は以下の通り。

- QoSを選択できる場合、欠損がありえるため At most onceを利用しない
- 少なくとも、At least once以上のレベルを用いる。費用観点で、At least onceを選択することを最初の選択肢とする
- QoSに関わらず、タスクは冪等に作る（At least onceでは重複起動がありえる。Exactly onceであっても、ジョブのリカバリなどで重複して起動されることはありえるため）

## PostgreSQLやRedisのPub/Sub機能を用いた非同期

PostgreSQLの `NOTIFY/LISTEN` やRedisの `PUBLISH/SUBSCRIBE` は、DBやキャッシュサーバーがすでに存在している場合、SQSなどの追加のインフラ構築なしで非同期化を実現できるため軽量な非同期通信の仕組みとして魅力的に映る。注意点は、これらの機能にはメッセージの永続性が無いことである。例えば、コンシューマーが何らかのプロセス障害か、ネットワーク切断の間に発行されたメッセージは、キューに保持されない。復旧時にも再取得ができない。そのため、コンシューマー側を冗長構成にしておき、ステータス管理テーブルなどを用いた排他制御を行い重複排除する必要がある。

| 比較観点         | SQS                       | PostgreSQL                                        | Redis                                             |
| :--------------- | :------------------------ | :------------------------------------------------ | :------------------------------------------------ |
| 説明             | ガイドライン推奨の方式    | PostgreSQLのNOTIFY/LISTENを用いる方式             | RedisのPUBLISH/SUBSCRIBEを用いる方式              |
| 配信保証         | ✅️At-Least-Once (最低1回) | ⚠️At-Most-Once (最大1回)                          | ⚠️At-Most-Once (最大1回)                          |
| メッセージ永続性 | ✅ あり (最大14日間)      | ❌ なし。コンシューマー停止時メッセージ欠損の懸念 | ❌ なし。コンシューマー停止時メッセージ欠損の懸念 |

推奨は以下の通り。

- 業務ロジックの非同期実行は「確実に処理される」必要があり、この実行基盤に PostgreSQL NOTIFY/LISTEN および Redis PUBLISH/SUBSCRIBE は使用しない
  - 特にRedisは通常、コストが高くこれに依存するメリットは小さいため
  - PostgreSQLのPub/Subについて、Amazon RDSにおいてリードレプリカで利用できない制約があるなど、拡張性での懸念もある
- ただし、PostgreSQL Pub/Subを用いた実行フレームワークやサービスなど、内部で用いておりそれらの品質が保証されている場合はその限りではない。非推奨というのは、直接これらの機能をSQSの代わりに利用することを指している

> [!TIP]
> **Redis Streams**
>
> RedisにはPUBLISH/SUBSCRIBE（揮発性）とは別に、Streamsという永続的な（Kafkaに似た）データ構造が存在する。これを利用すれば永続的なキューも可能である。
>
> - [Redis Streams | Docs](https://redis.io/docs/latest/develop/data-types/streams/)
