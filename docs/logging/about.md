---
type: Reference
title: ログ設計ガイドラインの出典と適用範囲
description: docs/logging/ の出典 (フューチャー株式会社のログ設計ガイドライン、CC BY 4.0)、変更点、適用範囲、免責事項。docs/logging/ の規約がどこまで適用されるかを確かめるとき、出典やライセンスを確かめるときに読む。
tags: [logging, reference, license, source]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forLog/
    title: ログ設計ガイドライン
    author: フューチャー株式会社
---

# ログ設計ガイドラインの出典と適用範囲

`docs/logging/` の文書は、フューチャー株式会社の [ログ設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forLog/) を元にしている。
対象はアプリケーションが出力するログで、クラウドの利用と標準出力への出力を前提にする。

## 出典とライセンス

- 原文: [ログ設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forLog/log_guidelines.html) (フューチャー株式会社、[future-architect/arch-guidelines](https://github.com/future-architect/arch-guidelines))
- ライセンス: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)
- 作成者: 真野隼記、八木雅斗、宮崎将太、武田大輝、澁川喜規

### 原文からの変更点

- 1つの文書を、責務ごとに複数の文書に分けた。
- 各文書に OKF の frontmatter と、冒頭の要約を足した。
- VitePress の記法 (`<page-title/>`、`::: tip` などのコンテナ、見出しの `{#id}`) を、GitHub の Markdown の記法 (`> [!TIP]` など) に置き換えた。
- 原文の章へのリンクを、分割後の文書へのリンクにした。このリポジトリに取り込んだ他のガイドラインへのリンクは、その docs/ の文書へのリンクにした。取り込んでいないガイドライン (AWS、Terraform、データマネジメント、Git ブランチフロー) へのリンクは、原文のサイトの URL にした。
- フロントエンドのログ出力 (`frontend.md`) の「ESLint や Biome のルールで console の使用は警告される」を、このリポジトリの設定 (`apps/web/src` で Oxlint の `no-console` を error) に書き換え、参考のリンクを Oxlint のルールにした。
- keys.md の `http.server.request.duration` の単位を、ナノ秒から秒 (例を `0.125`) にした。OpenTelemetry Semantic Conventions (HTTP メトリクス、単位は `s`)。
- keys.md の DB 拡張スキーマのキーを、`db.system`→`db.system.name`、`db.statement`→`db.query.text`、`db.operation`→`db.operation.name` にした。OpenTelemetry Semantic Conventions レジストリ (いずれも非推奨で置き換え先が指定されている)。
- keys.md の `db.duration` (OTel に存在しない属性) を、メトリクス `db.client.operation.duration` (単位は秒、例を `0.015`) にした。OpenTelemetry Semantic Conventions (データベースメトリクス、単位は `s`)。
- web-api.md の処理時間の単位を、ミリ秒推奨から秒推奨にした。OpenTelemetry Semantic Conventions (HTTP メトリクス、単位は `s`)。
- web-api.md、keys.md、messages.md、startup.md のタイムスタンプを、UTC か JST の許容と JST の例 (`+09:00`)、ナノ秒の例から、UTC (`Z`) のミリ秒3桁だけにした。環境によって `Z` と `+09:00` が混ざると、並べて読むときに比べ間違える。OpenTelemetry のログのデータモデルの `Timestamp` も、UNIX エポックからの値でタイムゾーンを持たない。OpenTelemetry Logs Data Model、ADR 0043。
- keys.md と messages.md の例外属性キーを、`exception.stack_trace` から `exception.stacktrace` にした。OpenTelemetry Semantic Conventions レジストリ (exception 属性、Stable)。
- フロントエンドのログ出力 (`frontend.md`) に「Web Vitals の送信はログではない。`console` は引き続き禁止する」の 1 行を足した。Web Vitals はブラウザのパフォーマンス指標で、ログではないため ([ADR 0048](../adr/0048-opentelemetry-traces-only-with-explicit-instrumentation.md))。

## 適用範囲と前提条件

- **対象スコープ**
  - アプリケーションが出力するログ（アプリログ）が対象
  - AWS CloudTrailやVPCフローログといった、クラウドサービスやインフラストラクチャ側で出力されるログは対象外
  - 主にバックエンド領域のログを扱う。フロントエンドのログについても一部言及するが、本ガイドラインの主眼にしない
- **前提条件**
  - **実行環境**: クラウド利用を前提とする。オンプレミス環境で必要となるファイルベースのログローテーションは考慮しない
  - **出力方式**: ログはファイルではなく、標準出力を基本とする

## 免責事項

原文の免責事項を引用する。

> [!WARNING]
>
> - 有志で作成したドキュメントである。フューチャーには多様なプロジェクトが存在し、それぞれの状況に合わせて工夫された開発プロセスや高度な開発支援環境が存在する。本ガイドラインはフューチャーの全ての部署 / プロジェクトで適用されているわけではなく、有志が観点を持ち寄って新たに整理したものである
> - 相容れない部分があればその領域を書き換えて利用することを想定している。プロジェクト固有の背景や要件への配慮は、ガイドライン利用者が最終的に判断すること。本ガイドラインに必ず従うことは求めておらず、設計案の提示と、それらの評価観点を利用者に提供することを主目的としている
> - 掲載内容および利用に際して発生した問題、それに伴う損害については、フューチャー株式会社は一切の責務を負わないものとする。掲載している情報は予告なく変更する場合がある
