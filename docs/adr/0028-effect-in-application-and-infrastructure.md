---
type: ADR
title: "ADR 0028: Effect 4 は application と infrastructure の限られた機能だけで使い、実行は入口に集め、検査は @effect/tsgo で行う"
description: Effect 4 を packages/*/src の application と infrastructure だけで使い、使う機能と使わない機能を表で決め、ManagedRuntime を入口ごとに 1 つ作り、Kysely を Effect.tryPromise で包み、DB の故障は defect にし、実行し忘れと v3 と unstable の API を effect-tsgo と Oxlint で止める決定。@effect/tsgo と Oxlint と tsgolint の版の結び付きも書く。比べた案は Effect を採らない案、domain に effect/Result を許す案、domain が Effect を返す案、@effect/sql-pg、Pure DI。Effect を使うコードを書く、Effect の機能や版を足す、変えるとき、domain や http に Effect を入れたくなったときに読む。
tags: [adr, architecture, effect, typescript, lint, application, infrastructure]
---

# ADR 0028: Effect 4 は application と infrastructure の限られた機能だけで使い、実行は入口に集め、検査は @effect/tsgo で行う

`application` と `infrastructure` は Effect 4 で書きます。依存と失敗が型に出て、エージェントの書く `application` の形が揃うためです (判断)。使う機能は限り、`domain` と `http` には入れません。この ADR は [ADR 0027](0027-domain-model-as-pure-functions-and-unions.md) の `domain` の書き方を前提にします。決定は [ドメインモデルの書き方（関数型ドメインモデリング）を決める](https://github.com/yokozi-jp/agent-software-factory/issues/220) の解決コメントにあり、書き方の手順は [docs/domain-model/](../domain-model/application-effect.md) にあります。ADR 0025 (Kysely) と 0023 (ky と SDK の再試行) は変えません。

## ルール

- **使う層** (Q4): Effect は `application` と `infrastructure` だけで使います。`domain` は import しません ([ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md))。`http` は Hono と zod のままにし、Effect の実行の関数を呼ぶ入口にします。
- **使う機能と使わない機能** (Q4、Q26):

  | 区分         | 機能                                                                                                                                                                                                |
  | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 使う         | `Effect.gen`、`Effect.fn`、`succeed`、`fail`、`fromResult`、`tryPromise`、`promise`、`Data.TaggedError`、`catchTag`、`Context.Service`、`Layer`、`acquireUseRelease`、`ManagedRuntime` と実行の関数 |
  | 使わない     | `Schema`、`effect/http`・`effect/sql` などの unstable の module、`@effect/sql-pg`、`Logger`、`Config`、`Schedule` の再試行、`Stream`、`Queue`、`Fiber`                                              |
  | 実施で決める | Tracer と `@hono/otel` の span のつなぎ方 ([Issue #148](https://github.com/yokozi-jp/agent-software-factory/issues/148))                                                                            |

  使わない機能の理由は、同じ役割をすでに決めているからです。検証は zod (`http`)、ログは stdout、再試行は ky と SDK ([ADR 0023](0023-ky-for-external-http-and-sdk-retries-for-aws.md)) で、Effect で書くと二重になります。`@stability unstable` と `experimental` の API は使いません。4.0 で unstable の module のパスから `unstable` が外れ、`@stability` の印でしか見分けられないためです ([MIGRATION.md](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md))。

- **domain の Result** (Q18): `domain` の `Result` は自作のまま ([ADR 0027](0027-domain-model-as-pure-functions-and-unions.md))、`application` が `shared` の `fromResult` で Effect に変えます。v4 の `Result` は `yield*` できず、`Effect.fromResult` は Effect の `Result` を受けるので、自作の `Result` 用の `fromResult` を `shared` に置きます。判別のフィールドが `_tag` なので、`domain` の失敗をそのまま `catchTag` で処理できます。
- **実行の場所** (Q24): Effect の実行の関数 (`Effect.runPromise` など) は、`http`、入口、テストだけで呼びます。`application` と `infrastructure` では `no-restricted-properties` で止めます。中で実行すると、失敗と依存の型が消えます。Effect は一番外側で実行するのが [Running Effects](https://effect.website/docs/getting-started/running-effects/) の説明です。
- **ManagedRuntime** (Q25): 入口ごとに起動時に 1 つ作り、`app.ts` とワーカーの handler に渡します。`Layer` は入口が作った資源を包むだけにし、リクエストごとの状態を持たせません。停止の合図で `dispose` します。ECS のワーカーとバッチの `runMain` は、それらの入口を作るときに決めます。リクエストごとに `Effect.provide` すると `Layer` を毎回作ります (試作で、3 回の呼び出しに対し 3 回作られ、`ManagedRuntime` は 1 回でした)。Web Functions は 1 つの実行環境で最大 64 の同時のリクエストを受けます ([ADR 0013](0013-api-on-ecs-and-lambda-web-functions.md))。
- **Kysely** (Q17): [ADR 0025](0025-kysely-and-dbmate-sql-first.md) のまま、保存先の実装 (`infrastructure`) が Kysely の呼び出しを `Effect.tryPromise` で包みます。
- **失敗の分け方** (Q19): DB の故障は型に出さず defect にします。型に出す (`Data.TaggedError`) のは、`application` が分岐して応答を変える失敗 (一意制約の違反、楽観排他の衝突の 409) だけです。誰も見分けない失敗を型にしない、という Wlaschin の考え方に従います。v4 では defect が混ざると `catchTag` が動かず、500 になります。
- **検査** (Q16、Q26): Nx の target で `effect-tsgo oxlint` を流し、実行し忘れ (`floating-effect`) と v3 の API (`outdated-api`) を止めます。`unstable-api-usage` と `experimental-api-usage` は error にします。`effect-tsgo patch` は使いません。実行の関数と、使わない機能の import は、`vite.config.ts` の Oxlint の規則が `vp check` で止めます。手順と限界は [Effect の検査](../tooling/effect-lint.md) にあります。
- **版の結び付き** (Q16): `@effect/tsgo` 0.61.0 は Oxlint 1.87〜1.89、oxlint-tsgolint 7.0.2004〜2005 に対応します (今の Vite+ 1.4.0 は範囲内)。`@effect/tsgo` と Vite+ を Renovate の同じ group にして、片方だけが上がらないようにします ([ADR 0018](0018-renovate-for-pinned-versions.md))。TypeScript 7 では `@effect/language-service` 0.87.5 が動かないので、`@effect/tsgo` を使います。

## Considered Options

- **Effect を採らない**: `Promise` と `Result` だけで書く案です。依存の受け渡しと失敗の型を自前の規約で守ることになり、エージェントの書く形が揺れます。依存と失敗が型に出る利点を取るために Effect を採りました (判断)。Effect の LTS (4.x) はバグの修正が 2029-09 まで続きます。Matt Pocock の sandcastle も Effect (3.x) で書かれています。
- **`domain` に `effect/Result` を許す (R2)**: `fromResult` が要らなくなります。ただし `domain` が library を import することになり、ADR 0026 の「何も import しない」を崩します。自作の `Result` から R2 へは lint を緩めるだけで移れるので、必要になるまで採りません。
- **`domain` が `Effect` を返す (R3)**: `domain` が純粋でなくなり、[ADR 0027](0027-domain-model-as-pure-functions-and-unions.md) の前提を崩します。
- **`@effect/sql-pg`**: 4.0.6 は API がすべて `@stability unstable` です。ドライバが `postgres` で、Better Auth の `pg`、kysely-codegen の型、`instrumentation-pg` ([Issue #148](https://github.com/yokozi-jp/agent-software-factory/issues/148))、IAM の DB 認証 ([Issue #203](https://github.com/yokozi-jp/agent-software-factory/issues/203)) とぶつかります。`@effect/sql-kysely` と `effect-sql-kysely` は Effect 3 専用です。
- **Pure DI (引数で依存を渡す)** と **`application` が型を宣言するトランザクション**: 最初の案でした。Effect の `Context.Service`、`Layer`、`acquireUseRelease` が同じ役割を型付きで持つので置き換えました。

## Consequences

- `application` の関数は `Effect` を返し、依存は `Context.Service` で宣言します。`http` は `ManagedRuntime` 経由で実行し、`Exit` や失敗の `_tag` を応答に変えます。
- このルールは `lint-effect` (Nx の target) と `vp check` が検査します。`http` と入口は対象に入れていないので、実行の配線を入れるときに足します ([Effect の検査](../tooling/effect-lint.md))。
- `effecttsgo/outdated-api` は、1 つの違反に報告を 2 つ出し、1 つはどの disable コメントも届かないので、fixture にできません。`tools/scripts` のテストで確かめます。
- 使う機能の範囲は、この ADR と `docs/domain-model/` に従います。Effect の package に入っている `AGENTS.md` と `ai-docs/src/` には、使わないと決めた機能 (`Schema` など) の例もあります ([外部ドキュメントの読み方](../tooling/external-docs.md))。

## 確かめたことと、確かめられなかったこと

[Issue #260](https://github.com/yokozi-jp/agent-software-factory/issues/260) で確かめたこと (2026-10-28、@effect/tsgo 0.61.0、Oxlint 1.89.0):

- `effect-tsgo oxlint` は `oxlint-disable-next-line` と、使われない disable のコメントの検査に従う。ただし `outdated-api` が出す、ファイルの 1 行 1 列の報告には、どの disable コメントも届かない。
- `no-restricted-properties` は、import した `Effect` の名前空間にも、実行環境を持つ変数にも効く。プロパティの名前で止めるためで、分割代入は止めない。
- `Context.Tag` は 4.x の型にないので、`outdated-api` ではなく型検査が止める。

次は実施の Issue で確かめます。

- Lambda Web Functions が実行環境を止める前に `SIGTERM` を送るか
- Effect の Tracer と `@hono/otel` の span のつなぎ方

## 出典

- 検査の実装の確認 (Issue #260、Effect 4.0.6、@effect/tsgo 0.61.0、Oxlint 1.89.0、2026-10-28): [Effect の検査](../tooling/effect-lint.md) の「確かめたこと」
- 試作 (`/tmp/fdm`: Effect 4.0.6、TypeScript 7.0.2、Oxlint 1.89.0、2026-10-26): `fromResult` の型検査、`ManagedRuntime` と `Effect.provide` の `Layer` を作る回数、`@effect/tsgo` 0.61.0 の `floating-effect` と `outdated-api`、defect が混ざると `catchTag` が動かないこと
- 改名と unstable の module のパス: [MIGRATION.md](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)
- 実行の位置: [Running Effects](https://effect.website/docs/getting-started/running-effects/)
