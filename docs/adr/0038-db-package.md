---
type: ADR
title: "ADR 0038: migration と DB の道具は module ではない package の packages/db に置き、モジュールには型だけで依存する"
description: apps/api/db にあった migration、bootstrap.sql、migrate、型の生成と、DB だけのテストの道具を packages/db (@agent-software-factory/db) に移す決定。ADR 0034 の手順に沿って、db を module ではない package にし、moduleOrder にも依存なしの一覧にも入れず、モジュールには import type だけで devDependencies に依存し、db に依存できるのは apps/api だけにする。exports は "." と ./seed と ./testing の 3 つで、層の規則と lint-effect は掛けず、packages/db/src ではランタイムの制限を外して深い import の禁止とモジュールの値の import の禁止を残す。migration や DB のテストの道具を足すとき、ワーカーやバッチが migration を使うとき、db の依存や exports を変えるとき、packages/ の直下に module ではない package を足すときに読む。
tags: [adr, db, migration, monorepo, repo-policy, lint]
---

# ADR 0038: migration と DB の道具は module ではない package の packages/db に置き、モジュールには型だけで依存する

DB の道具は `apps/api/db/` (migration、`bootstrap.sql`、`migrate.ts`、`types.ts`) と `apps/api/test/` (testcontainers の起動、接続、DB の複製) にありました。[ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md) の「`apps/api` は薄い入口」から外れ、ワーカーやバッチ、migrate のタスク ([ADR 0013](0013-api-on-ecs-and-lambda-web-functions.md)) が migration を使うには `apps/api` を通るしかありませんでした。`migrate.ts` と `types.ts` は `apps/api` の coverage の対象 (`src/**/*.ts`) の外にありました。そこで [ADR 0034](0034-shared-ui-package.md) と同じく、`packages/` の直下に module ではない package を足します ([Issue #333](https://github.com/yokozi-jp/agent-software-factory/issues/333) の決定、[Issue #337](https://github.com/yokozi-jp/agent-software-factory/issues/337))。

## 決定

- **配置**: `packages/db` (`@agent-software-factory/db`、Nx project 名は `db`) に置きます。
  - `migrations/*.sql` と `bootstrap.sql`: package の直下。
  - `src/migrate.ts` (入口 `migrate`)、`src/bootstrap.ts` (`bootstrapSql`)、`src/types.ts` (型の生成の CLI と、ずれを見つける関数)。
  - `src/testing/`: `connection.ts`、`credentials.ts`、`prepare-database.ts`、`database.ts`、globalSetup の失敗の表示 (`global-setup.ts`)、競合の待ち合わせ (`await-blocked.ts`) と行数の前後比較 (`row-counts.ts`。[競合と原子性のテストの書き方](../db/concurrency-testing.md))。
  - `src/seed/`: [Issue #332](https://github.com/yokozi-jp/agent-software-factory/issues/332) が中身を置く。今は `./seed` の exports を満たす空のファイルだけ。
  - `src/testing/postgres-container.ts`: `startPostgres()` が、テスト用の PostgreSQL を `fsync`、`synchronous_commit`、`full_page_writes` を off にして起動します。`apps/api` と `db` の globalSetup が使います。使い捨ての DB なので、ディスクへの同期書き込みを待たないためです ([PostgreSQL 公式の Non-Durable Settings](https://www.postgresql.org/docs/17/non-durability.html))。OS が落ちたときにデータが壊れるだけで、ロックとトランザクションの分離、実行計画は変わりません。`packages/db` のテストの所要時間は、負荷が高いマシンで 2 回の測定で 15〜25% 短くなりました。tmpfs と `shared_buffers` の増量は、同じ測定で上乗せがなかったので使いません。本番に近い既定のまま起動するのは、型の生成 (`src/types.ts`) と migration のテスト (`migrate.test.ts`) です。
  - `apps/api/test/` には、`apps/api` のコードを試す道具 (テスト用 IdP の `oidc-provider.ts`、`auth-fixtures.ts`、`browser.ts`、`server-process.ts`、IdP のユーザー) を残します。`apps/api/test/global-setup.ts` は `@agent-software-factory/db/testing` の `prepareDatabase` を呼びます。
- **exports**: `"."` (`migrate` と `bootstrapSql`)、`"./seed"`、`"./testing"` の 3 つ。faker、testcontainers、Vitest を、本番のコードが import する `"."` に持ち込まないために分けます。repo-policy が形を確かめます。
- **依存**:
  - `db` はモジュール (`claim`、`approval`、`closing`) に `import type` だけで依存し、`devDependencies` に書きます。`dependencies` に書いた module、`shared` や `ui`、`apps/*` への依存は repo-policy が止めます。
  - 実行時に要る `dbmate` と `pg` は `db` の `dependencies`、`kysely-codegen` と testcontainers は `devDependencies` に置きます。
  - `db` に依存できるのは `apps/api` だけです (repo-policy が、ほかのすべての `package.json` を確かめます)。モジュール、`shared`、`apps/web`、`tools/*` は `db` に依存しません。
- **`moduleOrder` と依存なしの一覧**: `db` はどちらにも入れず、`modules.ts` の `dbDependencies` が上の規則で見ます。`moduleOrder` は module の方向を決める表で、`db` はその中のどこにも置けません。依存なしの一覧は「workspace の package に依存しない」という意味で、`db` はモジュールに依存します。
- **層の規則と Effect**: `db` は業務のコードを持たず、層に分けません。層の override は `packages/*/src/<layer>/**` だけに掛かるので届きません。`lint-effect` の script も求めません。
- **Oxlint**: `packages/db/src/**` では、入口のファイルと同じく ADR 0007 のランタイムの制限 (`process` など) と `import/no-nodejs-modules` を外します。migration を流す `child_process` と、テストの `process` を使うためです。深い import の禁止は残します。workspace の package からの値の import は `no-restricted-imports` の `allowTypeImports` で止め、`import type` だけを通します。`packages/db/src/__fixtures__/imports.ts` が、値の import が止まること、`import type` と `node:child_process` が通ることを確かめ、repo-policy がその fixture の有無を確かめます。
- **テストの道具の import**: `apps/api/src` の本番のコードは `@agent-software-factory/db/testing` と `./seed` を import できません (深い import として止まります)。`apps/api/src/**/*.test.ts` だけが、この 2 つの subpath を import できます。
- **Nx の target**: `db:migrate`、`db-types`、`db-types-check`、`test`、`check` は `db` の project にあります。`db-types` は `pnpm exec nx db-types db`。`test` は Vitest で、PostgreSQL のコンテナを起動する globalSetup を `db` が持ちます。ファイルごとの coverage の下限 (lines と branches が 90%) を `db` にも掛けます。全体の下限のラチェットは掛けません。`import.meta.main` の CLI の部分は、テストが関数を呼ぶので coverage の対象から外します (`/* v8 ignore */`)。
- **残すテスト**: `tenant-transaction.test.ts` と `databases.ts` は `apps/api` のコード (`createModuleDatabases`) を試すので、`apps/api` に残します。`migrate.test.ts` と `types.test.ts` は `db` に移しました。

## Considered Options

- **`apps/api` に置いたままにする**: ワーカーやバッチが `apps/api` に依存するか、コピーになります。ADR 0026 の「`apps/api` は組み立てるだけ」から外れたままです。
- **`db` を module として `moduleOrder` に入れる**: module は業務の機能で、層を持ち、モジュールに依存されます。`db` は逆に、モジュールの型に依存し、モジュールからは依存されません。入れると「どの module の後ろか」という意味のない問いが生まれます。
- **`db` がモジュールに `dependencies` で依存する**: `db` の実行時のコードはモジュールを使いません。型だけなので `devDependencies` にし、値の import は Oxlint で止めます。
- **testing を別の package (`db-testing`) にする**: faker と testcontainers を本番の入口から分けるだけなら、exports の分割で足ります。package を増やすと、`moduleOrder` のような規則がもう 1 つ要ります。

## Consequences

- migration を足すときは `packages/db/migrations/` に書き、`pnpm exec nx db-types db` で型を生成し直します ([PostgreSQL のマイグレーション](../db/postgresql-migration.md))。
- ワーカー、バッチ、migrate のタスクは `@agent-software-factory/db` の `migrate` を import できます。本番の入口の形 (rds-signer、bootstrap、dbmate の 2 段、イメージへの入れ方) は、サンプル機能とインフラの spec で決めます。
- `packages/` の直下に module ではない package を足すときは、ADR 0034 と同じく、`moduleOrder`、`exports`、層の規則、`lint-effect` をどうするかを決め、`tools/scripts/src/checks/repo-policy/modules.ts` に書きます。
- `db:seed` の Nx target は、まだ seed がないので持ちません。seed を実装する [Issue #332](https://github.com/yokozi-jp/agent-software-factory/issues/332) が足します。
- seed ([Issue #332](https://github.com/yokozi-jp/agent-software-factory/issues/332)) を実装するとき、`src/seed/` を coverage の除外から外し、`knip.jsonc` の `packages/db` の `ignoreDependencies` から、使ったモジュールを外します。

## 出典

- [ADR 0034](0034-shared-ui-package.md): module ではない package を足す手順 (`moduleOrder`、`exports`、層の規則、`lint-effect`)
- [Issue #333](https://github.com/yokozi-jp/agent-software-factory/issues/333) の解決コメント: `packages/db` に移す決定
