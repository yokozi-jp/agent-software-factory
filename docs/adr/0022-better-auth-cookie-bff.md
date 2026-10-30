---
type: ADR
title: "ADR 0022: 認証は Better Auth の Cookie の BFF にし、役割とテナントはアプリの DB が持ち、IdP は OIDC で差し替える"
description: サンプル機能（経費精算）の認証を、Hono を BFF にした Cookie のセッションと Better Auth で実装し、役割とテナントはアプリの DB に持ち、ログインは OIDC の1経路（ローカルと CI はテストのプロセスの中の node-oidc-provider、本番は Cognito か Entra ID）にした決定。認証やセッションの方式を変えるとき、Cookie や CSRF の設定を変えるとき、Better Auth の表や DB のロールを触るとき、IdP を足す、替えるとき、トークンを SPA に持たせたくなったとき、Authorization ヘッダーで認証したくなったときに読む。
tags: [adr, auth, session, bff, security, multitenancy]
---

# ADR 0022: 認証は Better Auth の Cookie の BFF にし、役割とテナントはアプリの DB が持ち、IdP は OIDC で差し替える

サンプル機能（経費精算）には、テナント（`tenant_id`、ADR 0011）と役割（申請者、上長、経理）を知るためのログインが要ります。テンプレートは SI の案件にも使うので、本番の IdP は案件ごとに Cognito や Entra ID に変わります。そこで、Hono を BFF（backend-for-frontend）にして、ブラウザには `HttpOnly` の Cookie のセッションだけを渡し、認証は Better Auth で実装します。役割とテナントは IdP のクレームではなくアプリの DB に持ち、ログインは OIDC の1経路にして、IdP の違いを設定だけにします。経緯は [認証の方式を決める](https://github.com/yokozi-jp/agent-software-factory/issues/74) と、その入力の [テナントと役割をクレームに持つ認証の方式を比べる](https://github.com/yokozi-jp/agent-software-factory/issues/73) にあります。

## ルール

- 認証は Hono を BFF にします。BFF は confidential client として OIDC の認可コードフローを行い、ブラウザには同じオリジンの `/api/*` で Cookie のセッションだけを渡します。SPA はトークンを持ちません（[RFC 10017](https://www.rfc-editor.org/rfc/rfc10017.html) 6.1。業務アプリに BFF を strongly recommended とし、ブラウザがトークンを持つ形を 6.3.4.3 で not recommended とする）。
- `Authorization` ヘッダーでは認証しません。CloudFront の OAC は origin への要求を SigV4 で署名し、その署名に `Authorization` ヘッダーを使います（[OriginAccessControlConfig](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_OriginAccessControlConfig.html)）。ADR 0013 の Web Functions（OAC、`IamAuth`）と両立しません。`/api/*` の cache policy は `CachingDisabled` にし、Cookie を origin に転送します。
- 認証は Better Auth（`better-auth`）にします。ログインは OIDC の1経路だけにし、本番の IdP は Cognito か Entra ID（Better Auth の provider か SSO プラグイン）、ローカルと CI はテストのプロセスの中で動かす node-oidc-provider にします。IdP の違いは issuer、client ID、secret の設定だけにして、コードの経路を変えません。Better Auth 自身のメールとパスワードのログインは、既定では使いません。
- Cookie は `Secure`、`HttpOnly`、`SameSite=Strict`、`Path=/`、`Domain` なしにし、名前に `__Host-` を付けます。RFC 10017 6.1.3.2 は `SameSite=Strict` と `__Host-Http-` を SHOULD とし、[NIST SP 800-63B-4 の Session Management](https://pages.nist.gov/800-63-4/sp800-63b/session/) は `__Host-` と `SameSite` の `Lax` か `Strict` を SHOULD とします。このリポジトリは両方に当たる `__Host-` を使い、`__Host-Http-` は使いません。例外は IdP から戻る callback で送られる `state` の Cookie で、`SameSite=Lax` にします。IdP から戻る遷移は別のサイトから始まるので、`Strict` だと送られず、ログインが `State mismatch` で失敗します（テストの browser が cross-site の遷移で `Strict` の Cookie を送らないようにして、この失敗を再現した）。Better Auth は `useSecureCookies` のとき名前に `__Secure-` を付けるので、`useSecureCookies: false` にして、Cookie の名前と `secure` を自分で指定します（`apps/api/src/auth/auth.ts`。Better Auth 1.7.12 で、ログインの Set-Cookie がすべて `__Host-` になることをテストで確かめた）。
- CSRF は、GET、HEAD、OPTIONS 以外の要求に自前の middleware（`apps/api/src/security/csrf.ts`）で次を求めます。`Origin` ヘッダーがあれば公開のオリジンと同じ（403）。`Sec-Fetch-Site` があれば `same-origin`（403）。`Content-Type` は `application/json`（415）。`hono/csrf` は使いません。`hono/csrf` は `application/json` を検査しないので（[Hono CSRF Protection](https://hono.dev/docs/middleware/builtin/csrf)）、別のオリジンからの JSON の要求を止められません。`SameSite` だけに頼りません（RFC 10017 6.1.3.3、[OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)）。GET で状態を変えません。
- テナントと役割は、IdP のクレームではなくアプリの DB（Better Auth の organization プラグイン）に持ちます。`organization.id` を `tenant_id` に使い、ID は UUID にします（`advanced.database.generateId`）。利用者が自分で組織（テナント）を作れてはいけないので、`allowUserToCreateOrganization: false` にします。API は、テナントをサーバー側のセッションからだけ取ります。クライアントが送る値は使いません（ADR 0011）。
- 上長は役割にしません。上長は申請者ごとの関係で（`GLOSSARY.md`）、申請を出すときに人事システムを引いて、承認経路として申請に保存します。承認できるかは「ログイン中の社員が、その申請の承認経路の承認者であること」で判断します。
- ログインのたびに、IdP のメールアドレスで人事システムを引きます。社員なら `user`、`member`、`employee_id` を作り、経理の役割を同期します。社員でなければ拒否し、退職者はテナントへのメンバーシップを無効にします。自己登録は許しません。
- セッションは、無操作で 30 分、最長で 8 時間にします（[OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) は、低リスクのアプリの無操作を 15〜30 分、1日使う事務職のアプリの絶対を 4〜8 時間とする。数値の選択は判断）。役割の変更は次のログインで反映し、最長 8 時間の遅れを許容します。最長の期限は Better Auth に無いので、`sessionGuard`（`apps/api/src/auth/session.ts`）が `/api/*` の全部で見ます。無操作の期限を延ばすとき Better Auth が返す新しい期限の `Set-Cookie` も、同じ middleware が応答に付けます（付けないと、使われている間もブラウザは最初の Cookie の期限で Cookie を捨てる）。ログアウトは、`session` の行の削除、Cookie の削除、`Clear-Site-Data`（成功したときだけ）、IdP のログアウトの4つを行います。
- Better Auth の表は、専用の `auth` スキーマに置きます。Better Auth だけが専用のロールで接続し、アプリ用のロールには `auth` スキーマの権限を与えません。例外は、締めのバッチのロール `closing_module` が、テナントの一覧のために `auth."organization"` の `id` の列だけを読む `SELECT` です。テナントの id は秘密ではなく、列を限ればほかの列と表は読めないためです（[ADR 0042](0042-closing-batch-catches-up-daily-without-locks.md)）。表と権限は `packages/db/migrations` の migration で作り、実行時に表を作る `migrateAuth()` は使いません ([ADR 0025](0025-kysely-and-dbmate-sql-first.md))。接続のロールは `auth_service` で、`search_path` を `auth` にします (`pg.Pool` を渡すときの Better Auth の docs の書き方)。`auth` の表は RLS の対象にしません。RLS を迂回する（`BYPASSRLS`、所有者）ロールは作りません。AWS の SaaS のアーキテクチャは、認証を含むコントロールプレーンを全テナントに共通でテナントの隔離を持たないものとし、業務のアプリケーションプレーンと分けます（[Control plane vs. application plane](https://docs.aws.amazon.com/whitepapers/latest/saas-architecture-fundamentals/control-plane-vs.-application-plane.html)）。`auth` スキーマを名指しした標準は見つかっていません。この区分と PostgreSQL の権限を組み合わせたのは判断です。

## Considered Options

- **SPA がトークンを持ち、`Authorization: Bearer` で送る**: 実装は軽くなりますが、RFC 10017 が業務アプリに勧めない形で、OAC と衝突します。
- **Cognito のクレーム（`custom:tenant_id`、グループ）にテナントと役割を載せ、API がトークンを検証する**: マネージドで AWS に合い、ADR 0011 の「署名したトークンのクレームから取る」に沿います。ただし、アクセストークンにテナントを載せる pre token generation V2 は Essentials 以上の機能で、無料のエミュレーターがなく、ローカルと CI では試せません。IdP を Entra ID に替えると、クレームの形も作り直しになります。
- **軽い OIDC クライアント（`@hono/oidc-auth` など）と自前のセッション**: 部品は少なくなりますが、セッションと組織の表、Cookie の属性、CSRF を自分で書きます。
- **Keycloak を本番の IdP にする**: Java のサーバーとその DB の運用が要ります。
- **ローカルの IdP を mock-oauth2-server にする**: 軽く、クレームを自由に作れますが、ログアウトやセッションの失効が本物と違います。
- **ローカルと CI の IdP を Keycloak のコンテナにする**: 最初はこれを選びました。ただし、複数の Kiro セッションが同じマシンで並行すると JVM がセッションの数だけ起動し、負荷で起動が待ちの上限（180 秒）に間に合わず、`pre-push` が止まりました（負荷が低いと 46 秒、3 セッション並行で 180 秒超）。[Issue #427](https://github.com/yokozi-jp/agent-software-factory/issues/427) で、node-oidc-provider に替えました。
- **Keycloak を 1 つだけ立てて全セッションで共有する（compose）**: JVM は 1 つになりますが、立て忘れると動かず、起動の手順が増えます。node-oidc-provider は Docker が要りません。
- **ローカルと CI の IdP を node-oidc-provider にする**: 選びました。テストのプロセスの中で動かし、起動は 1 秒未満です。OpenID Connect の認証を取った実装で、認可コード、PKCE、RP-Initiated Logout に対応します。ログイン画面と、ログアウトの確認の省略は自作です。Keycloak 固有の挙動（クレームの形、セッション設定）は確かめられなくなりますが、本番は Cognito か Entra ID なので、Keycloak で通ることは本番で通る証拠になりません（判断）。
- **ローカルは Better Auth 自身のメールとパスワード、本番は外部の IdP**: ログインの経路が2つになり、本番の経路がローカルと CI で一度も動きません。
- **毎回のリクエストで人事システムを引き直す、または承認の直前に引き直す**: 役割の遅れは小さくなりますが、人事システムの障害が承認を止めます。

## Consequences

- Cognito 固有の癖（hosted UI、ホスト名、スコープ）は、検証環境の本物の Cognito でしか試せません。検証環境では Cognito を CDK で作って E2E を流して消します（[使い捨ての検証環境を作り、E2E を流して消す流れ（CD）を決める](https://github.com/yokozi-jp/agent-software-factory/issues/88)）。
- `auth` の表の隔離は、DB の RLS ではなく、Better Auth のコードと、アプリ用ロールに権限がないことに依存します。
- 経理の権限を外しても、最長 8 時間は古い役割が残ります。
- Better Auth は新しいライブラリです（[npm registry](https://www.npmjs.com/package/better-auth) の 1.7.12、2026-10-20）。実装で確かめたこと: OIDC（認可コードと PKCE）でログインできる。organization プラグインを含む表が `auth` スキーマに作られ、アプリ用ロールからは読めない。無操作の期限（Better Auth の `expiresIn`）は Better Auth が見るが、最長の期限は持たないので、`sessionGuard` が見る。IdP のログアウトは、Better Auth が `end_session_endpoint` の URL を `sign-out` の応答で返す。Cognito は discovery に `end_session_endpoint` を持たず、`/logout` に `client_id` と `logout_uri` を渡す形のため、本番の Cognito で IdP のセッションが終わるかは別に確かめる（[Issue #437](https://github.com/yokozi-jp/agent-software-factory/issues/437)）。
- テストの認証は 2 通りに分ける。ログイン、Cookie、ログアウトを確かめるテストだけが、テスト用 IdP のログインの画面を HTTP で通す（`TestBrowser.login()`。2026-10-26 のローカルで 1 回 1〜3 秒）。Cookie の `SameSite` と期限の失敗は、この方法で見つかった。業務のテストなど、認証が目的でないテストは、Better Auth の `testUtils` プラグインで作ったセッションを使う（`fixture.signedIn()`。1 回 0.4 秒ほど）。`testUtils` は、アプリと同じ設定、同じ DB、同じ secret の別の認証に足すので、セッションの行と Cookie の署名はアプリがそのまま受け取る（`apps/api/test/auth-fixtures.ts`）。本物のログインを毎回通すと、認証が要るテストが増えるたびに遅くなる。少数のテストに絞るのは、テストピラミッドの考え方に沿った判断である。
- api のテストは Docker が要り、PostgreSQL のコンテナを起動する。IdP はテストのプロセスの中で動き、コンテナを起動しない。2026-10-26 の Keycloak のコンテナを使っていたローカル（イメージ取得済み）で `vp test run` が 73〜123 秒（3 回の計測）、node-oidc-provider に替えた後の 2026-10-30 に 52 秒（1 回の計測）。CI の feedback loop に効く（[工場の成果の測り方を決める](https://github.com/yokozi-jp/agent-software-factory/issues/39)）。
- 自己登録は、まだ止めていない。IdP でログインできた人は、`user` が自動で作られる。人事システムの確認で止める（[ログインのたびに人事システムで社員を確認し、メンバーシップと役割を同期する](https://github.com/yokozi-jp/agent-software-factory/issues/156)）。
- `server.ts` は、認証の環境変数が足りないと起動に失敗する（fail closed）。認証なしの開発は `vp dev` を使う。
- まだ確かめていない: `__Host-Http-` の接頭辞（使わないことにした）、ブラウザ（Playwright）を通した E2E（web にログインの画面がない）、Cognito と Entra ID の provider。
- Lambda の構成では、BFF が IdP の token endpoint と JWKS を IPv6 で呼びます（ADR 0013）。Cognito のエンドポイントは DNS では AAAA を返しますが、VPC からの接続は検証環境で確かめます。
- 取り込んだガイドラインの `docs/web-api/security.md` と `docs/web-frontend/auth.md` は、このリポジトリの構成に合わせて直しています。
