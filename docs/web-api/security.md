---
type: Convention
title: "Web API のセキュリティ"
description: "セキュリティ関連レスポンスヘッダー、CORS、Cookie の設定を定める規約。セキュリティヘッダーや CORS、セッション Cookie を設計するときに読む。"
tags: [web-api, convention, security, cors, cookie]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forWebAPI/web_api_guidelines.html
    title: Web API設計ガイドライン
    author: フューチャー株式会社
---

# Web API のセキュリティ

CSP や HSTS などのセキュリティヘッダーを一律で付け、CORS は同一オリジン構成を優先しワイルドカードを禁止する。
Cookie はセッショントークン方式に限り、`Secure`・`HttpOnly`・`SameSite`・`__Host-` プレフィックスを設定する。`SameSite` は、BFF の構成では `Strict` にする。
出典は [Web API設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## セキュリティ

### レスポンスヘッダー

下表のようなセキュリティ関連のヘッダーが存在する。

Web APIの呼び出し結果をブラウザ上でそのまま表示することは直感的には考えにくいが、何かしらの手段で表示され悪用される可能性はゼロではない。また、安全側に一律倒すことで、セキュリティ適用を簡略化させる意図がある。

| 項目                                                                                                          | 推奨値                                | 必須 | 説明                                                                                                                                                                                                  |
| :------------------------------------------------------------------------------------------------------------ | :------------------------------------ | :--- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Content-Security-Policy](https://developer.mozilla.org/ja/docs/Web/HTTP/CSP)                                 | default-src 'none';                   | ✅️   | CSP。クロスサイトスクリプティング（XSS）の緩和策。どのソースからコンテンツをロードするかを制限する。default-src: ‘none’ で、全リソースの読み込みを不可とする                                          |
| [X-Content-Type-Options](https://developer.mozilla.org/ja/docs/Web/HTTP/Headers/X-Content-Type-Options)       | nosniff                               | ✅️   | ブラウザがMIMEタイプを自動判別することを防ぎ、特定のタイプのファイルのみを扱うようにすることで、コンテンツの解析やインジェクション攻撃を防止する                                                      |
| [Strict-Transport-Security](https://developer.mozilla.org/ja/docs/Web/HTTP/Headers/Strict-Transport-Security) | `max-age=63072000; includeSubDomains` | ✅️   | HSTS。HTTP Strict Transport Securityを有効にし、HTTPSを強制させ、中間者攻撃（MITM）を緩和する。[HSTS preload list](https://hstspreload.org) に記載があるように、最終的には2年間とすることが推奨である |

> [!NOTE]
> **参考**
>
> - [API-Security-Checklist/README-ja.md at master](https://github.com/shieldfy/API-Security-Checklist/blob/master/README-ja.md)
> - [Strict-Transport-Security ヘッダーの max-age は 2 年が推奨](https://til.agile.esm.co.jp/posts/recommended-max-age-for-hsts-headers/)

<!-- 前の注記と分ける -->

> [!TIP]
> **廃止になったオプション**
>
> [X-XSS-Protection](https://developer.mozilla.org/ja/docs/Web/HTTP/Headers/X-XSS-Protection) や [X-Frame-Options](https://developer.mozilla.org/ja/docs/Web/HTTP/Headers/X-Frame-Options) などContent-Security-Policyの登場で非推奨となったヘッダーも多い。

### CORS

CORS（オリジン間リソース共有、Cross-Origin Resource Sharing）は、あるオリジンで動作しているウェブアプリケーションに、異なるオリジンにある選択されたリソースへのアクセス権を与える仕組みである。追加のHTTPヘッダーを使用して、アクセス権を与えるようブラウザに指示する。

同一システム内であっても `app.example.com` `api.example.com` でサブドメインが分かれることもあり、別システム向けにWeb APIを公開しない場合も考慮が必要になりうる。

同一システム内の対応としては、以下の考え方がある。

| 観点         | 1.同一オリジン構成                                                                                                                                                        | 2.複数オリジン構成                                                                                                                          |
| :----------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------ |
| 説明         | 静的リソースとWeb APIを同一オリジンでホストし、CORSがそもそも発生しない構成にする。AWSであればLBやCloudFrontのパスベースルーティングで、S3とWeb APIを振り分ける構成にする | `app.example.com` `api.example.com` の2つのドメインでそれぞれ管理する。システムの独立性を高められるが、管理するドメインが増える可能性もある |
| CORS考慮     | ✅️不要                                                                                                                                                                    | ⚠️考慮が必要                                                                                                                                |
| インフラ構成 | ⚠️パスベースのルーティングするインフラ要素が追加で必要                                                                                                                    | ✅️パスベースのルーティングの手間は不要                                                                                                      |
| ローカル環境 | ⚠️nginx などでパスベースのルーティングが追加で必要                                                                                                                        | ✅️Web API側のポート番号を含めて環境変数で切り替え                                                                                           |

推奨は以下の通り。

- 可能であれば、同一オリジン構成を採用する

もし、複数オリジン構成（≒CORS対応が必要）な前提において、推奨は以下の通り。

- `Access-Control-Allow-Origin`
  - ワイルドカード (\*) は禁止
  - 許可するオリジンを明示的に指定する「ホワイトリスト」形式とする
  - `localhost` の追加は、開発環境のみに絞る
  - 開発 / ステージング / 本番などのデプロイメント環境別に、アクセス可能なドメインは絞る。環境変数などで切り替える
- `Access-Control-Allow-Headers`
  - 実際に利用するヘッダーのみ指定する
- `Access-Control-Allow-Methods`
  - 必要なメソッドのみを許可する
  - 例えば、プリフライトリクエストがPUTで来ているのであれば、PUTだけを許可することが推奨。なお、SPA画面などで基本的に全てのメソッドを返すのであれば一律許可（`GET, POST, PUT, PATCH, DELETE`）をしても良い
- `Access-Control-Allow-Credentials`
  - Cookieや認証ヘッダーを含める場合は、 `true` を設定する
- `Access-Control-Max-Age`
  - デフォルト値: 5 秒
  - 2019年に公開されたChromium v76 以降は最大 2 時間(7200 秒)
  - 特に設定値を変える必要はないが、チューニング観点で必要に応じて値を伸ばす

AWSの場合、API Gatewayの機能でOPTIONSメソッドを提供できる。OPTIONSメソッドの実装方針は以下の通り。

| 観点               | （1）アプリケーションで実装                                         | （2）API Gatewayで実装                                          |
| :----------------- | :------------------------------------------------------------------ | :-------------------------------------------------------------- |
| 概要               | フレームワークのミドルウェアなどを活用し、OPTIONSメソッドを実装する | API GatewayのCORS機能を有効にして対応                           |
| ローカル対応       | ✅️必要                                                              | ⚠️API Gateway相当の仕組みを何かしらローカルに持たせる必要がある |
| クラウド利用費用   | ⚠️余計な通信 / 処理が発生                                           | ✅️API Gatewayにオフロードできる                                 |
| インフラ構築コスト | ✅️複雑度は変わらない                                                | ✅️複雑度は変わらない                                            |

推奨は以下の通り。

- デプロイメント環境で、API Gatewayを利用している場合は（2）を選択する（コスト削減が多少でも見込めることから）
- ただし、API Gatewayを利用していないのであれば、これを目的にあえてAPI Gatewayを追加する必要はない

> [!NOTE]
> **このリポジトリの構成**
>
> 同一オリジン構成を採用し、CORS の middleware は入れない。本番は CloudFront が web と `/api/*` を1つのオリジンにまとめ ([ADR 0013](../adr/0013-api-on-ecs-and-lambda-web-functions.md))、認証は同じオリジンの Cookie のセッションで行う ([ADR 0022](../adr/0022-better-auth-cookie-bff.md))。ローカル開発は `apps/web` の Vite の proxy が `/api` を API へ転送する (パスは書き換えない)。

<!-- 前の注記と分ける -->

> [!NOTE]
> **ローカル環境におけるCORS対応**
>
> [Webフロントエンド設計ガイドライン > CORS対応のローカル開発サーバー](../web-frontend/local-dev-cors.md) を参考する。

<!-- 前の注記と分ける -->

> [!NOTE]
> **参考**
>
> - [オリジン間リソース共有 (CORS) \- HTTP | MDN](https://developer.mozilla.org/ja/docs/Web/HTTP/CORS)
> - [CORSエラーのトラブルシューティング入門 | フューチャー技術ブログ](https://future-architect.github.io/articles/20220222a/)

### Cookie

Web APIは基本的にステートレスであるべきである。そのため、クライアントの状態をサーバー側で保持するためのCookieは避けるべきである。

[認証](authentication-and-authorization.md#認証) 章の 「2.セッショントークン方式」 を利用する場合のみ、ログイン成功後にセッションIDを含むCookieを発行する。

`Set-Cookie` ヘッダーにはいくつかの属性があり、セキュリティ観点で適切に設定する必要がある。

| 名称     | 単位              | 説明                                                                                       | 設定例                                |
| -------- | ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------- |
| Secure   | なし              | HTTPSリクエスト時のみ送信されるようになる                                                  | Secure                                |
| HttpOnly | なし              | JavaScriptからのCookieへのアクセスが禁止される。XSSのリスクを軽減できる                    | HttpOnly                              |
| SameSite | Strict, Lax, None | Cookieの送信制御のための属性（後述）                                                       | SameSite=Strict                       |
| Path     | パス              | 送信対象のパスを指定（設定したパスのサブパスにも送信される）                               | Path=/api                             |
| Domain   | ドメイン名        | 送信先のドメインを指定。省略すると発行元のホスト名に限定され、サブドメイン間で共有されない | (未指定)                              |
| Expires  | 日付 (GMT)        | 有効期限をGMT形式で指定する                                                                | Expires=Tue, 29 Apr 2025 12:00:00 GMT |
| Max-Age  | 秒                | 有効期間を、現在時刻から秒数で指定。Expiresよりも優先。0以下で即座に削除                   | Max-Age=86400 (24時間)                |

`SameSite` の設定値について補足する。

- **Strict**: 同一サイトからのリクエストの場合のみ送信。別サイトからリンクをクリックして遷移した場合にも送信されないため、ユーザー体験に影響がある可能性
- **Lax**: Strictの制限を少し緩和し、別サイトからの遷移でも、安全なHTTPメソッド（GETなど）によるトップレベルナビゲーションの場合はCookieを送信。POSTリクエストやiframe、Ajaxなどでは送信されない
- **None**: クロスサイトリクエストを含む全てでCookieを送信。CSRFトークンなどの対策が必要

また、`__Secure-` や `__Host-` はCookieのセキュリティを高めるためのプレフィックスである。これを利用することで、ブラウザはそのCookieに対して特定のセキュリティルールを適用できる。

- **\_\_Secure-**
  - HTTPS接続でなければブラウザに受け入れられなくなる (Secure属性が必須となる)
    - HTTP接続でCookieが設定されること・送信されることを防ぐ
- **\_\_Host-**
  - `__Secure-` よりもさらに厳格で、HTTPS接続 (Secure属性) であることに加え、特定のホストに限定され （Domain属性を指定できない）、かつサイト全体 (Path=/) で有効である必要がある。`Path=/api/` などサブパスは指定できない
  - サブドメインなどからCookieを操作されるリスクを防ぐ
  - サブパスの場合は、上書きすること自体は可能だが `/` 固定になるため、特定のパスだけ異なったCookieの値が使用されることはなくなる。セッション固定などの攻撃により耐性がある

仮に Web API のパスが `/api/` であった場合には2通りの設定が考えられる。

1. **Pathの絞り込みを優先パターン**
   - 例: `Set-Cookie: __Secure-ID=123; Secure; HttpOnly; Path=/api/`
   - Pathを `/api/`　に絞ることを優先するため、 `__Secure-` プレフィックスを利用
   - ✅️セッション送信先を限定できる
   - ❌️Domain属性を指定してしまうという設定ミスは防げない、その場合はサブドメインからCookieが不正に上書きされる恐れ
   - ❌️サブパスから、任意のパス （`/api/profile/` など）のCookieを上書くという、 Cookie の隠蔽（シャドウイング）ができてしまう
2. **\_\_Host- プレフィックスの使用を優先パターン**
   - 例: `Set-Cookie: __Host-ID=123; Secure; HttpOnly; Path=/`
   - `__Host-` プレフィックスを優先するため、 Pathは `/` を設定する
   - ❌️Cookieの送信スコープが広くなる（本来は /api/ のサブパスだけでよいが、 `/page/` や `/images/` などにも送信される）
   - ✅️サブドメインやサブパスからのCookieの不正な上書きには強い

推奨は以下の通り。

- セッショントークン方式の認証以外の用途では、原則、Cookieを使用しない
- Cookie自体には、ユーザーIDや権限などの機密情報を直接含めない
- セッションIDには、ライブラリやフレームワークが提供する、暗号論的に安全な乱数生成器によって生成された、十分に長く推測困難なセッションIDのみを含める
- `Set-Cookie` には以下の属性を設定する
  - `Secure` 属性: 有効にする。HTTPSリクエストでのみ送信するようにするため
  - `HttpOnly`属性: 有効にする。XSSリスクを軽減させるため
  - `SameSite` 属性: `Strict` を設定する。BFF の Cookie のセッションには `Strict` を勧める（[RFC 10017](https://www.rfc-editor.org/rfc/rfc10017.html) 6.1.3.2）。別サイトからのリンクでログイン済みの状態を保てないなど、`Strict` が要件上、充足できない場合だけ `Lax` にする。`None` は禁止する。`SameSite` は CSRF 対策の一つで、これだけに頼らない。同じサイト（eTLD+1）の別のサブドメインからの攻撃は防げない（RFC 10017 6.1.3.3.1）
  - `Path` 属性: `/` を指定する。`__Host-` プレフィックスを利用したいため
  - `Domain` 属性: 原則、省略（発行元のホスト名に限定）する。サブドメイン間で共有は行わせないため
  - `Max-Age` 属性: 合意されたセッション有効期間を指定する
  - `Expires` 属性: `Max-Age` を用いるため、利用しない
  - `__Host-` プレフィックスを利用する。送信スコープより、設定値の保護を優先する方がリスクは低いと考えるため。RFC 10017 6.1.3.2 は、HTTP で設定した Cookie であることを示す `__Host-Http-` を SHOULD とする。ブラウザとライブラリが対応していれば `__Host-Http-` にし、対応していなければ `__Host-` にする
- CSRF 対策を実装する（MUST。RFC 10017 6.1.3.3）。`SameSite` に加えて、次のいずれかを組み合わせる
  - CORS を防御にする場合は、プリフライトを必ず起こすために、独自のリクエストヘッダー（静的な値でよい）を必須にし、全てのリクエストで確認する。ボディのない POST などは、プリフライトなしで送られる（6.1.3.3.2）。ブラウザのアプリを BFF と同一オリジンに置けば、正規のリクエストにプリフライトは起きない
  - フレームワークが備える anti-forgery（double-submit）Cookie を使う（6.1.3.3.3）
- ログイン時は常に新しいセッションIDを再生成する（既存の値を流用しない）
- ログアウト時に、サーバーのセッション情報の破棄とともに、クライアント側のCookieも `Max-Age=0` を指定して削除する

> [!NOTE]
> **参考**
>
> - [RFC 10017 OAuth 2.0 for Browser-Based Applications](https://www.rfc-editor.org/rfc/rfc10017.html) 6.1.3.2 Cookie Security、6.1.3.3 CSRF Protections
> - [HTTP Cookie の使用 - HTTP | MDN](https://developer.mozilla.org/ja/docs/Web/HTTP/Guides/Cookies)
> - [Set-Cookie - HTTP | MDN](https://developer.mozilla.org/ja/docs/Web/HTTP/Reference/Headers/Set-Cookie)
