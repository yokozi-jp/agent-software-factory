---
type: Runbook
title: Effect の検査
description: application と infrastructure の Effect を、effect-tsgo (lint-effect の Nx target) と vite.config.ts の規則で検査する手順。実行し忘れ、Effect 3 の API、unstable と experimental の API、実行の関数、使わないと決めた機能を止める仕組み、止まったときの直し方、disable コメントの書き方、検査が見ないものを定める。lint-effect が失敗したとき、vp check が Effect の規則で止まったとき、Effect の検査を足す、変える、effect-tsgo や Oxlint を更新するときに読む。
tags: [tooling, runbook, effect, lint, oxlint, effect-tsgo]
---

# Effect の検査

[ADR 0028](../adr/0028-effect-in-application-and-infrastructure.md) の決定を、2 つの道具で止めます。どちらも `application` と `infrastructure` が対象です。

| 道具                                         | 実行                       | 止めるもの                                                                                                                                                                                  |
| -------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| effect-tsgo (`oxlint.effect.json`)           | `lint-effect` の Nx target | 実行し忘れた Effect (`floating-effect`)、Effect 3 の API (`outdated-api`)、`@stability unstable` の API (`unstable-api-usage`)、`@stability experimental` の API (`experimental-api-usage`) |
| Oxlint の規則 (`vite.config.ts`、`vp check`) | `check` の Nx target       | Effect の実行の関数 (`no-restricted-properties`)、使わないと決めた機能の import (`no-restricted-imports`)                                                                                   |

effect-tsgo の規則は、型を読んで `Effect` を見分け、`@stability` の印を読みます。`vp check` の Oxlint は `effecttsgo` の plugin を読み込まないので、この 4 つの規則は `vp check` では動きません。逆に `vite.config.ts` の規則は、構文と import の名前だけを見ます。

## 実行する

```sh
pnpm exec nx run-many -t lint-effect        # すべての package
pnpm exec nx run claim:lint-effect          # 1 つの package
```

`lint-effect` は各 package の `package.json` の script で、`effect-tsgo oxlint --type-aware -c ../../oxlint.effect.json src/application src/infrastructure` を実行します (`shared` は `src` 全体)。CI の `nx` の job (`nx affected -t lint-effect`) と、pre-commit の `lint-effect` が実行します。

- `effect-tsgo oxlint` は、入れた Oxlint (Vite+ が持つもの) と oxlint-tsgolint に、`effecttsgo` の plugin を足して実行します。`effect-tsgo patch` は `node_modules` を書き換えるので使いません。
- `oxlint.effect.json` は、`effecttsgo` の 4 つの規則だけを error にします。`categories.correctness` を `off` にするのは、plugin の他の correctness の規則が warning で入るためです。規則を足すときは、`rules` に 1 行足します。
- `reportUnusedDisableDirectives` を error にしているので、使われない `oxlint-disable` のコメントでも失敗します。

## 止まったとき

| 規則                       | 意味                                                                                                                                                                           | 直し方                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `floating-effect`          | Effect を作ったが、`yield*` も代入もしていない。実行されない                                                                                                                   | `yield*` で呼ぶ。実行は `http`、入口、テストでだけ行う (ADR 0028)                                                                   |
| `outdated-api`             | Effect 3 の名前 (`catchAll`、`fork` など)                                                                                                                                      | メッセージの `Renamed to ...` の名前にする。改名の一覧は [MIGRATION.md](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md) |
| `unstable-api-usage`       | `@stability unstable` の API。版の間で壊れうる                                                                                                                                 | 使わない。同じ役割の道具が決まっていないか ADR 0028 の表を見る                                                                      |
| `experimental-api-usage`   | `@stability experimental` の API                                                                                                                                               | 同上                                                                                                                                |
| `no-restricted-properties` | `application` や `infrastructure` が `runPromise` などを呼ぶ                                                                                                                   | Effect を返して、呼び出し側で実行する                                                                                               |
| `no-restricted-imports`    | `Schema`、`Logger`、`Config`、`Schedule`、`Stream`、`Queue`、`Fiber` (`FiberHandle` などを含む)、`effect/http`、`effect/http-api`、`effect/sql`、`@effect/sql*` を import した | 検証は zod、ログは stdout、再試行は ky と SDK、DB は Kysely を使う                                                                  |

