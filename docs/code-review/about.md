---
type: Reference
title: コードレビューガイドラインの出典と適用範囲
description: docs/code-review/ の出典 (フューチャー株式会社のコードレビューガイドライン、CC BY 4.0)、変更点、適用範囲、免責事項。docs/code-review/ の規約がどこまで適用されるかを確かめるとき、出典やライセンスを確かめるときに読む。
tags: [code-review, reference, license, source]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forCodeReview/
    title: コードレビューガイドライン
    author: フューチャー株式会社
---

# コードレビューガイドラインの出典と適用範囲

`docs/code-review/` の文書は、フューチャー株式会社の [コードレビューガイドライン](https://future-architect.github.io/arch-guidelines/documents/forCodeReview/) を元にしている。
対象は GitHub や GitLab などのサービスを利用した、コーディングについてのレビューである。

## 出典とライセンス

- 原文: [コードレビューガイドライン](https://future-architect.github.io/arch-guidelines/documents/forCodeReview/code_review.html) (フューチャー株式会社、[future-architect/arch-guidelines](https://github.com/future-architect/arch-guidelines))
- ライセンス: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)
- 作成者: 真野隼記、村田靖拓、山本竜玄、清水雄一郎、水田祐介
- レビュアー: 谷村元気、栗田真、後藤玲雄、八木雅斗、辻大志郎

### 原文からの変更点

- 1つの文書を、責務ごとに複数の文書に分けた。
- 各文書に OKF の frontmatter と、冒頭の要約を足した。
- VitePress の記法 (`<page-title/>`、`::: tip` などのコンテナ、見出しの `{#id}`) を、GitHub の Markdown の記法 (`> [!TIP]` など) に置き換えた。
- 原文の章へのリンクを、分割後の文書へのリンクにした。このリポジトリに取り込んだ他のガイドラインへのリンクは、その docs/ の文書へのリンクにした。取り込んでいないガイドライン (AWS、Terraform、データマネジメント、Git ブランチフロー) へのリンクは、原文のサイトの URL にした。
- 初マージを祝う Slack の画面キャプチャは、何が写っているかを説明する文章に置き換えた。
- 前提条件の表 (`prerequisites.md`) の JS の例 (ESLint、prettier) を、このリポジトリで使う `vp lint` と `vp fmt --check` に書き換えた。
- 原文が前提にしていた Git ブランチフローのガイドライン (Lite GitLab Flow と GitLab Flow、取り込んでいない) を、このリポジトリのトランクベース開発 (ADR 0010) に書き換えた。前提条件 (`prerequisites.md`) のブランチ戦略と GitHub の設定の表、マージの担当 (`reviewee-review-request.md`) の参照先が対象。
- レビュアーの姿勢と進め方 (`reviewer-mindset.md`) の「hotfix の場合はマージ先のブランチを確認する」節 (develop/hotfix ブランチ前提) を、このリポジトリのトランクベース開発 (ADR 0010) に合わないため削除した。ADR 0010。
- レビュアーの姿勢と進め方 (`reviewer-mindset.md`) の「暗黙知を形式知にする」に、このリポジトリの形式知の落とし先として `docs/`、`AGENTS.md`、`.kiro/skills/` 配下のスキルを含める旨を足した。リポジトリの構成。
- 原文にない文書として、coding agent が書いたプルリクエストのレビュー (`agent-pull-requests.md`) を足した。GitHub の Review AI-generated code の確認点を、ゲート、agent のレビュー、人の判断に振り分けている。あわせて、ローカルでの動作確認 (`reviewer-judgment.md`)、プルリクエストの単位 (`reviewee-pull-request.md`)、マージの担当 (`reviewee-review-request.md`)、GitHub の設定の表 (`prerequisites.md`) から、この文書を参照するようにした。その「ゲートで止めるもの」の表は、ほかの docs の一覧とずれていたので、保証カタログ (`docs/tooling/assurance-catalog.md`) へのリンクに替えた。#139。
- GitHub の設定の表 (`prerequisites.md`) の CODEOWNERS の行に、このリポジトリの設定 (全てのファイルの所有者を `@yokozi-jp` にし、承認は必須にしない) と、その手順 (`docs/repository/github-settings.md`) への参照を足した。#52。

## 位置づけ

原文の「はじめに」「適用範囲」「定義」を、規約の前提として原文のまま残す。

### はじめに

[プログラマが知るべき97のこと](https://xn--97-273ae6a4irb6e2hsoiozc2g4b8082p.com/) の14個目に「コードレビュー」について記述がある。コードレビューの目的は「コードの質を上げ、欠陥を減らすため」だけではなく、「チーム全員に同じ知識を共有させること、またコーディングにおいて全員が守るべきガイドラインを確立すること」が大切だとある。そして「 レビューを楽しいものにすること」がおそらく最も有効だとある。

コードレビューを楽しい場にするためにも、レビュアー / レビュイー が同じ方向性を向くことが重要である。同時に、人によってコメントなどの表現が揺れ、それにより認識齟齬があると楽しむ以前の問題であるため、守るべきルールも存在するはずである。このガイドラインは推奨する行動と、守るべきルールの両方を定義し、コードレビューをより有意義で学びが多く、生産性と品質を高める場とすることを目指す。

> [!NOTE]
> 参考
>
> [コードレビューとは | GitLab](https://about.gitlab.com/ja-jp/topics/version-control/what-is-code-review/) にも似た旨の記載がある

### 適用範囲

GitHubやGitLabなどのサービスを利用した、コーディングについてのレビューのみを対象とする。

プロジェクト計画によっては、開発プロセスを複数の「フェーズ」に分割し、各フェーズの終了時点で「フェーズレビュー」を挟むようなケースも考えられるが、それらは対象外とする。

### 定義

| 用語           | 説明                                                                                     |
| :------------- | :--------------------------------------------------------------------------------------- |
| レビュアー     | レビューを行う側の担当者                                                                 |
| レビュイー     | レビューを依頼する側の担当者。プルリクエストを起票する開発者でもある                     |
| プルリクエスト | GitLabではマージリクエストともいうが、本ガイドラインではプルリクエストに統一して呼称する |

## 免責事項

原文の免責事項を引用する。

> [!WARNING]
>
> - 有志で作成したドキュメントである。フューチャーには多様なプロジェクトが存在し、それぞれの状況に合わせて工夫された開発プロセスや高度な開発支援環境が存在する。本ガイドラインはフューチャーの全ての部署 / プロジェクトで適用されているわけではなく、有志が観点を持ち寄って新たに整理したものである
> - 相容れない部分があればその領域を書き換えて利用することを想定している。プロジェクト固有の背景や要件への配慮は、ガイドライン利用者が最終的に判断すること。本ガイドラインに必ず従うことは求めておらず、設計案の提示と、それらの評価観点を利用者に提供することを主目的としている
> - 掲載内容および利用に際して発生した問題、それに伴う損害については、フューチャー株式会社は一切の責務を負わないものとする。掲載している情報は予告なく変更する場合がある
