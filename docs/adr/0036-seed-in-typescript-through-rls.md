---
type: ADR
title: "ADR 0036: seed は packages/db の TypeScript で書き、migrator の 1 つのトランザクションで RLS を通して流し、冪等にせず、本番と検証環境では流さない"
description: ローカル、結合テスト、更新の試験で共通に使う seed の決定。seed は packages/db/src/seed/ の TypeScript で、モジュールごとのファイルと index.ts に分け、入口は seed(databaseUrl) と pnpm db:seed。migrator の 1 つのトランザクションの中で set_config('app.current_tenant', …, true) を切り替え、RLS を通して書く。テナントは 2 つ、名前で呼ぶデータは固定のリテラル、件数を増やすデータは fakerJA と固定の seed、id は採番に任せ、now() と乱数は使わない。表ごとの対応表で書き忘れを vp check で止め、auth と migrations 以外の全部の表に行があることを結合テストで確かめる。冪等にせず、やり直すときは DB を作り直す。表や列を変える migration と同じ PR で書き換える。結合テストのテンプレートの DB に migration の後に入れ、各テストは自分のテナントで書く。検証環境と本番では流さず、seed と faker を本番のイメージに入れない。比べた案は、SQL の seed.sql、冪等な seed、superuser で流す、テストを空の DB で流す、検証環境で流す、本番の守りの重ね掛け、Snaplet seed、Neosync、drizzle-seed。seed を足す、直す、流す場所を変えるとき、表や列を変える migration を書くとき、seed を冪等にしたくなったとき、検証環境や本番で流したくなったとき、テストが seed の行を読みたくなったときに読む。
tags: [adr, db, postgresql, seed, rls, testing, migration]
---

# ADR 0036: seed は packages/db の TypeScript で書き、migrator の 1 つのトランザクションで RLS を通して流し、冪等にせず、本番と検証環境では流さない

