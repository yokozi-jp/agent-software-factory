---
type: Convention
title: "Web API のレスポンスヘッダー"
description: "Content-Type、Server-Timing、Cache-Control などのレスポンスヘッダーを定める規約。レスポンスヘッダーやキャッシュ制御を設計するときに読む。"
tags: [web-api, convention, response-header, cache]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forWebAPI/web_api_guidelines.html
    title: Web API設計ガイドライン
    author: フューチャー株式会社
---

# Web API のレスポンスヘッダー

Content-Type は必ず設定し、JSON のエンコード指定 (charset) は付けない。
業務システムでは原則 `Cache-Control: no-store` でキャッシュを禁止する。
出典は [Web API設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## レスポンスヘッダー

### Content-Type

推奨は以下の通り。

- 必ずContent-Typeを設定する
- 適切なメディアタイプを使用する（Web APIでは、`text/plain` より、`application/json` がより適切な場合が多い）。エラーの場合は `application/problem+json` が推奨である
- エンコーディングの指定は不要（RFC 8259から、JSONのエンコードはUTF-8のみであるため）
  - 不要な例: `Content-Type: application/json; charset=utf-8`

> [!NOTE]
> **参考**
>
> - [RFC 8259: The JavaScript Object Notation (JSON) Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259.html)
> - [Spring Boot 2.2 から Content-Type: application/json に charset=UTF-8 が付かない \#Java \- Qiita](https://qiita.com/niwasawa/items/030f0497446918a53324)
> - [徳丸浩の日記: ISO-2022-JPの自動判定によるクロスサイト&\#12539;スクリプティング(XSS)](https://blog.tokumaru.org/2024/12/iso-2022-jp-xss.html.html?m=1)

### Server-Timing

Server-Timingヘッダーは、サーバー側での各領域の処理時間をクライアントに提供する仕組みである。

cache取り出しに23.4ミリ秒、dbクエリに50ミリ秒、appロジックに75.3ミリ秒かかったことを示す例を挙げる。

```sh
Server-Timing: cache;desc="Cache Read";dur=23.4, db;dur=50, app;dur=75.3
```

推奨は以下の通り。

- チューニングが必要なAPIに絞って、Server-Timingヘッダーを使用する（予め全APIに組み込むのは費用対効果が悪い）
- 測定項目は最小限かつ意味のあるものにする。例えば、DBアクセスが複数であればdb1, db2など分けても良い
- メトリクス項目は具体的な技術要素名を出さない（例えば、RedisやPostgreSQLなど）
- 外形監視の一種として利便性が高いが、本番環境に出すかは個別検討とする（チームによっては、開発環境 / ステージング環境のみ出力するといったルールも考えられる。各自のセキュリティ方針に従う）

> [!NOTE]
> **参考**
>
> - [Server-Timing](https://developer.mozilla.org/ja/docs/Web/HTTP/Headers/Server-Timing)
> - [Server-Timing ヘッダの情報をフロントエンド解析に使う](https://zenn.dev/mizchi/articles/server-timing-header-for-frontend)

### Cache-Control

[Cache-Control](https://developer.mozilla.org/ja/docs/Web/HTTP/Headers/Cache-Control) を用いると、ブラウザやCDNやプロキシなどに対してキャッシュ制御の指示を出せる。

推奨は以下の通り。

- 基本方針としてはレスポンスヘッダーに `Cache-Control: no-store` を追加し、キャッシュを禁止する
  - 業務システムでは通常、権限設定がなされている。キャッシュにより機密情報が不用意に参照できてしまうことを防ぎたいため
  - CDNに対してキャッシュ不可にするには、`private`以上が必要。業務システムは複数のユーザーが端末を共有するケースもゼロではないため、ブラウザ側もキャッシュ不可になるように `no-store` とする
- 区分値取得APIなど、キャッシュ可能なものは個別判断でキャッシュを有効にする
  - 後続のコンピューティングリソースを稼働させないことでクラウド費用を下げられるため、共有可能な情報であればキャッシュを有効にすることが望ましい

> [!NOTE]
> **フロントエンドに置けるキャッシュ設計**
>
> [Webフロントエンド設計ガイドライン > キャッシュ](https://future-architect.github.io/arch-guidelines/documents/forWebFrontend/web_frontend_guidelines.html#%E3%82%AD%E3%83%A3%E3%83%83%E3%82%B7%E3%83%A5) 章にて全体の考え方が記載されている。

### その他のレスポンスヘッダー

セキュリティ関連で使用すべきレスポンスヘッダーが存在する。[セキュリティ](security.md#セキュリティ) の章を参照。
