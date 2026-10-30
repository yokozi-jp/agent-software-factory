---
type: Runbook
title: モジュールを足す手順
description: サンプル機能のモジュール (packages/ の package) を既存のモジュールを写して足す手順と、足し忘れを repo-policy と型の生成のテストのどれが止めるか、止めないものは何かを書く。モジュールを足すとき、repo-policy の「type:module」の失敗が出たときに読む。
tags: [domain-model, runbook, modules, nx]
---

# モジュールを足す手順

モジュールの雛形を作る generator は置かず、既存のモジュールを写して足します ([ADR 0026](../adr/0026-modules-as-packages-with-oxlint-boundaries.md))。
写して登録を忘れた箇所のうち、機械で止められるものは repo-policy (`tools/scripts/src/checks/repo-policy/modules.ts`) と `packages/db/src/types.test.ts` が止めます。

## 手順

`<name>` はモジュールの英語名で、`GLOSSARY.md` のモジュールの名前と同じです。迷ったら、最後のモジュール (`packages/claim` など、依存の向きで一番後ろのもの) を写します。

1. **package を写す**: `packages/<name>/` を、`package.json`、`tsconfig.json`、`src/index.ts`、`src/infrastructure/database.ts`、`src/infrastructure/transaction.ts`、`src/infrastructure/__fixtures__/database.ts` ごと写し、名前を直します。
   - `package.json` の `name` は `@agent-software-factory/<name>`、`nx.name` は `<name>` にします。`exports` と、`check` と `lint-effect` の script は写したままにします。
   - `nx` に `"tags": ["type:module"]` を付けます。この印が、モジュールの見分け方です。`packages/shared` と `packages/module-fixtures` には付けません。
   - 依存してよいモジュールを `workspace:*` で書きます。向きは「締め → 承認 → 申請」です。
   - `index.ts` は、データベースの型 (`<Name>Database`) を export します。`infrastructure/database.ts` は `Kysely<DB>` の型です。`infrastructure/transaction.ts` は、トランザクションの tag (`<Name>Tx`、`static readonly module`) で、`index.ts` が export します ([PostgreSQL のクライアント管理](../db/postgresql-client.md))。`db.gen.ts` は手順 6 で生成します。
   - `__fixtures__/database.ts` は、ほかのモジュールの表へのクエリが型エラーになる `@ts-expect-error` です。
2. **events の package を足す**: 既存のモジュールの `packages/<name>/events/` (`package.json`、`tsconfig.json`、`src/index.ts`) を写します。モジュールが外へ送るイベントのスキーマを置く、モジュールの中の入れ子の package です ([ADR 0026](../adr/0026-modules-as-packages-with-oxlint-boundaries.md))。
   - `package.json` の `name` は `@agent-software-factory/<name>-events`、`nx.name` は `<name>-events` にします。`exports` は `"."` だけ、`check` の script は写したままにします。`nx.tags` と `lint-effect` の script は付けません。events の package はモジュールではありません。
   - 依存は `zod` と `shared` だけです。ほかの events の package にも依存しません。
   - `pnpm-workspace.yaml` の `packages/*/events` が入れ子の package を workspace に入れるので、足すものはありません。
   - `knip.jsonc` の `workspaces` に、`"packages/<name>/events": { "ignoreDependencies": ["zod", "@agent-software-factory/shared"] }` を足します。スキーマを書いて `zod` と `shared` を使ったら、この項目を消します。
   - ほかのモジュールがこのモジュールのイベントを受けるときは、その `package.json` の `dependencies` に `@agent-software-factory/<name>-events` を `workspace:*` で足します。モジュールは、どのモジュールの events の package にも依存できます。モジュール本体への依存の向きは変わりません。
3. **`moduleOrder` に足す**: `tools/scripts/src/checks/repo-policy/modules.ts` の `moduleOrder` を、依存の向き (先頭が一番手前) に合わせて足します。
4. **`apps/api` に登録する**:
   - `apps/api/package.json` の `dependencies` に `"@agent-software-factory/<name>": "workspace:*"` を足します。
   - `apps/api/src/db/databases.ts` で、型を import して `ModuleDatabases` と `createModuleDatabases` に足します。
   - `apps/api/src/app.ts` で、パッケージを import します。
5. **migration で `CREATE SCHEMA <name>;` を足す**: `packages/db/migrations/` に、前向きの migration を新しく書きます ([ADR 0025](../adr/0025-kysely-and-dbmate-sql-first.md))。既存の migration は書き換えません。
6. **型を生成する**: `pnpm exec nx db-types db` を実行し、`packages/<name>/src/infrastructure/db.gen.ts` を commit します。
7. **`knip.jsonc` を直す**: `effect` を使うコードがまだないモジュールは、`workspaces` に `"packages/<name>": { "ignoreDependencies": ["effect"] }` を足します。`packages/db` の `ignoreDependencies` にも、`packages/db/package.json` の `devDependencies` に足したモジュールの名前を足します。
8. **`GLOSSARY.md` の「モジュール」の名前を足す**。
9. **`pnpm install` を実行する**: workspace の依存を `node_modules` に反映します。

## どれが止めるか

| 足し忘れ                                                                                      | 止めるもの                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nx.tags` に `type:module` がない                                                             | repo-policy (`moduleOrder` の名前に tag の付いた package がない)。migration でスキーマも足していれば、`types.test.ts` (migration が作るスキーマと型を生成するスキーマの照合) |
| events の package がない、または `zod` と `shared` 以外に依存している、`type:module` を付けた | repo-policy                                                                                                                                                                  |
| `moduleOrder` にない                                                                          | repo-policy                                                                                                                                                                  |
| `apps/api/package.json` の `dependencies` にない                                              | repo-policy                                                                                                                                                                  |
| `databases.ts`、`app.ts` が import していない                                                 | repo-policy (import の文を文字列で探すので、使っているかは見ない)                                                                                                            |
| migration の `CREATE SCHEMA` がない、または tag を付け忘れた                                  | `types.test.ts` (DB のスキーマ = tag のあるモジュール + `auth` + `migrations`)                                                                                               |
| `db.gen.ts` を生成し忘れた、migration とずれた                                                | CI の「DB types match the migrations」                                                                                                                                       |
| 依存の向きが逆                                                                                | repo-policy (`package.json` の依存)、型の検査                                                                                                                                |
| `package.json` の `name`、`exports`、`nx.name`、`check` と `lint-effect` の script            | repo-policy                                                                                                                                                                  |
| `knip.jsonc`                                                                                  | Knip (使わない依存は、`ignoreDependencies` が要るとき、またはいらなくなったときに失敗する)                                                                                   |
| `GLOSSARY.md` のモジュールの名前                                                              | 止まらない。見直す                                                                                                                                                           |
| `ModuleDatabases` と `createModuleDatabases` に足し忘れ                                       | 止まらない。`databases.ts` が import していても、型の項目は検査しない。見直す                                                                                                |

repo-policy の失敗は、この文書を指します。
