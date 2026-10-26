---
type: ADR
title: "ADR 0022: 認証は Better Auth の Cookie の BFF にし、役割とテナントはアプリの DB が持ち、IdP は OIDC で差し替える"
description: サンプル機能（経費精算）の認証を、Hono を BFF にした Cookie のセッションと Better Auth で実装し、役割とテナントはアプリの DB に持ち、ログインは OIDC の1経路（ローカルと CI は Keycloak、本番は Cognito か Entra ID）にした決定。認証やセッションの方式を変えるとき、Cookie や CSRF の設定を変えるとき、Better Auth の表や DB のロールを触るとき、IdP を足す、替えるとき、トークンを SPA に持たせたくなったとき、Authorization ヘッダーで認証したくなったときに読む。
tags: [adr, auth, session, bff, security, multitenancy]
---

# ADR 0022: 認証は Better Auth の Cookie の BFF にし、役割とテナントはアプリの DB が持ち、IdP は OIDC で差し替える

サンプル機能（経費精算）には、テナント（`tenant_id`、ADR 0011）と役割（申請者、上長、経理）を知るためのログインが要ります。テンプレートは SI の案件にも使うので、本番の IdP は案件ごとに Cognito や Entra ID に変わります。そこで、Hono を BFF（backend-for-frontend）にして、ブラウザには `HttpOnly` の Cookie のセッションだけを渡し、認証は Better Auth で実装します。役割とテナントは IdP のクレームではなくアプリの DB に持ち、ログインは OIDC の1経路にして、IdP の違いを設定だけにします。経緯は [認証の方式を決める](https://github.com/yokozi-jp/agent-software-factory/issues/74) と、その入力の [テナントと役割をクレームに持つ認証の方式を比べる](https://github.com/yokozi-jp/agent-software-factory/issues/73) にあります。

## ルール

- 認証は Hono を BFF にします。BFF は confidential client として OIDC の認可コードフローを行い、ブラウザには同じオリジンの `/api/*` で Cookie のセッションだけを渡します。SPA はトークンを持ちません（[RFC 10017](https://www.rfc-editor.org/rfc/rfc10017.html) 6.1。業務アプリに BFF を strongly recommended とし、ブラウザがトークンを持つ形を 6.3.4.3 で not recommended とする）。
- `Authorization` ヘッダーでは認証しません。CloudFront の OAC は origin への要求を SigV4 で署名し、その署名に `Authorization` ヘッダーを使います（[OriginAccessControlConfig](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_OriginAccessControlConfig.html)）。ADR 0013 の Web Functions（OAC、`IamAuth`）と両立しません。`/api/*` の cache policy は `CachingDisabled` にし、Cookie を origin に転送します。
- 認証は Better Auth（`better-auth`）にします。ログインは OIDC の1経路だけにし、本番の IdP は Cognito か Entra ID（Better Auth の provider か SSO プラグイン）、ローカルと CI は Keycloak にします。IdP の違いは issuer、client ID、secret の設定だけにして、コードの経路を変えません。Better Auth 自身のメールとパスワードのログインは、既定では使いません。
- Cookie は `Secure`、`HttpOnly`、`SameSite=Strict`、`Path=/`、`Domain` なしにし、`__Host-` 系の接頭辞を付けます（RFC 10017 6.1.3.2。NIST SP 800-63B-4 も `__Host-` と `Strict` か `Lax` を勧める）。Better Auth の既定は `Lax` なので、`defaultCookieAttributes` で `Strict` に変えます。
- CSRF は `hono/csrf`（`Origin` と `Sec-Fetch-Site` の検査。`origin` に公開のオリジンを明示する）と、「状態を変える API は `application/json` だけを受ける」を組み合わせます。GET で状態を変えません。`SameSite` だけに頼りません（RFC 10017 6.1.3.3、[OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)）。
- テナントと役割は、IdP のクレームではなくアプリの DB（Better Auth の organization プラグイン）に持ちます。`organization.id` を `tenant_id` に使います。API は、テナントをサーバー側のセッションからだけ取ります。クライアントが送る値は使いません（ADR 0011）。
- 上長は役割にしません。上長は申請者ごとの関係で（`GLOSSARY.md`）、申請を出すときに人事システムを引いて、承認経路として申請に保存します。承認できるかは「ログイン中の社員が、その申請の承認経路の承認者であること」で判断します。
- ログインのたびに、IdP のメールアドレスで人事システムを引きます。社員なら `user`、`member`、`employee_id` を作り、経理の役割を同期します。社員でなければ拒否し、退職者はテナントへのメンバーシップを無効にします。自己登録は許しません。
- セッションは、無操作で 30 分、最長で 8 時間にします（[OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) は、低リスクのアプリの無操作を 15〜30 分、1日使う事務職のアプリの絶対を 4〜8 時間とする。数値の選択は判断）。役割の変更は次のログインで反映し、最長 8 時間の遅れを許容します。ログアウトは、`session` の行の削除、Cookie の削除、`Clear-Site-Data`、IdP のログアウトの4つを行います。
- Better Auth の表は、専用の `auth` スキーマに置きます。Better Auth だけが専用のロールで接続し、アプリ用のロールには `auth` スキーマの権限を与えません。`auth` の表は RLS の対象にしません。RLS を迂回する（`BYPASSRLS`、所有者）ロールは作りません。AWS の SaaS のアーキテクチャは、認証を含むコントロールプレーンを全テナントに共通でテナントの隔離を持たないものとし、業務のアプリケーションプレーンと分けます（[Control plane vs. application plane](https://docs.aws.amazon.com/whitepapers/latest/saas-architecture-fundamentals/control-plane-vs.-application-plane.html)）。`auth` スキーマを名指しした標準は見つかっていません。この区分と PostgreSQL の権限を組み合わせたのは判断です。

## Considered Options

- **SPA がトークンを持ち、`Authorization: Bearer` で送る**: 実装は軽くなりますが、RFC 10017 が業務アプリに勧めない形で、OAC と衝突します。
- **Cognito のクレーム（`custom:tenant_id`、グループ）にテナントと役割を載せ、API がトークンを検証する**: マネージドで AWS に合い、ADR 0011 の「署名したトークンのクレームから取る」に沿います。ただし、アクセストークンにテナントを載せる pre token generation V2 は Essentials 以上の機能で、無料のエミュレーターがなく、ローカルと CI では試せません。IdP を Entra ID に替えると、クレームの形も作り直しになります。
- **軽い OIDC クライアント（`@hono/oidc-auth` など）と自前のセッション**: 部品は少なくなりますが、セッションと組織の表、Cookie の属性、CSRF を自分で書きます。
- **Keycloak を本番の IdP にする**: Java のサーバーとその DB の運用が要ります。
- **ローカルの IdP を mock-oauth2-server にする**: 軽く、クレームを自由に作れますが、ログアウトやセッションの失効が本物と違います。慣れていて本番に近い Keycloak を選びました。
- **ローカルは Better Auth 自身のメールとパスワード、本番は外部の IdP**: ログインの経路が2つになり、本番の経路がローカルと CI で一度も動きません。
- **毎回のリクエストで人事システムを引き直す、または承認の直前に引き直す**: 役割の遅れは小さくなりますが、人事システムの障害が承認を止めます。

## Consequences

- Cognito 固有の癖（hosted UI、ホスト名、スコープ）は、検証環境の本物の Cognito でしか試せません。検証環境では Cognito を CDK で作って E2E を流して消します（[使い捨ての検証環境を作り、E2E を流して消す流れ（CD）を決める](https://github.com/yokozi-jp/agent-software-factory/issues/88)）。
- `auth` の表の隔離は、DB の RLS ではなく、Better Auth のコードと、アプリ用ロールに権限がないことに依存します。
- 経理の権限を外しても、最長 8 時間は古い役割が残ります。
- Better Auth は新しいライブラリです（1.7.12、2026-10-20）。次は未確認で、実装の最初に確かめます。Keycloak の OIDC との組み合わせ、organization プラグインが `auth` スキーマで動くか、テスト用に session を直接作る手段、`__Host-Http-` の接頭辞、Keycloak の CI での起動時間（feedback loop に効く）。
- Lambda の構成では、BFF が IdP の token endpoint と JWKS を IPv6 で呼びます（ADR 0013）。Cognito のエンドポイントは DNS では AAAA を返しますが、VPC からの接続は検証環境で確かめます。
- 取り込んだガイドラインの `docs/web-api/security.md` と `docs/web-frontend/auth.md` は、このリポジトリの構成に合わせて直しています。
