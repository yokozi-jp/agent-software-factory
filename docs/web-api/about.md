---
type: Reference
title: Web API設計ガイドラインの出典と適用範囲
description: docs/web-api/ の出典 (フューチャー株式会社の Web API設計ガイドライン、CC BY 4.0)、変更点、適用範囲、免責事項。docs/web-api/ の規約がどこまで適用されるかを確かめるとき、出典やライセンスを確かめるときに読む。
tags: [web-api, reference, license, source]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forWebAPI/
    title: Web API設計ガイドライン
    author: フューチャー株式会社
---

# Web API設計ガイドラインの出典と適用範囲

`docs/web-api/` の文書は、フューチャー株式会社の [Web API設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forWebAPI/) を元にしている。
対象は RESTライクな Web API のサーバーサイド設計で、AWS などのクラウド環境での構築を前提にする。

## 出典とライセンス

- 原文: [Web API設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forWebAPI/web_api_guidelines.html) (フューチャー株式会社、[future-architect/arch-guidelines](https://github.com/future-architect/arch-guidelines))
- ライセンス: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)
- 作成者: 真野隼記、佐々木伸悟、武田大輝、宮崎将太、澁川喜規、佐藤尭彰
- レビュアー: 辻大志郎、合田飛

### 原文からの変更点

- 1つの文書を、責務ごとに複数の文書に分けた。
- 各文書に OKF の frontmatter と、冒頭の要約を足した。
- VitePress の記法 (`<page-title/>`、`::: tip` などのコンテナ、見出しの `{#id}`) を、GitHub の Markdown の記法 (`> [!TIP]` など) に置き換えた。
- 原文の章へのリンクを、分割後の文書へのリンクにした。このリポジトリに取り込んだ他のガイドラインへのリンクは、その docs/ の文書へのリンクにした。取り込んでいないガイドライン (AWS、Terraform、データマネジメント、Git ブランチフロー) へのリンクは、原文のサイトの URL にした。
- 原文で mermaid.ink の画像として埋め込まれていた図 (楽観ロックや認証のフロー図) は、mermaid のコードブロックに戻した。OpenAPI の廃止予定を示す Swagger UI のスクリーンショットは、何が写っているかの文章に置き換えた。
- versioning.md の `Deprecation` ヘッダーの値を、`true` から構造化フィールドの Date (`@1688169599`) にし、説明と推奨も合わせた。RFC 9745 (The Deprecation HTTP Response Header Field)。
- idempotency-and-patch.md の JSON Merge Patch の RFC 番号を、7386 から 7396 にした。RFC 7396 (7386 を obsolete)。
- idempotency-and-patch.md の Idempotency-Key の IETF Draft のバージョンを、05 (2024年12月) から 08 (2026年10月) にした。IETF Datatracker (draft-ietf-httpapi-idempotency-key-header-08)。
- status-codes.md の HTTP ステータスコードの出典を、RFC 7231 から RFC 9110 (Section 15) にした。RFC 9110 (7231 を obsolete)。
- http-methods.md の HTTP メソッドの出典を RFC 7231 から RFC 9110 (Section 9) に、リクエストライン長 (8000 オクテット) の出典を RFC 7230 から RFC 9112 (Section 3) にした。RFC 9110・RFC 9112 (7231・7230 の該当部分を obsolete)。
- security.md の Strict-Transport-Security の推奨値で閉じ忘れていたバッククォートを足した (`max-age=63072000; includeSubDomains`)。値は変えていない。

## 位置づけ

本ガイドラインは、RESTライクな Web API の主な設計手法をまとめ、システム開発プロジェクトにおける設計のベースラインを提供する。本ガイドラインを用いることで、開発チームは何を設計すべきか、どのような判断を下すべきかについて共通認識を得ることができる。また、設計の属人性を軽減させ、ナレッジやツールの横展開を容易にすることを狙いにしている。

## 適用範囲と前提条件

本ガイドラインの前提は以下の通り。

- gRPC、JSON-RPC、SOAP、GraphQLなど、RPCやグラフ志向ではなく、REST志向のWeb API構築が対象である
- 業務システム向け Web API 提供である（サードパーティ向けに広く開発する Web API ではなく、限られたクライアントやシステムと連携すること。いわゆる、LSUDs（Large Set of Unknown Developers）ではなく、SSKDs（Small Set of Known Developers）が対象である
- AWSなどのクラウド環境で構築される

また、利用者は以下の技術を理解しているとし、本ガイドラインではこれらについて解説はしない。

- 基礎的なHTTPの知識
- 基礎的なRESTの知識

また、本ガイドラインの適用範囲は、Web APIのサーバーサイドの設計についてまとめる。クライアントサイドについては対象外とする。

## 免責事項

原文の免責事項を引用する。

> [!WARNING]
>
> - 有志で作成したドキュメントである。フューチャーには多様なプロジェクトが存在し、それぞれの状況に合わせて工夫された開発プロセスや高度な開発支援環境が存在する。本ガイドラインはフューチャーの全ての部署 / プロジェクトで適用されているわけではなく、有志が観点を持ち寄って新たに整理したものである
> - 相容れない部分があればその領域を書き換えて利用することを想定している。プロジェクト固有の背景や要件への配慮は、ガイドライン利用者が最終的に判断すること。本ガイドラインに必ず従うことは求めておらず、設計案の提示と、それらの評価観点を利用者に提供することを主目的としている
> - 掲載内容および利用に際して発生した問題、それに伴う損害については、フューチャー株式会社は一切の責務を負わないものとする。掲載している情報は予告なく変更する場合がある
