---
type: Reference
title: Webフロントエンド設計ガイドラインの出典と適用範囲
description: docs/web-frontend/ の出典 (フューチャー株式会社の Web フロントエンド設計ガイドライン、CC BY 4.0)、変更点、適用範囲、免責事項。docs/web-frontend/ の規約がどこまで適用されるかを確かめるとき、出典やライセンスを確かめるときに読む。
tags: [web-frontend, reference, license, source]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forWebFrontend/
    title: Webフロントエンド設計ガイドライン
    author: フューチャー株式会社
---

# Webフロントエンド設計ガイドラインの出典と適用範囲

`docs/web-frontend/` の文書は、フューチャー株式会社の [Webフロントエンド設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forWebFrontend/) を元にしている。
ブラウザ上で動作する Web フロントエンドを対象に、設計における考慮点・設計パターン・推奨手法を示す。

## 出典とライセンス

- 原文: [Webフロントエンド設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forWebFrontend/web_frontend_guidelines.html) (フューチャー株式会社、[future-architect/arch-guidelines](https://github.com/future-architect/arch-guidelines))
- ライセンス: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)
- 作成者: 武田大輝、小杉山護、長谷川寛人、小澤泰河、中村立基、山本竜玄、宮崎将太、村田靖拓、澁川喜規、真野隼記

### 原文からの変更点

- 1つの文書を、責務ごとに複数の文書に分けた。
- 各文書に OKF の frontmatter と、冒頭の要約を足した。
- VitePress の記法 (`<page-title/>`、`::: tip` などのコンテナ、見出しの `{#id}`) を、GitHub の Markdown の記法 (`> [!TIP]` など) に置き換えた。
- 原文の章へのリンクを、分割後の文書へのリンクにした。このリポジトリに取り込んだ他のガイドラインへのリンクは、その docs/ の文書へのリンクにした。取り込んでいないガイドライン (AWS、Terraform、データマネジメント、Git ブランチフロー) へのリンクは、原文のサイトの URL にした。
- 原文の図を mermaid の図に、画面のキャプチャやツールのスクリーンショットを文章の説明に置き換えた (画像はコピーしていない)。
- 静的解析の例 (`static-analysis.md`) の ESLint、Biome、Prettier、lint-staged を、このリポジトリで使う Vite+ (`vp check`、`vp lint`、`vp fmt`) と lefthook に書き換えた。
- 静的解析 (`static-analysis.md`) に、このリポジトリで XSS の入口になる書き方を Oxlint の自作 plugin で禁止する節を足した (原文にはない)。
- validation-message.md のエラーメッセージの記述に、`aria-errormessage` は `aria-invalid="true"` とともに設定しないと支援技術に露出しない旨を足した。MDN aria-errormessage。
- image.md の画像形式の表で、AVIF のブラウザ対応を ⚠️ から対応済みの印 (✅️) に変え、PNG のアニメーションは APNG である旨を注記した。MDN Image file type and format guide。
- dark-mode.md の状態の保持の表で、Cookie の有効期限「最大で約68年」を、Chrome M104 以降は最大400日である旨に直し、一次情報を参考に足した。Chrome for Developers「Cookie Expires and Max-Age attributes now have upper limit」。
- auth.md の方式1 (フロントエンドだけ) に、業務アプリには勧めない旨の警告を、方式2 に、BFF として strongly recommended で、このリポジトリが採る旨の注記を足した。RFC 10017 6.1、6.3.4.3。
- favicon.md の形式比較の表で、SVG のブラウザ対応を Safari 26 以降で対応済みに直した。WebKit Blog「WebKit Features in Safari 26.0」。
- static-analysis.md に、このリポジトリの節として「React と JSX のアクセシビリティの検査」を足した (`apps/web/src` で Oxlint の `react` と `jsx-a11y` の plugin を有効にしたこと、見つけられる範囲と見つけられない範囲)。#239。

## 位置づけ

本ガイドラインは、Webフロントエンド設計における考慮点・設計パターン・推奨手法を提示し、開発チームが設計方針を決めるための土台を提供する。昨今の Web フロントエンド領域は、React、Vue.js などのモダンなフレームワークを活用した大規模かつ動的な Web アプリケーションの構築へと変化しており、設計の考慮点も多様化している。セキュリティ、アクセシビリティなどより多面的な品質も求められている。

### 用語

| 用語              | 説明                                                                                                                                                                                                           |
| :---------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| toB               | 企業向けのサービスの意味                                                                                                                                                                                       |
| toC               | 一般消費者向けのサービスの意味                                                                                                                                                                                 |
| Webフロントエンド | ブラウザ上で動作する Web アプリケーションでユーザーが操作する UI 部分のこと                                                                                                                                    |
| 静的ファイル      | ブラウザで表示するために必要な HTML、CSS、JavaScript、画像、動画などのファイル                                                                                                                                 |
| SPA               | Single-page application の略。単一のウェブ文書のみを読み込み、別の内容を表示する際にはフェッチなどの JavaScript API を通じて本文の内容を更新する実装方法                                                       |
| OSS               | オープンソースソフトウェア                                                                                                                                                                                     |
| B/Gデプロイ       | Blue/Green デプロイメントの略。本番環境 (Blue 環境) とは別に新しいバージョン (Green 環境) を構築し、ロードバランサーなどでトラフィックを切り替えることで、ダウンタイムを最小限に抑えてリリースするデプロイ手法 |
| LB                | Load Balancer。トラフィックを複数のサーバーに分散するミドルウェアのこと                                                                                                                                        |
| FaaS              | Function as a Service の略。イベントに応じてコードを実行できるサーバーレスアーキテクチャのこと。AWS Lambda が有名                                                                                              |

## 適用範囲と前提条件

- **対象スコープ**
  - ブラウザ上で動作する Web フロントエンドを対象とする。バックエンド (サーバーサイド) は対象外とする
  - 一般的にフロントエンド領域に含まれることもある CDN (Contents Delivery Network) と BFF (Backend For Frontend) も対象外とする
  - 基本的に **業務アプリケーションの開発** を想定している。キャッシュ戦略の効果が限定的、状態管理や UI 制御が複雑になりやすい、利用デバイスを絞り込みやすい、といった特性を考慮している
- **前提条件**
  - Web フロントエンドの開発者・アーキテクトを対象とする
  - 基本的な Web 技術 (HTML、CSS、JavaScript、HTTP 通信など) や、React、Vue.js などのフレームワークの基礎知識は解説しない
  - ホスティング方式などインフラ構成に関する記述は AWS を前提とする

## 免責事項

原文の免責事項を引用する。

> [!WARNING]
>
> - 有志で作成したドキュメントである。フューチャーには多様なプロジェクトが存在し、それぞれの状況に合わせて工夫された開発プロセスや高度な開発支援環境が存在する。本ガイドラインはフューチャーの全ての部署 / プロジェクトで適用されているわけではなく、有志が観点を持ち寄って新たに整理したものである
> - 相容れない部分があればその領域を書き換えて利用することを想定している。プロジェクト固有の背景や要件への配慮は、ガイドライン利用者が最終的に判断すること。本ガイドラインに必ず従うことは求めておらず、設計案の提示と、それらの評価観点を利用者に提供することを主目的としている
> - 掲載内容および利用に際して発生した問題、それに伴う損害については、フューチャー株式会社は一切の責務を負わないものとする。掲載している情報は予告なく変更する場合がある
