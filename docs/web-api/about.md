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
- response-body.md の日付フォーマットで、例の `order_date` を暦日の `full-date` (`2023-09-30`) にし、瞬間は UTC (`Z`) のミリ秒3桁、暦日は `full-date` で返す推奨を足した。原文は暦日を UTC の 0 時の日時 (`2023-09-30T00:00:00Z`) で返していて、UTC より西のタイムゾーンで前日に見える。RFC 3339 (`date-time` と `full-date`)、ADR 0043。
- idempotency-and-patch.md の JSON Merge Patch の RFC 番号を、7386 から 7396 にした。RFC 7396 (7386 を obsolete)。
- idempotency-and-patch.md の Idempotency-Key の IETF Draft のバージョンを、05 (2024年12月) から 08 (2026年10月) にした。IETF Datatracker (draft-ietf-httpapi-idempotency-key-header-08)。
- idempotency-and-patch.md の Idempotency-Key のユニーク制約を、キーのカラムだけから `(tenant_id, user_id, Idempotency-Key)` の組にした。ADR 0011 が一意キーに `tenant_id` を求め、キーのカラムだけだと別のテナントの同じキーで行は RLS で見えないのに挿入だけが拒まれる。PostgreSQL 63.5 Index Uniqueness Checks、ADR 0011、ADR 0040。
- idempotency-and-patch.md に、このリポジトリでの決まりを足した。POST と PATCH のすべてで必須でヘッダーがなければ 400（原文は「指定された場合」）、ヘッダーの値は引用符で囲んだ String の UUID、保存先はモジュールごとのスキーマの専用の表、ペイロードのハッシュは HTTPメソッド・パス・クエリ文字列・ボディのバイト列の SHA-256、処理中の重複は 5 秒まで待って 409 と `Retry-After`、保存期間は 24 時間、保存するのは 2xx だけで再試行には保存した応答をそのまま返す。ペイロードが違うときの 400 と、POST と PATCH のすべてへの適用は原文のまま（IETF Draft 08 は 422 だが、このリポジトリは 400 を残した）。IETF Draft 08 の 2.1、2.7、ADR 0040。
- status-codes.md の HTTP ステータスコードの出典を、RFC 7231 から RFC 9110 (Section 15) にした。RFC 9110 (7231 を obsolete)。
- http-methods.md の HTTP メソッドの出典を RFC 7231 から RFC 9110 (Section 9) に、リクエストライン長 (8000 オクテット) の出典を RFC 7230 から RFC 9112 (Section 3) にした。RFC 9110・RFC 9112 (7231・7230 の該当部分を obsolete)。
- security.md の Strict-Transport-Security の推奨値で閉じ忘れていたバッククォートを足した (`max-age=63072000; includeSubDomains`)。値は変えていない。
- security.md の Cookie の `SameSite` を、`Lax` を既定にする推奨から、BFF の Cookie のセッションでは `Strict` を勧める推奨に変えた。RFC 10017 6.1.3.2 (BFF の Cookie は `SameSite=Strict`)、NIST SP 800-63B-4 (`Lax` か `Strict`)。
- security.md の Cookie の推奨に、`__Host-Http-` を使える環境では `__Host-` の代わりに使うこと (RFC 10017 6.1.3.2、SHOULD) と、CSRF 対策の実装 (MUST。独自ヘッダーでプリフライトを必須にする CORS、anti-forgery Cookie、同一オリジン。RFC 10017 6.1.3.3)、`SameSite` だけでは同じサイトの別のサブドメインからの攻撃を防げないこと (6.1.3.3.1) を足し、参考に RFC 10017 を足した。
- authentication-and-authorization.md の推奨 (2) に、Web Functions の OAC が `Authorization` ヘッダーを署名に使うため Bearer と両立しない理由を足し、JWT のアクセストークンは JWKS で手元で検証できる旨の注記を足した。RFC 9068、RFC 8725。
- authentication-and-authorization.md の（1）ベアラートークン方式の処理性能を、❌ から ⚠ にし、不透明なトークンはイントロスペクションが要り、JWT のアクセストークンは JWKS で手元で検証できる旨に直した。図 1 のイントロスペクションに「不透明なトークンの場合」と添えた。推奨 (2) に、業務アプリでは BFF が strongly recommended で、ブラウザがトークンを持つ形は not recommended である旨を足した。RFC 10017 6.1、6.3.4.3。
- security.md の CORS に、このリポジトリが同一オリジン構成を採り CORS の middleware を入れないこと、ローカル開発は Vite の proxy で同一オリジンに見せることを注記として足した。推奨の中身は変えていない。ADR 0013、ADR 0022。
- response-body.md のエラーの節を ADR 0035 に合わせた。例の `Content-Language: ja` を外し (`title` は英語で固定)、`type` の例を `/types/123` から `/problems/validation` にして、命名の規則 (`about:blank`、`/problems/<kebab>`、`/problems/<module>/<kebab-tag>`) と、`status` と `trace_id` の項目を足した。`errors` の項目を `detail` と `pointer` から `pointer`、zod の issue の `code`、差し込みの値にした (文面は web が出す)。「エラー詳細」の内部 API なら詳細を許容する表に、このリポジトリでは 5xx で内部の情報を出さない注記を足した。RFC 9457 3.1.1 (`type` を主な識別子にする)、ADR 0035。
- status-codes.md の 405 に、このリポジトリでは返さず Hono の既定の 404 のままにする注記を足した。Hono に組み込みの 405 がなく、web は `hc` の型でメソッドの誤りを止める。ADR 0035。
- status-codes.md の 403 と 409 の行に、このリポジトリでの使い方を足した。403 は見えるが許されない操作、409 は楽観排他の衝突に加えて状態の不一致（承認待ちでない審査を承認するなど。見えない場合は 404）。RFC 9110 15.5.10、OWASP API Security Top 10 2023 API1、ADR 0045。
- authentication-and-authorization.md に、このリポジトリでは Better Auth の `/api/auth/*` だけが Problem Details の例外で、自前の middleware は Problem Details を返す注記を足した。ADR 0022、ADR 0035。

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
