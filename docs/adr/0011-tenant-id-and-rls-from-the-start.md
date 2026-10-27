---
type: ADR
title: "ADR 0011: テナントが1つでも、tenant_id と PostgreSQL の RLS を最初から入れる"
description: サンプル機能とテンプレートの既定として、テナントは1つで運用しながら、全表に tenant_id を持たせ、PostgreSQL の RLS でテナントを分ける決定と、テナントの伝え方の決まり。表や migration を足すとき、DB のロールや接続の設定を変えるとき、テナントを使わない構成に戻したくなったとき、DB を PostgreSQL 以外にしたくなったときに読む。
tags: [adr, db, postgresql, multitenancy, security]
---

# ADR 0011: テナントが1つでも、tenant_id と PostgreSQL の RLS を最初から入れる

テンプレートから作るシステムには、顧客ごとの業務システム（シングルテナント）も B2B の SaaS（マルチテナント）もあります。シングルテナントで作った後でマルチテナントに変えると、全表への `tenant_id` の追加、主キーと一意制約と外部キーの作り直し、トークン、キューのメッセージ、バッチ、ログの変更が一度に要ります。そこで、サンプル機能（経費精算）とテンプレートの既定では、テナントを1つで運用しながら、`tenant_id` と PostgreSQL の Row-Level Security（RLS）を最初から入れることにしました。費用は、すべての migration とクエリが今からテナントを意識することです。経緯は [サンプル機能の題材と範囲を決める](https://github.com/yokozi-jp/agent-software-factory/issues/26) にあります。

方式は、[PostgreSQL のマルチテナント](../db/postgresql-multitenancy.md) のプールモデル（単一の表を RLS で分ける）です。AWS Prescriptive Guidance の [Row-level security recommendations](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/rls.html) が推奨する、アプリが実行時に設定する変数と列を比べる形にします。

## ルール

- テナントのデータを持つ表は、すべて `tenant_id` を持ち、`ENABLE ROW LEVEL SECURITY` と `FORCE ROW LEVEL SECURITY` を付けます。ポリシーは `tenant_id = current_setting('app.current_tenant')::uuid` で比べます。`current_setting` の `missing_ok` は使わず、テナントを設定し忘れたらエラーにします。
- 一意キーには `tenant_id` を含め、外部キーは `(tenant_id, id)` の複合にします。一意制約と外部キーの検査は RLS を迂回するので（[PostgreSQL 5.9 Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)）、テナントを含めないと別のテナントの値の有無が分かってしまいます。
- migration 用のロール（表の所有者）と、アプリ用のロールを分けます。アプリ用のロールは、表の所有者、スーパーユーザー、`BYPASSRLS` のどれにもしません。どれも RLS を迂回するためです。
- API は、テナントをサーバー側のセッションからだけ取ります（[ADR 0022](0022-better-auth-cookie-bff.md)。Cookie のセッションはサーバーだけが書ける値で、AWS が勧める「テナントを署名されたトークンに結び付ける」（[AWS Well-Architected SaaS Lens: Identity and access management](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/identity-and-access-management.html)）と同じ信頼の度合いである、というのは判断です）。クライアントが送るヘッダー、パス、本文のテナントは使いません。
- 認証の表（Better Auth）は、専用の `auth` スキーマに置き、RLS の対象にしません。アプリ用のロールには `auth` スキーマの権限を与えません（ADR 0022）。
- テナントは、トランザクションごとに `set_config('app.current_tenant', <id>, true)`（`SET LOCAL` と同じ）で設定します。接続プールで次のリクエストに残るので、セッション単位の `SET` は使いません。
- 非同期処理は Outbox のメッセージに `tenant_id` を載せ、ワーカーが処理のトランザクションの中で設定します。バッチはテナントをパラメータに取ってテナントごとに実行し、`BYPASSRLS` を持つロールで全テナントを一度に処理しません。唯一の例外は、Outbox を送る処理が専用のロール `outbox_relay` で `messaging.outbox` の全テナントの行を読むことです ([ADR 0029](0029-module-data-ownership-and-shared-outbox.md))。
- テストデータには2つのテナントを置き、別のテナントの行が読めない、更新できない、バッチの対象に入らないことをテストします。`tenant_id` を持つ表（`auth` スキーマを除く）がすべて RLS を有効にして強制していることを、カタログ（`pg_class.relrowsecurity`、`relforcerowsecurity`）で確かめるテストも置きます。

## Considered Options

- **シングルテナントだけで作る**: 今の費用はいちばん小さくなります。ただし、後からマルチテナントに変える作り直しが大きく、テンプレートのガイドとセンサーもシングルテナントを前提に育ちます。
- **マルチテナントの運用まで作る**（テナントの追加、テナントごとの設定）: サンプル機能が SaaS の運用の機能まで持つことになり、題材が膨らみます。地図の「時期が来たら」に残しています。
- **テナントごとにスキーマか DB を分ける**（ブリッジモデル）: テナントが増えるたびに migration をテナントの数だけ流すことになります。テナントが1つの今は、分ける効果を確かめられません。
- **DynamoDB**: RLS がなく、テナントの分離をすべてアプリのコードで守ることになります。経費精算は表どうしの関連と制約が中心で、RDB が合います。

## Consequences

- DB は PostgreSQL に決まります。ホスティングの形は、[デプロイ先と実行基盤を決める](https://github.com/yokozi-jp/agent-software-factory/issues/25) で Aurora PostgreSQL Serverless v2 に決めました（ADR 0013）。
- キャッシュのキーとログにも `tenant_id` を含めます。細かい規約は、`docs/db` と `docs/logging` に足すときに決めます。
