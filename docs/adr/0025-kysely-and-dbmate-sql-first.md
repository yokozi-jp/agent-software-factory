---
type: ADR
title: "ADR 0025: DB のアクセス層は Kysely にし、スキーマの正本は dbmate で流す版付きの SQL の migration にし、型は DB から生成する"
description: PostgreSQL のアクセス層を Kysely にし、スキーマの正本を版付きの SQL の migration ファイルにして dbmate で流し、型を migration を流した DB から kysely-codegen でスキーマごとに生成する決定。migration は前に進めるだけで、本番では CD が ECS のタスクとして migration 用のロールで流す。Better Auth の表も同じ経路で作る。表や migration を足すとき、クエリを書くとき、ORM や Drizzle、Prisma、node-pg-migrate を使いたくなったとき、down の migration を書きたくなったとき、アプリの起動時に migration を流したくなったときに読む。
tags: [adr, db, postgresql, migration, kysely, dbmate, rls]
---

# ADR 0025: DB のアクセス層は Kysely にし、スキーマの正本は dbmate で流す版付きの SQL の migration にし、型は DB から生成する

このリポジトリの DB は Aurora PostgreSQL で、全表に `ENABLE` と `FORCE ROW LEVEL SECURITY`、所有者とアプリ用のロールの分離を求めます ([ADR 0011](0011-tenant-id-and-rls-from-the-start.md))。これらの RLS、ロール、`GRANT` は、TS や宣言的なスキーマ定義から差分を生成する道具が扱えないか、扱いが弱い部分です。そこで、スキーマの正本を SQL の migration ファイルの1か所に置き、型は DB の実物から生成し、クエリは SQL に1対1で対応する Kysely で書きます。経緯は [DB のアクセス層と migration のツールを決める](https://github.com/yokozi-jp/agent-software-factory/issues/187) の解決コメントにあります。

## ルール

- **アクセス層**: [Kysely](https://kysely.dev/) で書きます。接続は `pg` の `Pool` を `PostgresDialect` に渡します。`Pool` を作るのは入口のファイルだけです ([ADR 0007](0007-api-on-node-web-standard-app.md))。Kysely 0.29.7 の `dist` は Node の組み込みのモジュールを import しないので、`Kysely<DB>` を受け取るクエリのコードは `apps/api/src` と `packages/` に置けます。関連の自動の読み込みはないので、入れ子の結果は `jsonArrayFrom` などで SQL の副問い合わせとして明示して書きます。ビルダーで書けない構文 (ヒント句など) は `` sql`…` `` のタグ付きテンプレートで書き、値は bind 変数にします。`sql.raw` と `sql.lit` に入力の値を渡しません。
- **docs/db の規約との関係**: 取り込んだガイドライン ([PostgreSQL のクライアント管理](../db/postgresql-client.md)) はクエリビルダーを使わないとしていました。その理由 (DBA が調整しにくい、関連の扱いの事故、発行される SQL がレビューで見えにくい) は SQL を隠す ORM に当たり、SQL に1対1で対応する Kysely にはほとんど当たらない、というのが判断です。ガイドラインが勧める SQL からの型の生成は、TypeScript では [sqlc-gen-typescript](https://github.com/sqlc-dev/sqlc-gen-typescript) が 0.1.3 (2024-01) の early access で止まり、[PgTyped](https://github.com/adelsz/pgtyped) も 2.4.3 (2025-03) から出ていません。そこで規約を「SQL に1対1で対応しないクエリビルダーと、関連の自動の読み込みは使わない」に改めました。
- **スキーマの正本**: 版付きの SQL の migration ファイルだけを正本にします。TS のスキーマ定義、`.prisma`、宣言的な `ddl.sql` は置きません。テーブル、制約、RLS のポリシー、`FORCE`、`GRANT`、ロールの権限はすべて migration に書きます。
- **型**: migration を流した PostgreSQL から [kysely-codegen](https://github.com/RobinBlomberg/kysely-codegen) で型を生成し、commit します。CI で、流して生成し直した型に差分がないことを確かめます。生成は PostgreSQL のスキーマごとに行い (`--include-pattern "<schema>.*"`)、各モジュールの package にそのモジュールのスキーマの型だけを置きます。あるモジュールの `Kysely<DB>` からは、ほかのモジュールの表が型の上で見えません。`auth` スキーマは型の生成の対象にしません (Better Auth が自分の Kysely で使います)。
- **migration の道具**: [dbmate](https://github.com/amacneil/dbmate) を npm の `dbmate` (OS ごとのビルド済みのバイナリが optional dependency で入る) で入れ、pnpm の catalog と Renovate で版を管理します。
  - 履歴の表は `--migrations-table migrations.schema_migrations` で専用のスキーマに置きます。
  - 毎回 `--migration-lock` を付けます。lock なしで2つ同時に流すと、後の方が「列がすでにある」で途中から失敗しました。
  - `schema.sql` の書き出しは使いません (`--no-dump-schema`)。DB の形は生成した型で確かめます。
  - 本番とテストでは `migrate` を使い、DB を作る `up` は使いません。
- **トランザクションとロック**: 各 migration は dbmate の既定のとおり1つずつトランザクションで包みます。PostgreSQL は DDL もトランザクションで取り消せるので ([PostgreSQL Wiki: Transactional DDL](https://wiki.postgresql.org/wiki/Transactional_DDL_in_PostgreSQL:_A_Competitive_Analysis))、途中で失敗しても半分だけ適用された状態と、履歴とのずれが残りません。先頭に `SET LOCAL lock_timeout` を書き、表のロックを待ち続けて後ろの要求を詰まらせないようにします ([lock_timeout](https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-LOCK-TIMEOUT))。トランザクションの中で実行できない文 (`CREATE INDEX CONCURRENTLY`。[CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)) は、そのファイルだけ `-- migrate:up transaction:false` にします。
- **前に進めるだけ**: down の migration は書きません。dbmate は down の節が空だと `rollback` が何もせずに成功し、履歴の記録だけを消すので、down の節には `DO $$ BEGIN RAISE EXCEPTION 'irreversible …'; END $$;` だけを書き、`rollback` を失敗させます。互換を壊す変更は expand と contract に分け、どの時点でも動いているアプリとスキーマが成り立つようにします。障害の切り戻しはアプリの前の版で行い、スキーマを直すときは前向きの migration を足します。適用済みの migration は書き換えません。
- **本番での実行**: CD が、新しいアプリを出す前に、同じイメージの ECS のタスク (入口 `migrate`) を1回だけ起動して流します。ADR 0013 ではバッチを ECS のタスクで動かすので、Lambda の構成にも ECS のクラスターがあります。構成ごとに stack を data (VPC、Aurora、ECS のクラスター、`migrate` のタスク定義) と app に分け、data の deploy、`migrate`、app の deploy の順に流します。表のない DB でアプリが起動することを避け、アプリより前に流す順序を検証環境とそろえるためです ([検証環境の流れ](../tooling/verification-environment.md))。アプリは起動時に migration を流さず、アプリのロール (`app_user`、`auth_service`) は DDL の権限を持ちません。
  - **ロール**: master user はロールを作るためだけに使い、表の所有者にしません。表の所有者は `migrator` ロールにそろえます (ADR 0011。[Managing PostgreSQL users and roles](https://aws.amazon.com/blogs/database/managing-postgresql-users-and-roles/))。
  - **入口 `migrate` の2段**: (1) master user で、冪等な bootstrap の SQL を流します。中身は `migrator`、`app_user`、`auth_service` の作成 (存在しないときだけ)、`GRANT CONNECT`、`migrator` への `CREATE ON DATABASE`、`rds_iam` のロールがあるときだけの `GRANT rds_iam` です。(2) `migrator` で dbmate の `migrate` を流します。bootstrap を dbmate の外に置くのは、ロールが DB 全体のもので、DB ごとの migration の履歴に乗せるとテンプレートの DB の複製 (下の「テスト」) と衝突するためです。表、スキーマ、`GRANT` は migration に書きます。
  - **接続**: `migrator`、`app_user`、`auth_service` は IAM DB authentication で接続します (`@aws-sdk/rds-signer` で token を署名し、TLS 必須)。secret は RDS が管理する master user のものだけです。ただし、Outbox を送るログインできるロール `outbox_relay` ([ADR 0029](0029-module-data-ownership-and-shared-outbox.md)) は別の秘密を持つと決めたので、この記述と合いません。どちらに合わせるかは [Issue #269](https://github.com/yokozi-jp/agent-software-factory/issues/269) で決め、そのときにこの行を直します。
  - **ローカルと CI**: 同じ bootstrap の SQL を使い、testcontainers の superuser が master user の役をします。違いは `rds_iam` の有無だけで、ローカルはパスワードで接続します。
- **Better Auth の表**: `npx auth generate` が出す SQL と `apps/api/db/auth-schema.sql` を合わせて最初の migration にし、実行時に表を作る `migrateAuth()` (Better Auth の `getMigrations`) は使いません。`auth` スキーマと表は migration 用のロールが所有し、`auth_service` には `USAGE` と行の読み書き (`SELECT`、`INSERT`、`UPDATE`、`DELETE`) だけを与えます。起動時の `validateSchema` は残します。Better Auth の版を上げて表が変わるときは、`auth generate` の差分を読んで migration を手で書きます。
- **テスト**: テストは本番と同じ dbmate の `migrate` で、`globalSetup` でテンプレートの DB に1回だけ流し、各テストは `CREATE DATABASE … TEMPLATE` で複製します。空の DB に全部を適用できることと、2回目の `migrate` で何も適用されないことを確かめます。
- **seed**: 手で触るためのローカルのデータは migration の外の seed に置き、本番では流しません。アプリが動くのに必須のデータ (区分のコード表など) は migration に入れます。

## Considered Options

- **Drizzle ORM と Drizzle Kit**: ダウンロードは最も多く (2026-10 の30日で約1億)、TS のスキーマから型と migration が出ます。ただ、`FORCE ROW LEVEL SECURITY` は TS で書けず ([drizzle-orm#5819](https://github.com/drizzle-team/drizzle-orm/issues/5819) が open)、`GRANT` とロールも手書きの SQL の migration で足すので、正本が TS と SQL に割れます。`migrate()` は 0.45.4 でも 1.0.0-rc.5 でも advisory lock を取りません。stable は 0.45.4 で、1.0 で関連の定義が変わります。
- **Prisma**: `latest` が 8.0.0-rc で、7 からの移行の途中です。関連の取得で SQL を隠すので、規約の理由にそのまま当たります。
- **素の `pg` で SQL を書き、行の型を手で書く**: 規約には字義どおり合いますが、型と DB の実物を手で揃え続けることになります。
- **node-pg-migrate**: 12年続き、30日で約330万のダウンロードがあり、advisory lock が既定で、関数 (`runner`) として呼べます。ただし、トランザクションの外で流す指定は TS のファイルの `pgm.noTransaction()` でしか書けず、migration のすべてを SQL にできません。dbmate は SQL のファイルの中で指定でき、GitHub の stars も多い (7.5k と 1.5k) ので、dbmate を選びました。
- **Kysely の Migrator と kysely-ctl**: 依存は増えませんが、migration は TS のファイルで、トランザクションを使わない指定 (`disableTransactions`) は実行の全体にしか効きません。kysely-ctl の peer は `kysely <0.30` です。
- **Flyway**: 取り込んだガイドラインの例にある定番ですが、JVM が要ります。
- **down の migration を書く**: 開発中のやり直しはテンプレートの DB を作り直せば済みます。expand を戻すと書かれたデータが消え、contract は down を書いても消えたデータが戻らず、ふだん流さない down は障害の最中に初めて流して失敗する恐れがあります。

## Consequences

- 型の生成とずれの検査には、migration を流した PostgreSQL が要ります。CI ではすでに testcontainers で PostgreSQL を起動しています。
- dbmate は JS の API を持たないので、テストからは子プロセスで呼びます (`resolveBinary()` でバイナリの場所を得られます)。
- dbmate の npm 版は、install した機械の CPU の分のバイナリだけを入れます。ECS のイメージを別の CPU 向けに作るなら、pnpm の `supportedArchitectures` を書くか、動かす CPU の上でイメージを作ります。
- 楽観排他と共通カラム ([PostgreSQL のキー設計](../db/postgresql-keys.md)) の書き方、seed の中身は、サンプル機能の仕様を書くときに決めます。
- 実施は [dbmate を入れ、Better Auth の表を最初の migration にする](https://github.com/yokozi-jp/agent-software-factory/issues/188) と、Kysely の型の生成の Issue で行います。本番の migration のタスクは、CDK の stack を書くときに作ります。

## 出典

- dbmate の `transaction:false`、`--migration-lock`、`--migrations-table`、`--no-dump-schema`: [dbmate の README](https://github.com/amacneil/dbmate)。2.37.0 を PostgreSQL 17 で動かし、専用のスキーマの履歴の表、途中で失敗した migration の取り消し、2回目の `migrate` が何もしないこと、lock の有無で同時の実行がどうなるか、空の down の `rollback` が履歴だけを消すことを確かめた (2026-10-26)
- kysely-codegen の `--include-pattern`: [kysely-codegen の README](https://github.com/RobinBlomberg/kysely-codegen)
- Kysely の Migrator が lock の表を使い、`disableTransactions` が実行の全体に効くこと: kysely 0.29.7 の `dist/migration/migrator.js`
- Better Auth の `generate` が SQL を出し、`schemaName` を扱うこと: [Better Auth CLI](https://better-auth.com/docs/concepts/cli)、[PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)
- ライブラリの利用の規模と保守の状況: [Node.js ORMs, query builders and database libraries in 2026](https://www.prisma.io/dataguide/database-tools/top-nodejs-orms-query-builders-and-database-libraries) (Prisma 社の記事。数字は npm と GitHub の公開値)、npm の30日のダウンロード (2026-10-26)
