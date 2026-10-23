---
type: Convention
title: "ログの費用"
description: "ログ基盤の費用を抑えるための出力量、構造化、保持期間の方針を定める規約。ログの保持期間を決めるとき、ログ基盤の費用を見直すときに読む。"
tags: [logging, convention, cost, cloudwatch]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forLog/log_guidelines.html
    title: ログ設計ガイドライン
    author: フューチャー株式会社
---

# ログの費用

無駄なログを発生源で減らし、最初から JSON Lines で出し、保持期間を環境ごとに決める。
アーカイブストレージへの移動は原則しない。
出典は [ログ設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

CloudWatch Logsやその他のマネージドログサービス（Datadogなど）は、ログデータ量（GB）に応じた課金であり、保持期間に応じたストレージ費用も必要となる。ログ検索時は、クエリのスキャンに応じて課金するサービスが多い。

- 推奨
  - 発生源でログができる限り絞る
    - ログレベルは適切に設定し、用途が不明なログは出力しない
    - 巨大なペイロードはログ出力しない（例えば、Base64化したバイナリデータなど）
    - ログを削ることが目的ではなく、無駄なログを削る。障害発生時、調査に必要なログが欠落してしまえば本末転倒であるため
  - 最初から構造化ロギングにする
    - ログ基盤側でのパース処理は高コストであるため、アプリケーション上からJSON Linesで出力する
  - 保持期間ポリシーを明確にする
    - ビジネス要件やコンプライアンス要件に基づき、保持期間を定める（例: アプリケーションログは30日など）
    - 環境別に定義する。例えば、開発環境は1週間など、短くすることも有効
  - ストレージ階層化
    - データのライフサイクル管理機能は原則不要とする
    - 例: AWSでは一定期間（例: 14日）を過ぎたログは、安価なアーカイブストレージ（Amazon S3 Glacierなど）へ自動的に移動させるなども可能だが、コストメリットがそこまで大きくない

> [!NOTE]
> **参考**
>
> - [CloudWatch Logs と S3 にかかる料金比較 | DevelopersIO](https://dev.classmethod.jp/articles/comparison-of-fees-for-cloudwatch-logs-and-s3/)
>   - CloudWatch Logs \-\> S3 に移動させても、そこまで大きなコスト圧縮にはならないと考えられる
> - [Amazon CloudWatch Logs の Amazon S3 へのエクスポート方式の検討 – TechHarmony](https://blog.usize-tech.com/export-cloudwatch-logs-to-s3/)
>   - S3へのエクスポート設定もいくつかの設計が必要である