[ADR 0025](0025-kysely-and-dbmate-sql-first.md) は、手で触るためのローカルのデータを migration の外の seed に置き、本番では流さないとだけ決めました。置き場所、流し方、テストとの関係は決めていません。ローカルの開発、結合テスト、検証環境、migration が前の版のアプリと両立するかを確かめる更新の試験 ([Issue #213](https://github.com/yokozi-jp/agent-software-factory/issues/213)) の 4 つの場面が同じ seed を使えるように、入口と約束を決めます。経緯は [seed の方式を決める](https://github.com/yokozi-jp/agent-software-factory/issues/300) の解決コメントにあります。seed の中身 (サンプル機能のデータ) は、サンプル機能の仕様を書くときに決めます。入口とテストの実装は [Issue #332](https://github.com/yokozi-jp/agent-software-factory/issues/332) です。

## ルール

- **形式と置き場所**: seed は TypeScript で、`packages/db/src/seed/` にモジュールごとのファイルと `index.ts` を置きます。`packages/db` への移動は [Issue #333](https://github.com/yokozi-jp/agent-software-factory/issues/333) で決まり、[Issue #337](https://github.com/yokozi-jp/agent-software-factory/issues/337) で行います。それまでは migration と同じ `apps/api/db/` の隣です。migration と同じ場所に置くのは、Rails、Laravel、Prisma、Supabase も同じです。入口は関数 `seed(databaseUrl)` と `pnpm db:seed` で、`DATABASE_URL` に `migrator` の接続 URL を渡します (`db:migrate` と同じ形)。
- **型**: kysely-codegen が生成した Kysely の型 ([ADR 0025](0025-kysely-and-dbmate-sql-first.md)) を使います。列のずれは `vp check` の型の検査で止まります。
- **ロールと RLS**: `migrator` で接続し、全体を 1 つのトランザクションにして流します。テナントは 2 つ ([ADR 0011](0011-tenant-id-and-rls-from-the-start.md)) で、`set_config('app.current_tenant', …, true)` で切り替えます。第 3 引数が `true` の設定は、現在のトランザクションの間だけ効きます。表は `FORCE ROW LEVEL SECURITY` なので所有者の `migrator` にもポリシーが効き、seed の行がポリシーを満たすことも流すたびに確かめられます。superuser と `BYPASSRLS` のロールは RLS を迂回するので使いません。
- **`inTenantTransaction` を使わない**: 補助関数 `inTenantTransaction` は、1 つのトランザクションで 1 つのモジュールの表を書く形です。[ADR 0029](0029-module-data-ownership-and-shared-outbox.md) の実装 ([Issue #268](https://github.com/yokozi-jp/agent-software-factory/issues/268)) で、モジュールのロールに `SET ROLE` するようになります。seed は 1 つのトランザクションで複数のモジュールの表を書くので、この形に合いません。
- **データの作り方**: 名前で呼ぶデータ (テナント、申請者、上長、経理) は固定のリテラルにします。件数を増やすデータは `@faker-js/faker` の `fakerJA` で作り、固定の `faker.seed()` を呼びます。`faker` は `devDependencies` に置きます。id は採番に任せます。固定の id にすると、`OVERRIDING SYSTEM VALUE` と `setval` が要ります。`now()` と乱数は使いません。faker の `date.past` や `date.recent` などは、seed を固定しても「今日」に依存して値が変わるので、日時は固定の値か `refDate` を渡して作ります。
- **表の書き忘れを止める**: 表ごとの対応表 `{ [T in keyof DB]: … }` を書きます。表を足して対応表に行を足さないと、`vp check` の型の検査が失敗します。
- **全部の表に 1 行以上**: seed を流したテンプレートの DB で、superuser が `pg_class` から表を列挙し、各表に行があることを結合テストで確かめます。外すのは `auth` と `migrations` のスキーマだけで、外すときはテストに理由を書きます。Outbox、冪等キー、受信の重複除去の表も外さず、送信済みや期限切れの状態の行を入れます。既存の行で失敗する migration を、更新の試験で見つけるためです。
- **冪等にしない**: 最初にテナント A の行があれば、何もせずに失敗させます。やり直すときは DB を作り直します。
- **版との整合**: seed は版を重ねません。表や列を変える migration と同じ PR で書き換えます。どの commit でも、その commit の migration を流した DB に、その commit の seed が入ります。更新の試験は、base の worktree の seed を base のスキーマに流します。
- **4 つの場面**:
  - **結合テストと PR の E2E**: `global-setup.ts` が、テンプレートの DB に migration に続けて seed を流します。各テストはテンプレートを複製し、seed にない自分のテナントでデータを作ります。seed の行は読みません (Mystery Guest を避けます)。
  - **更新の試験**: 同じテンプレートの作り方に、PR の migration を seed の後に流す段を足します。結合テストと条件が同じになります。
  - **ローカル**: `pnpm db:seed` で流します。パターンごとのデータを手で操作するのはここです。
  - **検証環境と本番**: 流しません。検証環境は同じ run で消すので人が触れず、毎回作る Cognito の利用者と seed の行を結び付けられません。
- **本番に流さない守り**: seed と faker を本番のイメージに入れないことだけにします。本番の境界は、ネットワーク (private subnet) と IAM DB authentication が持ちます。エージェントには `aws` を禁止しています。人が誤って流すことが心配になったら、許可を明示した DB (`ALTER DATABASE … SET app.seed_allowed`) にだけ流す守りを足します (判断)。
- **範囲の外**: `db:reset` (ローカルの DB の立て方と一緒に決めます。冪等が要るかもそのとき考え直します)。seed の利用者とテスト用 IdP（`apps/api/test/oidc-provider.ts`）の利用者の結び付け方 (同じ人にする約束だけを決め、メールアドレスで結ぶか固定の `id` で結ぶかはサンプル機能の仕様で決めます)。

## Considered Options

- **SQL の `seed.sql`**: Supabase の既定の形です。ただ、型で列のずれと表の書き忘れを止められません。
- **冪等な seed**: Rails の guide は、seed を冪等に書くよう勧めます (`find_or_create_by!`)。同じ guide は、seed を本番の初期データにも使えるとしています。冪等を求める理由は、本番でも流すからだと判断しました。このリポジトリは、本番に要るデータを migration に置くので (ADR 0025)、当てはまりません。冪等にするには固定のキーか、固定の id と `setval` が要り、seed を直すと既存の DB とずれます。Supabase は `db reset` で作り直して流します。この形を取りました。
- **superuser で流す**: RLS を迂回するので、seed の行がポリシーを満たすことを確かめられません。
- **テストを空の DB で流す**: 更新の試験のときだけ、DB の条件が変わります。
- **検証環境で流す**: 上の「4 つの場面」の理由で流しません。
- **本番の守りを重ねる**: 環境変数 (設定を間違えると通る)、`rds_iam` の有無 (AWS 以外に置く派生プロジェクトで守りが消える)、`localhost` に限る、許可の設定 (`app.seed_allowed`) のどれも、今は足しません。境界はネットワークと IAM にあり、要るようになってから足せます。
- **Snaplet seed**: 最後のリリース (v0.98.0) が 2024-07-30 です。
- **Neosync**: 2025-08-30 に archive されました。
- **drizzle-seed**: Drizzle のスキーマが要ります。ADR 0025 は Drizzle を選びませんでした。

## Consequences

- 表や列を変える PR は、seed も直します。対応表と「全部の表に 1 行以上」のテストが、直し忘れを止めます。
- テンプレートの DB に seed が入るので、各テストは空の表を前提にできません。自分のテナントでデータを作り、そのテナントの行だけを読みます。
- `faker` の版を上げると、同じ seed でも値が変わることがあります ([Faker: Reproducible results](https://fakerjs.dev/guide/usage#reproducible-results))。seed の値を期待値に書くテストは置きません。
- 冪等でないので、2 回流すと失敗します。ローカルでやり直すときは DB を作り直します。

## 出典

- RLS が所有者にも効く `FORCE ROW LEVEL SECURITY` と、superuser と `BYPASSRLS` が RLS を迂回すること: [PostgreSQL: 5.9 Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) (2026-10-28 に読んだ)
- `set_config` の第 3 引数 `is_local` が `true` のとき、現在のトランザクションの間だけ効くこと: [PostgreSQL: 9.28 System Administration Functions](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SET) (2026-10-28 に読んだ)
- 固定の seed でも、`date.past` などが「今日」に依存して再現しないこと: [Faker: Usage](https://fakerjs.dev/guide/usage#reproducible-results) (2026-10-28 に読んだ)
- Rails の seed を冪等に書く勧めと、本番の初期データにも使えること: [Rails guide: Migrations and Seed Data](https://guides.rubyonrails.org/active_record_migrations.html#migrations-and-seed-data) (2026-10-28 に読んだ)
- Supabase の seed が `supabase/seed.sql` で、`db reset` のたびに migration の後に流れること: [Supabase: Seeding your database](https://supabase.com/docs/guides/local-development/seeding-your-database) (2026-10-28 に読んだ)
- seed を migration の隣に置く例: [Prisma: Seeding](https://www.prisma.io/docs/orm/prisma-migrate/workflows/seeding)、[Laravel: Seeding](https://laravel.com/docs/12.x/seeding)
- テンプレートの DB の複製: [PostgreSQL: CREATE DATABASE](https://www.postgresql.org/docs/current/sql-createdatabase.html)
- Snaplet seed の最後のリリースが v0.98.0 (2024-07-30) であること: [supabase-community/seed](https://github.com/supabase-community/seed) の releases。Neosync が 2025-08-30 に archive されたこと: [nucleuscloud/neosync](https://github.com/nucleuscloud/neosync)。どちらも GitHub の API で確かめた (2026-10-28)
- Drizzle のスキーマが要ること: [drizzle-seed](https://orm.drizzle.team/docs/seed-overview)
