# テナントと役割をクレームに持つ認証の方式を比べる

## 問い

[Issue #73](https://github.com/yokozi-jp/agent-software-factory/issues/73) の調査。サンプル機能（経費精算）の認証に使える方式を、一次資料で比べる。トークンは役割（申請者、上長、経理）とテナント（`tenant_id`）をクレームに持ち、API が署名を検証できるものとする。

前提は [#26 の解決のコメント](https://github.com/yokozi-jp/agent-software-factory/issues/26) と ADR 0007 にある。

- テナントは、署名を検証したトークンのクレームからだけ取り、トランザクションごとに `set_config('app.current_tenant', ...)` で RLS に渡す（#26）。
- API は Hono（Node.js 26）で、`apps/api/src` は Web 標準の API だけで書く（`docs/adr/0007-api-on-node-web-standard-app.md`）。
- web は React の SPA（TanStack Router）で、S3 + CloudFront から配る。

調べた日: 2026-10-24。版は npm registry と GitHub の releases から取った。

## 要約

- SPA と API の標準の形は、2026-08 に BCP として出た [RFC 10017（OAuth 2.0 for Browser-Based Applications）](https://www.rfc-editor.org/rfc/rfc10017.html) の **BFF**。バックエンドが confidential client として認可コードフローを行い、トークンはサーバーに置き、ブラウザには `HttpOnly` の Cookie のセッションだけを渡す。業務アプリでは BFF を「strongly recommended」、ブラウザだけでトークンを持つ形を「not recommended」としている（6.1、6.3.4.3）。
- BFF の Cookie は `Secure`、`HttpOnly` が MUST、`SameSite=Strict`、`Path=/`、`Domain` なし、`__Host-Http-` の接頭辞が SHOULD。CSRF 対策は MUST で、SameSite だけでは同じサイトの別のサブドメインからの攻撃を防げない（RFC 10017 6.1.3.2、6.1.3.3）。Hono の `hono/csrf`（Origin と `Sec-Fetch-Site` の検査）は OWASP の Fetch Metadata の方式に当たる。
- Hono で JWT を検証するには `hono/jwk` か `jose` を使う。`hono/jwk`（4.13.13）は `kid` 必須、対称鍵の拒否、`alg` の許可リストを持つが、`jwks_uri` を**リクエストごとに fetch し、キャッシュしない**（ソースで確認）。本番では `jose` の `createRemoteJWKSet`（キャッシュとクールダウンあり）を使うか、`keys` に自前のキャッシュを渡す。
- **Cognito**: テナントは `custom:tenant_id`（不変、app client は読み取り専用）、役割はグループ（`cognito:groups`）で持てる。ただしカスタム属性の既定の行き先は ID トークンだけで、アクセストークンに載せる pre token generation の V2 イベントは **Essentials か Plus** の機能。Essentials は 10,000 MAU まで無料で、超えた分は $0.015/MAU。
- **外部の IdP**: Auth0 は Actions で名前空間つきのカスタムクレームを足す。Entra ID は app roles を `roles` クレームに出す。どちらも顧客の IdP につなぐときに意味がある。
- **組み込み（Better Auth 1.7.12）**: Hono に `c.req.raw` でそのまま載る。テナントと役割は organization プラグインのメンバーと役割で DB に持ち、セッションは DB の Cookie。JWT プラグインで JWKS と署名つき JWT も出せる。Auth.js は Better Auth Inc. の管理に移った。
- **自前の IdP（Keycloak 26.8.1）**: Organizations の `organization` クレームと、ロールの `realm_access` / `resource_access` を出せる。realm の JSON の import でテナント2つと役割の利用者をコードで用意できる。費用は Java のサーバーとその DB の運用。
- **本物の IdP なしの試験**: 単体と結合のテストは、`jose` で鍵を作ってテストの中で署名し、`hono/jwk` の `keys` か JWKS を差し替えて `app.request()` で呼ぶ。ログインの画面を通す E2E は、Docker の [navikt/mock-oauth2-server](https://github.com/navikt/mock-oauth2-server)（6.1.3）で、ログインの名前ごとに役割とテナントのクレームを返す。Cognito のエミュレーターは、LocalStack の Cognito が有償の Base 以上、cognito-local は Hosted UI と OAuth のエンドポイントを持たない。
- `docs/` との食い違い: `docs/web-api/security.md` は `SameSite=Lax` を勧めるが、RFC 10017 は BFF に `Strict` を勧める。`docs/web-api/authentication-and-authorization.md` は Bearer 方式の検証を毎回のイントロスペクションとしているが、JWT のアクセストークンは JWKS で手元で検証できる。`docs/web-frontend/auth.md` の方式1（フロントエンドだけ）は、RFC 10017 では業務アプリに勧めない形。
- 判断: #74 では「Hono が BFF を兼ねる（同じオリジンの `/api/*`、Cookie のセッション）」を前提にし、IdP を Cognito Essentials か Better Auth から選ぶのがよい。どちらでも、ローカルと CI は本物の IdP なしで回せる。

## 比較

| 方式                         | テナントと役割の持ち方                                                                               | API での検証                                    | 費用                                                                                        | 版と保守（2026-10-24）                                           | ローカルと CI                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Amazon Cognito（Essentials） | `custom:tenant_id` とグループ。アクセストークンに載せるには pre token generation V2                  | JWKS（RS256）。`aws-jwt-verify` 5.2.1 か `jose` | 10,000 MAU まで無料、超えた分 $0.015/MAU。SAML / OIDC の連携は 50 MAU を超えた分 $0.015/MAU | マネージド                                                       | 無料の公式エミュレーターなし。LocalStack は Base 以上、cognito-local 5.3.0 は OAuth のエンドポイントなし |
| Amazon Cognito（Lite）       | ID トークンだけ変えられる（V1）。アクセストークンにテナントを足せない                                | 同上                                            | 10,000 MAU まで無料、その後 $0.0055/MAU から                                                | マネージド                                                       | 同上                                                                                                     |
| Auth0                        | Actions の `setCustomClaim`。名前空間つきの名前を勧める                                              | JWKS                                            | Free は 25,000 MAU まで。組織ごとの RBAC は Essentials（$35/月〜）                          | マネージド                                                       | テナントを別に作るか、モックの OIDC                                                                      |
| Entra ID                     | app roles を `roles` クレームに。テナントはアプリの側で対応づける                                    | JWKS                                            | 顧客の Entra ID を使うなら顧客の費用（未確認）                                              | マネージド                                                       | モックの OIDC                                                                                            |
| Better Auth                  | organization プラグインのメンバーと役割（DB）。JWT プラグインの `definePayload` でクレームにもできる | DB のセッション。JWT なら JWKS（既定 EdDSA）    | ライブラリは MIT で無料。DB はアプリと共用                                                  | 1.7.12（2026-10-20）。活発                                       | 本物をそのまま動かせる（PostgreSQL とシード）                                                            |
| Keycloak                     | Organizations の `organization` クレーム、`realm_access` / `resource_access`、属性のマッパー         | JWKS                                            | OSS（Apache-2.0）。サーバーと DB の運用費                                                   | 26.8.1（2026-10-13）。活発                                       | Docker の `start-dev` と realm の import                                                                 |
| モックの OIDC（試験だけ）    | 設定の JSON でログイン名ごとにクレームを返す                                                         | JWKS                                            | 無料                                                                                        | mock-oauth2-server 6.1.3、oauth2-mock-server 9.3.0。どちらも活発 | Docker か npm                                                                                            |

## SPA と API の標準の形

### RFC 10017 の3つの形

[RFC 10017](https://www.rfc-editor.org/rfc/rfc10017.html) は 2026-08 に BCP 212 として出た（draft-ietf-oauth-browser-based-apps の最終版。[datatracker](https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/)）。3つの形を挙げる。

- **BFF**（6.1）: バックエンドが OAuth のクライアントになり、トークンをサーバーに置く。BFF は confidential client で、認可コードフローを使う（MUST）。業務アプリ、機微なアプリ、個人データを扱うアプリに「strongly recommended」（6.1.4 の末尾）。
- **Token-Mediating Backend**（6.2）: バックエンドがトークンを取り、ブラウザに渡す。BFF を使えない理由があるときだけ検討する（6.2.4）。
- **ブラウザの OAuth クライアント**（6.3）: SPA が自分で PKCE つきの認可コードフローを行い、トークンを持つ。悪意のある JavaScript に新しいトークンを取られうるため、業務アプリには「not recommended」（6.3.4.3）。

OAuth を使わない「同じドメインの Cookie のセッション」についても、7.1 は、ログインを OIDC の IdP に任せ、フロントエンドとバックエンドの間はサーバー側の Cookie のセッションで足りることが多いと書く。

### BFF の Cookie と CSRF

[RFC 10017 6.1.3.2](https://www.rfc-editor.org/rfc/rfc10017.html#section-6.1.3.2):

- `Secure` と `HttpOnly` は MUST。
- `SameSite=Strict`、`Path=/`、`Domain` を付けない、`__Host-Http-` の接頭辞は SHOULD。
- トークンを Cookie の中に入れる（クライアント側のセッション）なら、Cookie を暗号化する（SHOULD）。

`__Host-Http-` は `__Host-` の制約に加えて `HttpOnly` を要求する接頭辞（[MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)）。対応しないブラウザでは制約がかからない（同）。

セッションの置き場について、サーバー側のセッションは制御しやすいがスケールに難があり、小規模に勧める。クライアント側のセッションは、BFF ではトークンの失効で制御できる（6.1.2.3）。

[RFC 10017 6.1.3.3](https://www.rfc-editor.org/rfc/rfc10017.html#section-6.1.3.3) は CSRF 対策を MUST とし、次を挙げる。

- `SameSite=Strict`: 同じサイト（eTLD+1）の別のサブドメインが乗っ取られると防げない。
- CORS: プリフライトのない単純なリクエスト（フォームの POST、ボディのない POST）は通る。そのため、静的な独自ヘッダーを必須にする（SHOULD）。SPA を BFF と同じオリジンに置けばプリフライトも要らない。
- 二重送信の Cookie: フレームワークにあれば使ってよいが、CORS の方式より勧めるわけではない。

[OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) は、新しいブラウザだけが相手なら Fetch Metadata（`Sec-Fetch-Site`）と Origin の検証で状態を変える要求を止めてよいとする。SameSite は多層防御の一つで、`Lax` は GET の状態変更を防がず、同じサイトの別ホストからの要求も防がない。単純な Content-Type（`application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain`）を受け付けないことも勧める。

### Hono の csrf ミドルウェア

[Hono CSRF Protection](https://hono.dev/docs/middleware/builtin/csrf):

- `Origin` と `Sec-Fetch-Site` を検査し、どちらかが通れば許す。既定は「リクエストの URL と同じオリジン」と `same-origin`。
- 対象は GET、HEAD、OPTIONS 以外で、Content-Type がフォームで送れるもの（上の3つ）だけ。`application/json` は対象外。
- ソース（`hono/dist/middleware/csrf/index.js`、4.13.13）では、Content-Type がないときも `text/plain` とみなして検査する。ボディのない POST も検査に入る。
- Origin を送らない古いブラウザや、ヘッダーを消すプロキシでは使えない（同ドキュメント）。

JSON の要求はプリフライトが要るため、CORS を開けなければ別のオリジンから送れない（RFC 10017 6.1.3.3.2）。`hono/csrf` と「状態を変える API は `application/json` だけ受ける」を組み合わせると、OWASP の Fetch Metadata と単純な Content-Type の拒否の両方に当たる（判断）。

判断: CloudFront が `/api/*` を API のオリジンに送る構成では、オリジンが受け取る URL のホストが公開のホストと違うことがある。その場合、`csrf()` の既定の「同じオリジン」の比較が合わないので、`origin` に公開のオリジンを明示する。CloudFront のパスパターンで振り分ける方法は [Cache behavior settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html) にある。

### 標準とアンチパターン

- 標準: BFF（RFC 10017 6.1）。SPA と API を CloudFront の同じオリジンに置き、`HttpOnly` の Cookie のセッションにする。出典は RFC 10017 と OWASP の CSRF のチートシート。
- 避けるアンチパターン（RFC 10017 の 5 章、7 章、8 章、[RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)）:
  - Implicit grant と Resource Owner Password Credentials grant（RFC 10017 7.2、7.3。RFC 9700 2.1.2、2.4）。
  - JavaScript から読める Cookie や localStorage にトークンを置くこと（RFC 10017 8 章。JavaScript の Cookie API に置くのは NOT RECOMMENDED）。
  - SameSite だけに頼る CSRF 対策（RFC 10017 6.1.3.3.1、OWASP）。
  - GET で状態を変えること（OWASP）。
  - Cookie に `Domain` を付けてサブドメインと共有すること（RFC 10017 6.1.3.2、OWASP）。
- Amplify の既定はトークンを localStorage に置く（[Amplify Tokens and credentials](https://docs.amplify.aws/react/build-a-backend/auth/concepts/tokens-and-credentials/)）。Cognito を SPA から直接使うと、RFC 10017 6.3 の形になる。

## テナントと役割をクレームに載せる方法

### Amazon Cognito

- テナント: AWS は `custom:tenantID` のようなカスタム属性でテナントを分ける方式を挙げ、テナントの属性は不変か、app client から読み取り専用にするよう勧める（[Custom-attribute multi-tenancy](https://docs.aws.amazon.com/cognito/latest/developerguide/custom-attribute-based-multi-tenancy.html)、[Multi-tenancy security recommendations](https://docs.aws.amazon.com/cognito/latest/developerguide/multi-tenancy-security-recommendations.html)）。この方式では、テナントによる認可の判断はアプリの責任になる（同）。
- 役割: グループのメンバーは ID トークンとアクセストークンの `cognito:groups` に出る。グループは入れ子にできない（[User groups](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-user-groups.html)）。AWS はグループのマルチテナントを IAM のロールを選ぶ用途に勧める（[Group multi-tenancy](https://docs.aws.amazon.com/cognito/latest/developerguide/group-based-multi-tenancy.html)）。
- pre token generation の Lambda トリガー（[Pre token generation](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html)）:
  - V1_0 は ID トークンだけを変えられる。V2_0 は ID とアクセストークン、V3_0 はさらに M2M のアクセストークン。
  - V2_0 と V3_0 は Essentials か Plus の機能。2024-11-22 より前から高度なセキュリティ機能を有効にしていた Lite のプールは V2 まで使える。
  - `custom:` 属性の既定の行き先は ID トークン。`claimsToAddOrOverride` で任意のクレームを足せる。グループは `groupOverrideDetails` で上書きする。`sub`、`iss` などと `cognito:` で始まる多くのクレームは変えられない。
  - V2 以降は文字列、数値、真偽値、配列、JSON をクレームの値にできる。
- ID トークンはフロントエンド用で、リソースの認可に使わない（[Amplify Tokens and credentials](https://docs.amplify.aws/react/build-a-backend/auth/concepts/tokens-and-credentials/)）。API がアクセストークンでテナントを受けるには、V2 のトリガーが要る。つまり Essentials 以上になる。
- アクセストークンの寿命は app client ごとに 5 分から 1 日。managed login の Cookie は 1 時間有効なので、1 時間未満にしても再認証なしの期間は短くならない（[Understanding the access token](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)）。役割の変更がトークンに反映されるまでの遅れは、この寿命で決まる（判断）。
- 料金（[Amazon Cognito Pricing](https://aws.amazon.com/cognito/pricing/)）:
  - Essentials: 新しいプールの既定。直接のサインイン（ソーシャルを含む）は 10,000 MAU まで無料、超えた分 $0.015/MAU。
  - Plus: 無料枠なし、$0.020/MAU。
  - Lite: 10,000 MAU まで無料、超えた分 $0.0055/MAU から段階的に下がる。
  - SAML か OIDC の連携でサインインする利用者は、どのプランでも 50 MAU を超えた分 $0.015/MAU。
  - Essentials は managed login、パスキーなどのパスワードなしのログイン、アクセストークンのカスタマイズを含む（同）。

### 外部の IdP

- Auth0: Actions の `api.accessToken.setCustomClaim` などでクレームを足す。衝突を避けるため名前空間つきの名前（例 `https://example.com/tenant_id`）を勧める。Auth0 の API を audience にしたトークンには、名前空間のない独自のクレームを入れられない（[Create custom claims](https://auth0.com/docs/secure/tokens/json-web-tokens/create-custom-claims)）。料金は Free が 25,000 MAU まで、組織ごとの RBAC は Essentials（$35/月、500 MAU から）（[Auth0 Pricing](https://auth0.com/pricing)）。
- Entra ID: アプリの登録で app roles を定義すると、割り当てた利用者のトークンの `roles` クレームに出る。API を呼ぶときはアクセストークンに入る。app roles は安定した認可の分類に使い、細かい権限はアプリの側に置くよう勧める（[Add app roles](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps)）。
- 判断: Entra ID のテナント（`tid`）は顧客の組織で、アプリのテナント（`tenant_id`）とは別物。顧客の Entra ID につなぐなら、`tid` から `tenant_id` への対応をアプリかブローカー（Cognito や Keycloak）で持つ。サンプル機能では外部の IdP を直接使う理由が弱い。

### 組み込み: Better Auth

- 版: `better-auth` 1.7.12（2026-10-20）、GitHub で約 30,000 スター、MIT、活発（[better-auth/better-auth](https://github.com/better-auth/better-auth)）。Auth.js のサイトの著作権表示は Better Auth Inc.（[authjs.dev](https://authjs.dev/)）。`lucia` は非推奨になった（npm の deprecated の表示）。
- Hono とは Web 標準の `Request` と `Response` でつながり、`app.all("/api/auth/*", (c) => auth.handler(c.req.raw))` で載る（[Hono Integration](https://better-auth.com/docs/integrations/hono)）。`AsyncLocalStorage` を使い、Cloudflare Workers では `nodejs_compat` が要る（同）。
- テナントと役割: organization プラグインがメンバーと役割を DB に持ち、セッションに `activeOrganizationId` を置ける（[Organization](https://better-auth.com/docs/plugins/organization)）。
- JWT: JWT プラグインが `/token` と JWKS のエンドポイントを出す。既定の鍵は EdDSA（Ed25519）、寿命は 15 分。`definePayload` でクレームを決められる。セッションの代わりではなく、JWT が要る別のサービスのためのものと書かれている（[JWT plugin](https://better-auth.com/docs/plugins/jwt)）。
- セキュリティの既定: Cookie は `SameSite=Lax`、`HttpOnly`、https なら `Secure`。CSRF は Origin の検証（`trustedOrigins`）、単純なリクエストを避けること、ログイン時の Fetch Metadata の検査。セッションは既定で 7 日（[Security](https://better-auth.com/docs/reference/security)）。
- 判断: Better Auth はアプリが IdP を兼ねる形で、RFC 10017 7.1 の「同じドメインの Cookie のセッション」に当たる。テナントは DB のセッションから取るので、「署名を検証したトークン」ではないが、サーバーだけが書ける値という点で同じ信頼の度合いになる。Cookie は RFC 10017 に合わせて `SameSite=Strict` に変えられる（`defaultCookieAttributes`）。

### 自前の IdP: Keycloak

- 版: 26.8.1（2026-10-13）、Apache-2.0、活発（[keycloak/keycloak](https://github.com/keycloak/keycloak)）。
- Organizations: `organization` スコープを要求すると、トークンに `organization` クレームが入る。id と属性は、マッパーの設定で入れる。`organization:<alias>` で特定の組織を選べる。組織のグループに割り当てたロールは `realm_access` と `resource_access` に出る（[Server Administration Guide: Mapping organization claims](https://www.keycloak.org/docs/latest/server_admin/index.html)）。
- テナントを利用者の属性で持ち、マッパーでクレームにする方法もある（同ガイドのプロトコルマッパー）。
- 試験: `quay.io/keycloak/keycloak:26.8.1 start-dev` で動く（[Getting started with Docker](https://www.keycloak.org/getting-started/getting-started-docker)）。realm の JSON（利用者を含む）を export / import でき、値に環境変数を使える（[Importing and exporting realms](https://www.keycloak.org/server/importExport)）。
- 費用: ライセンスは無料。Java のサーバーとその DB を運用する（判断）。

### 版と保守のその他

| パッケージ                       | 版（公開日）                | 状態                                |
| -------------------------------- | --------------------------- | ----------------------------------- |
| `hono`                           | 4.13.13（2026-10-04）       | 活発                                |
| `jose`                           | 6.2.13（2026-10-20）        | 活発。v6 だけが保守対象             |
| `aws-jwt-verify`                 | 5.2.1（2026-06-05）         | 依存なし。Node.js 18 以上とブラウザ |
| `@hono/oidc-auth`                | 1.10.0（2026-08-05）        | `oauth4webapi` に依存               |
| `openid-client` / `oauth4webapi` | 6.8.8 / 3.8.8（2026-09-05） | 活発                                |
| `oidc-provider`                  | 9.13.0（2026-10-22）        | 活発                                |
| `cognito-local`                  | 5.3.0（2026-05-21）         | 小規模                              |
| `oauth2-mock-server`             | 9.3.0（2026-10-14）         | 活発                                |
| `mock-oauth2-server`（Docker）   | 6.1.3（2026-10-23）         | 活発                                |
| `lucia`                          | 3.2.2                       | npm で deprecated                   |

出典は npm registry（`https://registry.npmjs.org/<name>`）と各リポジトリの releases。

## Hono で JWT を検証する

### hono/jwk

[JWK Auth Middleware](https://hono.dev/docs/middleware/builtin/jwk):

- `kid` を必須にし、対称鍵（HS256 など）を拒み、`alg` の許可リストを要求する。JWK に `alg` があれば一致を確かめる。
- `exp`、`nbf`、`iat` は既定で検査する。`iss` と `aud` は `verification` を設定したときだけ検査する。
- それ以外の検査（テナントや役割）は、後ろの自前のミドルウェアで行う。
- `keys` に鍵か「鍵を返す関数」を渡せる。`jwks_uri` も関数にでき、`c.env` から取れる。

ソースの `utils/jwt/jwt.js`（4.13.13）では、`verifyWithJwks` が `jwks_uri` を**呼ばれるたびに fetch** し、キャッシュしない。リクエストごとに IdP へ通信が出るので、本番では `keys` にキャッシュつきの関数を渡すか、`jose` を使う（判断）。

### jose

- Node.js、ブラウザ、Cloudflare Workers、Deno、Bun で動き、依存がない。Web Crypto と Fetch を前提にする（[panva/jose](https://github.com/panva/jose)）。ADR 0007 の Web 標準の方針に合う。
- `createRemoteJWKSet` は、キャッシュがないか古いときだけ JWKS を取りに行く。合う鍵がないときの再取得は `cooldownDuration` の後だけ（[createRemoteJWKSet](https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md)）。
- `jwtVerify(jwt, JWKS, { issuer, audience })` で `iss` と `aud` も検査する。

### Cognito のトークンの検査

[Verifying JSON web tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html):

- Node.js では `aws-jwt-verify` を勧める。
- アクセストークンには `aud` がなく、`client_id` を app client の ID と比べる。`token_use` が `access` であることも確かめる。
- 署名と `exp` は手元で検査でき、Cognito に問い合わせなくてよい。失効を期限の前に反映させたいなら、寿命を短くするか Cognito に問い合わせる。
- 鍵は `kid` をキーにキャッシュし、知らない `kid` が来たら取り直す。

`hono/jwk` の `verification.aud` は `aud` クレームを見るので、Cognito のアクセストークンでは使えない。`client_id` と `token_use` は自前で検査する（判断）。

### 標準とアンチパターン

- 標準: JWKS で署名を検証し、`alg` を許可リストで固定し、`iss`、`aud`（Cognito では `client_id`）、`exp` を確かめる。出典は [RFC 8725（JWT BCP）](https://www.rfc-editor.org/rfc/rfc8725.html)、[RFC 9068（JWT のアクセストークン）](https://www.rfc-editor.org/rfc/rfc9068.html)、RFC 9700 2.3（アクセストークンを audience で制限し、リソースサーバーは毎回確かめる）。
- 避けるアンチパターン: 署名を検証しないデコード、`alg: none` や対称鍵の受け入れ、`aud` の検査の省略、ID トークンでの API の認可（Amplify のドキュメント）、クライアントが送るテナントのヘッダーを信じること（[OWASP Multi-Tenant Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)）。

## 本物の IdP なしにローカルと CI で試す

### 単体と結合のテスト（ネットワークなし）

- `jose` の `generateKeyPair` と `SignJWT` で、テストの中で鍵を作りトークンに署名する（[panva/jose](https://github.com/panva/jose)）。
- アプリは、検証の鍵を `c.env`（ADR 0007）から受け取る作りにする。テストでは公開鍵を `hono/jwk` の `keys` に渡す。
- `app.request()` で HTTP のサーバーを立てずに呼ぶ（[Hono Testing](https://hono.dev/docs/helpers/testing)）。
- 2つのテナントと3つの役割の組を、パラメータ化したテストで回す。期限切れ、別の `iss`、別の `aud`、知らない `kid`、`alg` の違いも同じ方法で作れる（判断）。

### ログインの画面を通す E2E

- [navikt/mock-oauth2-server](https://github.com/navikt/mock-oauth2-server): `docker run -p 8080:8080 ghcr.io/navikt/mock-oauth2-server:<版>` で動き、discovery は `/<issuerId>/.well-known/openid-configuration`。`interactiveLogin` を有効にし、`JSON_CONFIG` の `requestMappings` で、ログインの名前（`subject`）ごとに返すクレームを決められる。issuer を複数持てる。
- [oauth2-mock-server](https://github.com/axa-group/oauth2-mock-server)（npm、9.3.0）: Node.js の中で動く OIDC のモック。
- Keycloak の `start-dev` と realm の import: 本物に近いが、起動が重い（判断）。
- Better Auth: アプリと同じ PostgreSQL で本物が動くので、シードで利用者、組織、役割を作る。

### Cognito のエミュレーター

- LocalStack は 2026-03 にコミュニティ版のリポジトリをアーカイブし、単一のイメージにまとめた（[localstack/localstack](https://github.com/localstack/localstack)）。Cognito User Pools は Base 以上の有償プランだけで、無料の Hobby（非商用）には入っていない（[LocalStack Plans](https://docs.localstack.cloud/aws/licensing/)）。
- [cognito-local](https://github.com/jagregory/cognito-local)（5.3.0）: API の一部と JWKS の検証を持つ。PreTokenGeneration は `TokenGeneration_Authentication` と `TokenGeneration_RefreshTokens` だけ対応し、`TokenGeneration_HostedAuth` は非対応。`CreateUserPoolDomain` などがなく、Hosted UI と OAuth の認可エンドポイントはない。
- 判断: Cognito を選んでも、ローカルと CI ではモックの OIDC を使う。本物との差（`client_id` と `aud`、`cognito:groups`、トリガーの出力）は、ステージングの Cognito への少数の疎通テストで埋める。

## docs/ との食い違い

`docs/` は直さず、ここに記録する。いずれもフューチャーのガイドラインから取り込んだ領域（`about.md` あり）。

- `docs/web-api/security.md` の Cookie: `SameSite=Lax` を勧める。RFC 10017 6.1.3.2 は BFF の Cookie に `SameSite=Strict` と `__Host-Http-` の接頭辞を勧める（SHOULD）。また、`Lax` の説明の「POST リクエストや iframe、Ajax などでは送信されない」は、別のサイトからの要求に限った話で、同じサイトの Ajax では送られる（[MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)）。
- `docs/web-api/authentication-and-authorization.md` の Web API の認証フロー:
  - Bearer 方式の検証を「毎回イントロスペクション」とし、処理性能を ❌ にしている。JWT のアクセストークンは JWKS で手元で検証でき、Cognito も問い合わせずに検証するよう書いている（Cognito の Verifying JSON web tokens、RFC 9068）。
  - セッショントークン方式の図は、SPA が PKCE を作って認可コードを API に渡す形。RFC 10017 6.1 の BFF は、バックエンドが confidential client として自分でフローを始め、コールバックも受ける。
- `docs/web-frontend/auth.md` の方式1（フロントエンドだけで IdP の JWT を使う）: RFC 10017 6.3 は業務アプリに勧めない。この文書は短所に挙げていない。
- `docs/web-api/authentication-and-authorization.md` のロール管理は「アプリ側で持つ」を勧める。#73 の前提（役割をクレームに持つ）とは向きが違う。BFF では、アプリの DB の役割をセッションに載せるか、IdP のトリガーで DB の役割をトークンに入れることで両立できる（判断）。

## 判断のまとめ

- セッションの形は BFF にする。Hono が `/api/auth/*`（ログイン、コールバック、ログアウト）と `/api/*` を持ち、CloudFront の同じオリジンで SPA と並べる。Cookie は `__Host-Http-`、`Secure`、`HttpOnly`、`SameSite=Strict`、`Path=/`。CSRF は `hono/csrf`（`origin` は公開のオリジン）と、状態を変える API での `application/json` の必須で守る。
- 候補は Cognito Essentials（AWS に揃える。テナントは `custom:tenant_id`、役割はグループ、V2 のトリガーでアクセストークンに載せる）と Better Auth（IdP を持たない。DB の組織と役割）。Keycloak は運用の重さ、Auth0 と Entra ID は顧客の IdP の要件がまだないことから、サンプル機能では下げる。
- どちらでも、API の中ではテナントと役割を「検証済みの主体」（`tenant_id`、`roles`、`sub`）に正規化し、RLS の `set_config` はそこからだけ行う。IdP の違いは、この正規化の層に閉じ込める。
- 試験は、単体と結合では `jose` の署名、E2E では mock-oauth2-server（Cognito の場合）か本物の Better Auth（Better Auth の場合）で回す。

## 未確認のこと

- Entra External ID の料金と、顧客の Entra ID とつなぐときの費用の分担。
- cognito-local が pre token generation の V2 イベント（アクセストークンの変更）に対応しているか。
- `@hono/oidc-auth` の既定のセッションの JWT（HS256）を、RFC 10017 の「クライアント側のセッションは暗号化する」に合わせられるか。
- `__Host-Http-` の接頭辞の各ブラウザの対応状況（MDN の互換性表は未確認）。
- Better Auth の過去の脆弱性の件数と、修正の速さ。

## 出典

- RFC 10017 OAuth 2.0 for Browser-Based Applications（BCP 212、2026-08）: `https://www.rfc-editor.org/rfc/rfc10017.html`
- RFC 9700 OAuth 2.0 Security Best Current Practice: `https://www.rfc-editor.org/rfc/rfc9700.html`
- RFC 8725 JWT Best Current Practices: `https://www.rfc-editor.org/rfc/rfc8725.html`
- RFC 9068 JWT Profile for OAuth 2.0 Access Tokens: `https://www.rfc-editor.org/rfc/rfc9068.html`
- OWASP CSRF Prevention Cheat Sheet: `https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html`
- OWASP Multi-Tenant Security Cheat Sheet: `https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html`
- MDN Set-Cookie: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie`
- Hono JWK Auth Middleware: `https://hono.dev/docs/middleware/builtin/jwk`
- Hono CSRF Protection: `https://hono.dev/docs/middleware/builtin/csrf`
- Hono Testing: `https://hono.dev/docs/helpers/testing`
- Hono のソース（4.13.13）: `https://github.com/honojs/hono/blob/v4.13.13/src/utils/jwt/jwt.ts`、`https://github.com/honojs/hono/blob/v4.13.13/src/middleware/csrf/index.ts`
- `@hono/oidc-auth` README: `https://github.com/honojs/middleware/tree/main/packages/oidc-auth`
- jose: `https://github.com/panva/jose`
- Cognito Pre token generation: `https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html`
- Cognito Verifying JSON web tokens: `https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html`
- Cognito Understanding the access token: `https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html`
- Cognito マルチテナント: `https://docs.aws.amazon.com/cognito/latest/developerguide/multi-tenant-application-best-practices.html` とその子のページ
- Cognito User groups: `https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-user-groups.html`
- Amazon Cognito Pricing: `https://aws.amazon.com/cognito/pricing/`
- aws-jwt-verify: `https://github.com/awslabs/aws-jwt-verify`
- Amplify Tokens and credentials: `https://docs.amplify.aws/react/build-a-backend/auth/concepts/tokens-and-credentials/`
- Auth0 Create custom claims: `https://auth0.com/docs/secure/tokens/json-web-tokens/create-custom-claims`
- Auth0 Pricing: `https://auth0.com/pricing`
- Entra ID Add app roles: `https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps`
- Better Auth（Hono、JWT、Organization、Security）: `https://better-auth.com/docs/integrations/hono`、`https://better-auth.com/docs/plugins/jwt`、`https://better-auth.com/docs/plugins/organization`、`https://better-auth.com/docs/reference/security`
- Auth.js: `https://authjs.dev/`
- Keycloak Server Administration Guide: `https://www.keycloak.org/docs/latest/server_admin/index.html`
- Keycloak Getting started with Docker: `https://www.keycloak.org/getting-started/getting-started-docker`
- Keycloak Importing and exporting realms: `https://www.keycloak.org/server/importExport`
- navikt/mock-oauth2-server: `https://github.com/navikt/mock-oauth2-server`
- axa-group/oauth2-mock-server: `https://github.com/axa-group/oauth2-mock-server`
- jagregory/cognito-local: `https://github.com/jagregory/cognito-local`
- LocalStack（アーカイブの告知）: `https://github.com/localstack/localstack`
- LocalStack Plans: `https://docs.localstack.cloud/aws/licensing/`
- CloudFront Cache behavior settings: `https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html`
- 版: npm registry（`https://registry.npmjs.org/<name>`）、GitHub の releases（2026-10-24 取得）
- リポジトリの文書: `docs/adr/0007-api-on-node-web-standard-app.md`、`docs/web-frontend/auth.md`、`docs/web-frontend/authorization.md`、`docs/web-api/authentication-and-authorization.md`、`docs/web-api/security.md`
