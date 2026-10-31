---
type: ADR
title: "ADR 0051: 共有 package の入口 (exports) は機能ごとに切り、各入口が触る外部ライブラリを表にする"
description: shared-kernel、db、i18n、logging、telemetry の exports を、機能ごとの入口に揃える決定。Effect のような手段を理由に入口を作らず、. は外部ライブラリを import しない契約だけにする。shared-kernel の入口の割り当て、domain が import してよい入口、lint と repo-policy で止める方法、決まっていない論点を書く。共有 package の exports を足す、変えるとき、shared-kernel に関数を足すとき、どの入口に置くか迷うときに読む。
tags: [adr, architecture, packages, exports, lint]
---

# ADR 0051: 共有 package の入口 (exports) は機能ごとに切り、各入口が触る外部ライブラリを表にする

状態: 決定 ([Issue #558](https://github.com/yokozi-jp/agent-software-factory/issues/558))。

共有 package の入口の切り方が揃っておらず、どの入口がどの外部ライブラリに触るかを、ファイルを開いて import を読むまで分かりません。`logging` と `telemetry` は `.` (契約) と `./node` (外部 SDK) に分けていますが、`db` と `i18n` は分けていません。`shared-kernel` は `.` だけで、20 以上のファイルが `kysely`、`hono`、`effect`、`zod` に触るものと触らないものを混ぜて再 export しています。目的は差し替えではなく、コードを読む負荷を下げることです。

## 決定

- **入口は機能ごとに切る**: 入口の単位は「何をする機能か」(時刻、メッセージング、冪等性) です。Effect、Kysely、Hono は手段で、入口の理由にしません。ただし 1 つの機能が DB と HTTP の両方に触るときは、`-db` と `-http` の 2 つの入口に分けます (`./idempotency-db`、`./idempotency-http`)。
- **`.` は外部ライブラリを import しない契約だけ**: 型、判別可能な union、`zod` のスキーマ。`zod` は例外として許します (`defineEvent`。`events` の package が `kysely` を引き込まないため)。`domain` の規則 (ADR 0026、0027) は変えず、`shared-kernel` から値を import せず、型の `import type` だけを許します。許す入口は `.` と `./result` です。
- **例外は表に書く**: `i18n` は外部依存が `i18next` 1 つで、使うのは `apps/web` だけなので、入口を分けず `.` に `i18next` を置きます。
- **外部ライブラリは入口の表に書く**: `shared-kernel` の入口ごとに、触る外部ライブラリを下の表と `vite.config.ts` の `sharedKernelEntries` に書きます。表にない外部ライブラリを入口が import すると、`no-restricted-imports` が止めます (`hono/client` のような subpath も止めます)。`exports` の形は repo-policy の `ownExports` が止めます。
- **Node.js 専用の入口は `./node`**: `process` や `node:*` を使う入口に限ります。外部ライブラリがあるだけでは付けません (i18next はブラウザでも動く)。
- **テスト用の道具は `./testing`**: 本番の入口に混ぜません (`logging`、`db` で既にそうしています)。

### `shared-kernel` の入口の割り当て

| 入口                 | ファイル                                                                                          | 触る外部ライブラリ                                |
| -------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `.`                  | `event.ts`                                                                                        | `zod`                                             |
| `./result`           | `result.ts`、`from-result.ts`                                                                     | `effect`                                          |
| `./time`             | `time.ts`、`api-time.ts`                                                                          | `effect`、`zod`                                   |
| `./messaging`        | `consumer.ts`、`outbox.ts`、`processed-message.ts`                                                | `effect`、`kysely`、`zod`                         |
| `./tenant-db`        | `tenant-transaction.ts`、`db-call.ts`、`common-columns.ts`、`insert-row.ts`、`optimistic-lock.ts` | `effect`、`kysely`                                |
| `./idempotency-db`   | `idempotency.ts`、`idempotency-purge.ts`                                                          | `effect`、`kysely`                                |
| `./idempotency-http` | `idempotency-http.ts`                                                                             | `hono`、`@hono/zod-openapi`                       |
| `./problem`          | `problem.ts`                                                                                      | `hono`、`@hono/zod-openapi`、`@opentelemetry/api` |

`./result` は、`Result` 型 (`domain` が `import type` で使う) と `fromResult` (`application` が使う) を、1 つの機能 (失敗の表し方) として置きます。`domain` は型だけを import するので、`effect` は実行時に読まれません。

### 他の package の入口

| package                | 入口                                      | 触る外部ライブラリ       |
| ---------------------- | ----------------------------------------- | ------------------------ |
| `db`                   | `./node` (`bootstrap`、`migrate`、`pool`) | `dbmate`、`pg`、`node:*` |
| `db`                   | `./seed`、`./testing`                     | 今のまま                 |
| `i18n`                 | `.`                                       | `i18next` (例外)         |
| `logging`、`telemetry` | 今のまま                                  |                          |

`db` は `.` を持ちません (論点 5)。

## 決まっていない論点

1. ~~**機能で切るか、外部依存で切るか**~~ (決めた): 入口は機能ごとに切り、1 つの機能が `kysely` と `hono` の両方に触るときは、機能名に `-db`、`-http` を付けて 2 つの入口に分けます (`./idempotency-db`、`./idempotency-http`)。「`hono` を import してよい入口」を lint で絞れます。`application` や worker が誤って `hono` を引き込みません。`-db` と `-http` の接尾辞は、1 つの機能が複数の外部依存に触るときだけ付けます。`./tenant-db` のように機能が DB だけに触るものは、今の名前のままにします。
2. ~~**`from-result.ts` の置き場**~~ (決めた): `result.ts` と `from-result.ts` を `src/result/` に置き、`./result` の入口にします。`Result` が `.` から離れるので、`domain` の lint は `.` と `./result` の型の import を許す形に直します。`no-restricted-imports` の `allowTypeImports` は、Oxlint 1.89.0 で `paths` と `patterns` (`regex` と `group`) のどちらでも効くことを、手元で確かめました。`import type { R }` と `import { type T }` は通り、値の import (`import { f }`) は止まります。Oxlint の `regex` は先読みを使えないので (ADR 0026)、`./result` 以外の入口 (`./time` など) を `domain` から止める pattern は、`layers` に書く入口の一覧から `^…/shared-kernel/(time|messaging|…)$` のように列挙して組み立てます。
3. ~~**`domain` の規則**~~ (決めた): 変えません。`.` に `zod` を残します。`domain` は値を import しないので、`zod` は読まれません。
4. ~~**`events` の package**~~ (決めた): `defineEvent` は `.` に残します。`events` の package は `.` だけを import し、`kysely` を引き込みません。
5. ~~**`db` と `i18n`**~~ (決めた): `db` は `bootstrap`、`migrate`、`pool` を `./node` に移し、`.` を消します。repo-policy は `exports` の最初の項目のファイルの有無を確かめるので、`db` は `src/node.ts` を見ます。`i18n` は今のまま。

## Considered Options

- **外部依存ごとに切る (`./db`、`./http`、`./effect`)**: `hono` や `kysely` を import してよい場所を lint で絞りやすい。Effect のような手段が入口の名前になり、機能が複数の入口に散る。
- **ディレクトリだけを分け、入口は `.` のまま**: `exports` と repo-policy を変えずに済む。import の書き方から外部依存が分からず、lint で境界を止められない。
- **package を分ける (純粋な `shared-kernel` と DB や HTTP の共有 package)**: 境界が強い。`moduleOrder`、`notModules`、`ownExports`、Knip、fixture の手間が package ごとに増える ([module ではない package を足す手順](../domain-model/add-package.md))。
- **`domain`/`application`/`infrastructure` の層を共有 package にも入れる**: `db` と `i18n` は中身のほとんどが外部依存の薄い包みで、`domain` が空になる。

## Consequences

- import のパス (`.../shared-kernel/messaging`) から、どの機能の何に依存するかが分かります。
- `shared-kernel` の `src/` は入口ごとのディレクトリ (`src/result/`、`src/time/` など) に分け、各ディレクトリの `index.ts` が入口です。
- `domain` の lint は、`.` と `./result` の `import type` だけを許します。ほかの入口は型でも止めます。`domain` の pattern は、入口を許す `deepImports` の否定の `group` より前に置きます (否定の `group` が一致すると、その import の検査がそこで終わるため)。
- 入口の検出力の fixture は、`packages/shared-kernel/src/__fixtures__/root-entry.ts` (`.`) と `src/<入口>/__fixtures__/library.ts` に置きます。
- 全モジュールと `apps/*` の `shared-kernel` の import を書き換えます。
- `vite.config.ts` の `no-restricted-imports`、`tools/scripts/src/checks/repo-policy/modules.ts` の `ownExports`、`knip.jsonc` の `entry`、fixture を直しました。[Issue #550](https://github.com/yokozi-jp/agent-software-factory/issues/550) (制限の表) と `shared-kernel` への改名 ([Issue #458](https://github.com/yokozi-jp/agent-software-factory/issues/458)) は main に入っています。
- 機能で切ると、入口の追加が機能の追加と同じ粒度になり、`exports` の項目が増えます。

## 出典

- [ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md): 層と公開 API の規則。
- [ADR 0028](0028-effect-in-application-and-infrastructure.md): Effect を使う層。
- [ADR 0038](0038-db-package.md)、[ADR 0044](0044-i18next-for-texts.md)、[ADR 0048](0048-opentelemetry-traces-only-with-explicit-instrumentation.md)、[ADR 0049](0049-logging-with-pino-behind-a-logger-interface.md): 各 package の入口。
- [実装の指針: 薄いラッパーの功罪](../architecture-principles/thin-wrapper.md)、[システム設計: 過剰にしない/過少にしない](../architecture-principles/over-and-under-engineering.md)。
