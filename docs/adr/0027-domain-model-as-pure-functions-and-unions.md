---
type: ADR
title: "ADR 0027: ドメインモデルは純粋な関数と判別可能な union と自作の Result で書き、throw と zod は domain に入れない"
description: packages/*/src/domain を、判別可能な union の状態、純粋な遷移の関数、__brand の値の型と型述語、自作の Result で書く決定。判別のフィールドは _tag、網羅は lint と never の両方、失敗は起きる場所で 3 つ (zod の 400、行の変換の throw、業務の規則の Result) に分け、Date と Math.random と throw は domain で止める。比べた案は zod の .brand() を domain に入れる案と、throw で業務の失敗を表す案。domain のコードを書く、直すとき、値の型や失敗の表し方を変えたくなったとき、domain に zod や throw や Effect を入れたくなったときに読む。
tags: [adr, architecture, domain-model, typescript, result, lint]
---

# ADR 0027: ドメインモデルは純粋な関数と判別可能な union と自作の Result で書き、throw と zod は domain に入れない

サンプル機能 (経費精算) の `domain` 層は、判別可能な union と純粋な関数と自作の `Result` で書きます。エージェントが業務の規則を書いても、不正な状態を作れず、分岐の漏れと失敗の握りつぶしが型検査と lint で止まるようにします。選択肢の比較は [TypeScript で関数型ドメインモデリングを書く方式と library を比べる](https://github.com/yokozi-jp/agent-software-factory/issues/219) の調査 ([`research/functional-domain-modeling.md`](https://github.com/yokozi-jp/agent-software-factory/blob/research/functional-domain-modeling/research/functional-domain-modeling.md)、commit `41dda0a`) に、決定は [ドメインモデルの書き方（関数型ドメインモデリング）を決める](https://github.com/yokozi-jp/agent-software-factory/issues/220) の解決コメントにあります。書き方の手順は [docs/domain-model/](../domain-model/index.md) に、Effect の使い方は [ADR 0028](0028-effect-in-application-and-infrastructure.md) にあります。この ADR は ADR 0020、0025、0026 を変えず、ADR 0026 に規則を足します。

## ルール

- **状態** (Q1): 状態は `_tag` を持つ判別可能な union にします。真偽値と省略可能なフィールドで状態を表しません。遷移の関数は、受け取る型を遷移できる状態に絞ります。
- **純粋さ** (Q3): `domain` は純粋な関数だけにします。現在時刻と ID は引数で受け、新しい状態と出来事を値で返します。保存と通知は `application` と `infrastructure` が行います。
- **値の型** (Q7): 値の型は `string & { readonly __brand: "X" }` の交差型と、claim を検証する型述語 (`isX(input): input is X`) で書きます。型を作る `as` は書きません。`domain` は何も import しません ([ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md) のまま)。`http` の zod は、spec のための制約 (`.int().positive()` など) と `.refine(isX)` で `domain` の型を得ます。zod の `.brand()` は `domain` に入れません。
- **構成で表す型**: 空でない配列は `[T, ...T[]]` のように、不正な値を作れない形で書きます。`T[]` のまま全ての操作が全域なら強くしません。`!` や `as` や「起きない」はずの `throw` が要るときに強くします。
- **判別のフィールド** (Q20): 状態、失敗、出来事のすべてで `_tag` を使います。`kind` や `type` は使いません。
- **網羅** (Q21): `switch-exhaustiveness-check` ([ADR 0020](0020-typescript-strictness.md)) と、default の `const _exhaustive: never = x` の両方で確かめます。lint の規則が外れても型検査が止めます。
- **`satisfies`**: 設定や定数は `as` ではなく `satisfies` で型を確かめます。
- **関数の引数**: 引数が 2 つ以上なら object で受けます。呼び出しの順序の間違いを防ぐためです。
- **失敗は起きる場所で 3 つに分ける** (Q8):

  | 失敗                                    | 表し方                      | 応答                           |
  | --------------------------------------- | --------------------------- | ------------------------------ |
  | API の入力が型に合わない                | `http` の zod               | 400                            |
  | DB の行が `domain` の型にならない       | `infrastructure` の `throw` | 500                            |
  | 業務の規則を満たさない (回復できる失敗) | `domain` が `Result` で返す | 失敗の `_tag` ごとの 422 (Q11) |

  `throw` は `infrastructure` の `parseX` だけに置きます。`domain` では `throw` を止めます。

- **`Result`** (Q9): `Result` の型は `shared` に置き、`domain` は `import type` で使います。値は `{ _tag: "Ok", value }` / `{ _tag: "Err", error }` の object literal で作り、`ok()` と `err()` は置きません。
- **業務の失敗の応答** (Q11): `http` が失敗の `_tag` ごとに 422 の Problem Details にします ([ステータスコード](../web-api/status-codes.md)、[レスポンスボディ](../web-api/response-body.md))。
- **時刻と乱数** (Q23): `domain` では `Date` の値 (`new Date()`、`Date.now()`)、`Temporal.Now`、`Math.random` を止めます。`Date` と `Temporal.Now` は `domain` だけでなく `apps/api/src` と `packages/*/src` の全体で止めます ([ADR 0043](0043-instants-in-utc-business-calendar-in-tokyo-with-temporal.md))。時刻の型は `Temporal.Instant` と `Temporal.PlainDate` で、自前の branded の `Instant` は作りません。`domain` の override の `no-restricted-globals` (`Date`) と `no-restricted-properties` (`Temporal.Now`、`Math.random`) が止めます ([ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md)、[Issue #259](https://github.com/yokozi-jp/agent-software-factory/issues/259))。`crypto` などは `packages/*/tsconfig.json` の `types: []` で型検査が止めます。
- **`domain` の `throw`** (Q10): 自作の Oxlint の plugin ([ADR 0019](0019-custom-oxlint-plugin-for-xss.md) と同じ形、`tools/lint-plugins/src/domain-plugin.ts` の `domain/no-throw`) で止めます ([Issue #259](https://github.com/yokozi-jp/agent-software-factory/issues/259))。
- **嘘をつく型述語** (Q12): 新しいゲートは足しません。`domain` の変異テストのゲートと、[境界値のテストのガイド](../domain-model/testing.md)で補います ([テストの強さの基準を決める](https://github.com/yokozi-jp/agent-software-factory/issues/30) の決定 3、4)。
- **識別子の言語** (Q22): `domain` と `application` の識別子は英語にし、`GLOSSARY.md` の言葉との対応表を [docs/domain-model/](../domain-model/glossary-mapping.md) に置きます。DB の列、URL、OpenAPI、library の名前と揃うためです (判断)。用語集には実装の詳細を書きません。
- **この ADR が決めないこと** (Q5): 状態の粒度 (申請中を 2 段に分けるか)、下書きの明細の要否、集約の境界は、サンプル機能の仕様で決めます。ここで決めるのは書き方の流儀だけです。

## pstack の規則との違い

規則は、Cursor の pstack の `typescript-best-practices` ([cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack/skills/typescript-best-practices)、commit `99b609a`、MIT) から選びました (Q6、Q13)。skill は写さず、選んだ規則を `docs/domain-model/` に書き、`fileMatch` の steering から案内します。

| pstack の規則                              | ここでの扱い                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 判別可能な union (`kind`)                  | 採る。判別のフィールドは `_tag` (Q20)                                                      |
| Branded types (`__brand`、型述語)          | 採る。`parseX` の `throw` は `infrastructure` だけ。`domain` は `throw` を止める           |
| Constructive modeling、Simplest total type | 採る                                                                                       |
| `unknown` over `any`、No `as` casts        | 採る                                                                                       |
| Schemas before guards (zod で型を導く)     | 変える。zod は `http` だけ。`domain` の型は型述語で作り、`http` が `.refine(isX)` で受ける |
| Narrowing hierarchy、Type guards           | 採る                                                                                       |
| Exhaustiveness (`never`)                   | 採る。`switch-exhaustiveness-check` と併用 (Q21)                                           |
| `satisfies` over `as`、Object args         | 採る                                                                                       |
| Real tests、Structured telemetry           | 採らない。この ADR は `domain` の書き方だけを決める                                        |

skill をそのまま見せないのは、`parseX` が `throw` する例と「Schemas before guards」が、この ADR と食い違うからです。食い違う 2 つの指示を同時にエージェントに見せません。

## Considered Options

- **zod の `.brand()` を `domain` に入れる**: 検証と型を 1 つの schema に持てます。ただし `domain` が zod を import することになり、「`domain` は何も import しない」(ADR 0026) を崩します。zod の `.optional()` は `exactOptionalPropertyTypes` ([ADR 0020](0020-typescript-strictness.md)) を緩めます。型述語と `.refine(isX)` なら、`domain` の型が `c.req.valid` まで `as` なしで届き、`.int().positive()` を書けば OpenAPI に制約が出ることを試作で確かめました。後から `.brand()` に移すには lint を緩めるだけで済みます (判断)。
- **`throw` で業務の失敗を表す**: 書きやすい方式です。ただし、4xx への対応の書き忘れを止めるセンサーがありません。回復できる失敗だけを `Result` にする考え方は、Wlaschin の [Against Railway-Oriented Programming](https://fsharpforfunandprofit.com/posts/against-railway-oriented-programming/) と Rust Book の 9 章に従います。
- **`Result` の library (neverthrow など) を `domain` に入れる**: `domain` が library を import することになります。型だけを `shared` に置けば足ります (Q9)。形は TC39 の [try 演算子の提案](https://github.com/arthurfiorette/proposal-try-operator) (Stage 0) と同じです。

## Consequences

- `domain` は、時刻、乱数、`throw`、library、他のモジュールを持てません。必要なものは引数で受けるか、`application` に置きます。
- 業務の失敗の `_tag` を足したら、`http` の 422 への対応も足します。`switch` の網羅が漏れを止めます。
- 型述語が claim を検証しているかは、型検査では確かめられません。境界値のテストで確かめます。
- `domain` の `throw` (Q10)、`Date` の値、`Temporal.Now`、`Math.random` (Q23) は `vp check` が止め、`Result` の型 (Q9) は `shared` の `src/result.ts` にあります ([Issue #259](https://github.com/yokozi-jp/agent-software-factory/issues/259))。止まらない書き方があります。型の注釈の `Date` は止まりません。`globalThis.Date.now()` のようにグローバルオブジェクトを通した `Date` は、ADR 0043 で `no-restricted-properties` に `globalThis.Date` と `globalThis.Temporal` を足して止めるようにしました。Q7、Q8 のうち、この検査で止められないことは、このガイドとレビューで守ります。
- `Result` を Effect に変える `fromResult` と、Effect の使い方は [ADR 0028](0028-effect-in-application-and-infrastructure.md) で決めます。

## 出典

- 試作 (`/tmp/fdm`: zod 4.6.7、`@hono/zod-openapi` 1.6.3、TypeScript 7.0.2、Oxlint 1.89.0、ADR 0020 と同じ tsconfig、2026-10-26): `.refine` と `.transform` で `as` なしに型が届くこと、`.int().positive()` が OpenAPI に出ること、`domain` の `throw` を止める 5 行の規則が動くこと、型の注釈の `Date` は `no-restricted-globals` に掛からないこと
- `domain` の `Date`、`Math.random`、`throw` の検査 (Oxlint 1.89.0、Vite+ 1.4.0、このリポジトリで確かめた、2026-10-27): `new Date()`、`Date.now()`、`d instanceof Date` と、`Math.random()`、`Math["random"]()`、`const { random } = Math` は止まる。型の注釈の `Date` と、`globalThis.Date.now()` は止まらない。`throw` は `domain/no-throw` が止める。`packages/module-fixtures/src/domain/__fixtures__/purity.ts` が、止まる書き方を disable のコメントで、止まらない 2 つ (型の注釈の `Date`、`globalThis.Date.now()`) をコメントなしで置き、`vp check` で確かめる
- Effect 4 の `Result`、`Option`、`Exit`、`Data.TaggedError` が `_tag` を使うこと: [MIGRATION.md](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md) (`catchTag` は unchanged)
- 400 と 422 の使い分け: [`docs/web-api/status-codes.md`](../web-api/status-codes.md)
