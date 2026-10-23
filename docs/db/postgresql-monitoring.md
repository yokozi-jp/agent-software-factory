---
type: Runbook
title: "PostgreSQL の監視"
description: "PostgreSQL のログ監視、メトリクス監視項目、通知方式、スロークエリ追跡、ログイン失敗検知を定める文書。DB の監視を設計するときに読む。"
tags: [db, postgresql, monitoring, aws]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forDB/postgresql_guidelines.html
    title: PostgreSQL設計ガイドライン
    author: フューチャー株式会社
---

# PostgreSQL の監視

ログの深刻度ごとの制御、メトリクス監視項目、通知方式を定める。
スロークエリの追跡とログイン失敗の検知を行う。
出典は [PostgreSQL設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## 監視

システムの中で最も重要な構成要素であるDBを適切な状態に保つには、メトリクスを収集し、障害を予防していち早く検知することが求められる。本章ではPostgreSQL監視のための、対象項目・しきい値・通知レベル・実施手順といった一連の流れを記載する。

### ログ監視

PostgreSQLのサーバーサイドのメッセージを深刻度（下表を参考）ごとに制御できる。

| 深刻度           | 使用方法                                                                 | ログ出力 | 監視対象 |
| :--------------- | :----------------------------------------------------------------------- | :------- | :------- |
| DEBUG1 .. DEBUG5 | 開発者が使用する連続的かつより詳細な情報を提供。                         | ー       | ー       |
| INFO             | VACUUM VERBOSEの出力などの、ユーザーによって暗黙的に要求された情報を提供 | ー       | ー       |
| NOTICE           | 長い識別子の切り詰めに関する注意など、ユーザーの補助になる情報を提供     | ー       | ー       |
| WARNING          | トランザクションブロック外でのCOMMITの様な、ユーザーへの警告を提供       | ー       | ー       |
| ERROR            | 現在のコマンドを中断させる原因となったエラーを報告                       | ✔        | ー       |
| LOG              | チェックポイントの活動の様な、管理者に関心のある情報を報告               | ー       | ー       |
| FATAL            | 現在のセッションを中断させる原因となったエラーを報告                     | ✔        | ー       |
| PANIC            | 全てのDBセッションを中断させる原因となったエラーを報告                   | ✔        | ー       |

サーバーメッセージのログ管理について、推奨は以下の通り。

- ERROR以上をログ出力させる
- サーバーのメッセージログを監視対象としない
  - アプリケーション側でDBアクセスがあれば検知可能であるため
  - もし、メッセージ監視も行う場合は、アプリケーション側との重複検知を考慮して設計に加える

> [!NOTE]
> **参考**
>
> [20.8. エラー報告とログ取得](https://www.postgresql.jp/docs/17/runtime-config-logging.html)

### メトリクス監視項目

推奨する監視項目を下表に示す。監視対象はAmazon Auroraを前提に記載する。

| 分類     | 項目               | 監視対象            | しきい値                                | 備考                                                                                                                                                   |
| :------- | :----------------- | :------------------ | :-------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 性能     | スロークエリ       | pg_stat_statements  | オンライン1分、バッチで10分など区別する | アプリケーション側で遅延チェック / 門限チェックを入れる場合は、機能重複するため除外しても良い                                                          |
| リソース | CPU使用率          | CPUUtilization      | 一定間隔で90％以上が継続した場合        | 発生頻度に応じて調整                                                                                                                                   |
|          | メモリ使用量       | FreeableMemory      | 一定間隔で5％未満が継続した場合         | 同上                                                                                                                                                   |
|          | ストレージ空き容量 | FreeLocalStorage    | 10％未満になった場合                    | インスタンスタイプを上げないと、自動拡張されないため監視対象とする。                                                                                   |
|          | ストレージ容量     | VolumeBytesUsed     | 予算見積もりで用いたデータ容量          | 自動拡張されるがコスト要因となるため、見積もりから大きく上振れしていないか監視する。保守運用者が大きなテーブルのコピーを取っているなどを早めに検知する |
|          | コネクション数     | DatabaseConnections | max_connections \* 0.95 などの値        |                                                                                                                                                        |
|          | コネクション滞留   | pg_stat_activity    | 3分など                                 | 定期ポーリングして、メンテナンスユーザーのコネクションが残り続けてないかチェックする。自動でコネクションをKillするかどうかは運用計画と合わせて検討する |

pg_stat_activity を利用したコネクション滞留は、下記のようなクエリで検知できる。

```sql
SELECT pid,
       usename,
       application_name,
       client_addr,
       state,
       backend_start,
       now() - backend_start AS connection_duration
FROM pg_stat_activity
WHERE usename LIKE 'foo_ope_%' -- メンテナンスユーザー名に絞り込み
  AND now() - backend_start > interval '3 minutes';
```

> [!NOTE]
> **参考**
>
> - [Auroraの監視項目](https://dev.classmethod.jp/articles/amazon-aurora-monitoring/)
> - [データベースシステムの監視 ～監視の概要～｜PostgreSQLインサイド : 富士通](https://www.fujitsu.com/jp/products/software/resources/feature-stories/postgres/article-index/monitoring-overview/)
> - [AWS RDSを監視するための重要なメトリクス Top 5 – Sysdig](https://sysdig.jp/blog/top-5-key-metrics-for-monitoring-aws-rds/)
> - [Amazon Aurora の Amazon CloudWatch メトリクス](https://docs.aws.amazon.com/ja_jp/AmazonRDS/latest/AuroraUserGuide/Aurora.AuroraMonitoring.Metrics.html)

なお、DBの死活監視は、アプリケーション側でDeep Health Checkなどの外形監視が行われている想定とし、DB単体のサービス監視は実施しない。

上記メトリクス監視をスキップして良いケースもある。

- スロークエリやCPU / メモリ使用率など性能目的の監視は、バッチ主体のシステムで「門限チェック」により代替可能であればスキップしても良い
- 自動拡張可能な「ストレージ容量」は、別途Billingのコスト監視をしている場合は外しても良い
- 「コネクション数」はバッチやWeb APIの性能監視やアプリケーション側のエラーログで確認が取れている場合は、スキップしても良い

> [!TIP]
> **Aurora Serverless v2の監視について**
>
> [Aurora Serverless v2の監視項目](https://dev.classmethod.jp/articles/monitor-amazon-aurora-serverless-v2-metrics/) を参考にすること。

### 通知方式（AWS）

CloudWatch Metricsの場合は、CloudWatchアラームを設定することで必要な通知や課題管理システムへの起票を行う。コネクション滞留チェックのように `pg_stat_activity` を参照する場合は、通常のアプリケーションと同様にWARN/ERRORレベルでログを出力し、ログ監視側で通知や起票を行うと、監視周りの処理ルートが統一されるためお勧めである。

通知後のアクションや終了条件は、設定と同時に決める。それにより通知はされたがアクションがなされないといった監視運用の形骸化を防ぐ。

| 項目               | 主な発生理由                                                     | アクション例                                                                                                                                      |
| :----------------- | :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| CPU使用率          | 特定のクエリにより処理がスパイクし、他のアプリケーションに悪影響 | ・どの機能やクエリが問題を起こしたか確認し、対策を取る ・翌営業日に再現しなければクローズ                                                         |
| ストレージ空き容量 | 10％未満になった場合                                             | ・ログ改廃などの設定を確認 ・正常な場合はインスタンスタイプを上げる ・コスト影響があるので利害関係者に共有する ・翌営業日に再現しなければクローズ |

### スロークエリの追跡

監視とは別にスロークエリをトレース可能にしておくことで、運用性が向上する。

例えば、以下のようなケースがある。

- あるジョブが想定時間通りに終わらなかったが、ジョブ中で複数のクエリが実行されており、各々はスロークエリとして検知されなかった
- アプリケーション側で処理遅延を検知したので、原因分析にSQLの状態を確認したい

推奨は以下の通り。

- スロークエリをトレース可能にする。以下の設定を `postgresql.conf`（Amazon RDSの場合はパラメータグループ）に設定する

|                               | 設定例 | 備考                                           |
| :---------------------------- | :----- | :--------------------------------------------- |
| log_min_duration_statement    | 300000 | 5分以上のクエリをログに出す                    |
| auto_explain.log_min_duration | 300000 | 5分以上のクエリの実行計画を出す                |
| auto_explain.log_format       | text   | text形式で出す。その他はjson/xmlなどを指定可能 |

なお、「拡張機能」で紹介した `pg_stat_statements` を活用すれば、クエリ分析も合わせて実施できる。

> [!NOTE]
> **参考**
>
> - [20.8. エラー報告とログ取得](https://www.postgresql.jp/docs/17/runtime-config-logging.html#GUC-LOG-MIN-DURATION-STATEMENT)
> - [Amazon Aurora PostgreSQL のパラメータ](https://docs.aws.amazon.com/ja_jp/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.Reference.ParameterGroups.html)
> - [RDS PostgreSQL での SQL 統計 - Amazon Relational Database Service](https://docs.aws.amazon.com/ja_jp/AmazonRDS/latest/UserGuide/USER_PerfInsights.UsingDashboard.AnalyzeDBLoad.AdditionalMetrics.PostgreSQL.html)

### ログイン失敗の検知（AWS）

ログインにN回失敗したら通知を出すなどの仕組みは、RDSとCloudWatch Logsのフィルター / アラームの組み合わせで実現できる。厳密な回数に意味はなく普段と異なったアクティビティを検知する目的であれば、GuardDuty RDS Protectionでの代用も考えられる。

> [!NOTE]
> **参考**
>
> - [Amazon RDS for PostgreSQL DB インスタンスへのログインに失敗したことを追跡する方法を教えてください。](https://repost.aws/ja/knowledge-center/track-failed-login-rds-postgresql)
> - [Amazon GuardDuty RDS Protection の具体的な検出タイプを調査しました | DevelopersIO](https://dev.classmethod.jp/articles/guardduty-rds-protection-finding-types/)