`Context.Tag` (Effect 3) のように、4.x の型に存在しない名前は `outdated-api` ではなく、`vp check` の型検査が `Property 'Tag' does not exist` で止めます。

抑えるときは、その行の前に理由つきの disable コメントを書きます (ADR 0026 と同じ形)。`oxlint-disable-next-line effecttsgo/floating-effect -- 理由`。

## 検出力の確かめ方

規則が外れたり、対象の層に届かなくなったりしたら失敗するように、2 つの仕組みがあります。

- **fixture**: モジュールの形をした `packages/module-fixtures` の `application/__fixtures__/` と `infrastructure/__fixtures__/` に、違反の行と disable コメントを置きます。規則が止めないと、disable コメントが使われないので失敗します。設定 (`oxlint.effect.json`) はすべてのモジュールで同じなので、1 つで足ります。各モジュールが同じ範囲を lint することは、repo-policy が `lint-effect` の script で確かめます ([ADR 0026](../adr/0026-modules-as-packages-with-oxlint-boundaries.md))。
  - `effect-tsgo.ts`: `floating-effect`、`unstable-api-usage`、`experimental-api-usage`。`lint-effect` が検査します。`vp check` は `effecttsgo` の plugin を知らず、コメントを使われないものと報告するので、このファイルを読みません (`vite.config.ts` の `lint.ignorePatterns`)。
  - `effect.ts`: `no-restricted-properties`、`no-restricted-imports`。`vp check` が検査します。
  - repo-policy が、層ごとに 2 つのファイルと、それぞれの disable コメントがあることを確かめます。
- **テスト**: `outdated-api` は fixture にできません。1 つ使うと報告が 2 つ出て、1 つはファイルの 1 行 1 列で、どの disable コメントも届きません (2026-10-28、`effect-tsgo` 0.61.0 で確かめた)。そこで `tools/scripts/src/checks/effect-lint/config.tools.test.ts` が、sandbox の小さな project に Effect 3 の名前を書いたファイルを置き、`oxlint.effect.json` で失敗する (exit 1 と規則の名前) ことを確かめます。`floating-effect` も同じテストが確かめます。

## 検査が見ないもの

- `http`、`apps/api`、テストでは、`lint-effect` を実行しません。そこで Effect を実行する配線は、サンプル機能の仕様で入れます。入れたら対象に足します。
- `no-restricted-properties` は、`.runPromise` のような**プロパティの名前**を見ます。`Effect` を別の名前で import しても、実行環境を変数に持っても止まります。`import { runPromise } from "effect/Effect"` は、`no-restricted-imports` が名前で止めます。止まらないのは、分割代入 (`const { runPromise } = Effect`) と、文字列の添字 (`Effect["runPromise"]`) です。
- 使わない機能の禁止は、import の名前で止めます。`Effect.retry` のように、使わない `Schedule` を渡さずに呼べる関数は止めません。

## 版の結び付き

`@effect/tsgo` の各版は、対応する Oxlint と oxlint-tsgolint の版の範囲を、README の冒頭の表に持ちます (0.61.0 は Oxlint 1.87〜1.89、oxlint-tsgolint 7.0.2004〜2005)。Vite+ の更新が範囲を外れると、`effect-tsgo oxlint` が動かなくなるおそれがあります。そのため Renovate は `@effect/tsgo` と Vite+ を 1 つの PR にまとめます (`renovate.jsonc`)。その PR で `lint-effect` と `test-tools` が通ることを確かめてから merge します。

## 確かめたこと

2026-10-28、Effect 4.0.6、@effect/tsgo 0.61.0、Oxlint 1.89.0。

- `effect-tsgo oxlint` は `oxlint-disable-next-line effecttsgo/<規則> -- 理由` に従い、使われない disable のコメントを `reportUnusedDisableDirectives` で報告する。
- `no-restricted-properties` は、`import { Effect } from "effect"` の `Effect.runPromise` と、型だけが分かる変数 (`runtime.runPromise`) の両方を止める。型の注釈の中のプロパティ名 (`{ runPromise: ... }`) は止めない。
- `Effect.withErrorReporting` (`@stability unstable`) と `Schema.DomainName` (`@stability experimental`) を、`unstable-api-usage` と `experimental-api-usage` が止める。
