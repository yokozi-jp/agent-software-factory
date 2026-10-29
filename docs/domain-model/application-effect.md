---
type: Convention
title: application と infrastructure の Effect の書き方
description: Effect 4 を application と infrastructure だけで使い、使ってよい機能の一覧、domain の Result を fromResult で変えること、Context.Service と Layer、Kysely を Effect.tryPromise で包むこと、DB の故障を defect にすること、入口ごとの ManagedRuntime で実行することを定める規約。application や infrastructure のコードを書くとき、Effect の機能を足したくなったときに読む。
tags: [domain-model, convention, effect, application, infrastructure]
---

# application と infrastructure の Effect の書き方

Effect は `application` と `infrastructure` だけで使います。`domain` は import せず、`http` は Hono と zod のままです。決定と理由は [ADR 0028](../adr/0028-effect-in-application-and-infrastructure.md) にあります。
Effect の一次情報は、入れた版の `node_modules/effect/AGENTS.md` と `ai-docs/src/` です ([外部ドキュメントの読み方](../tooling/external-docs.md))。そこには使わない機能の例も入っているので、使う範囲はこの文書に従います。

## 使ってよい機能

| 目的                        | 使う                                                     |
| --------------------------- | -------------------------------------------------------- |
| 手続きを書く                | `Effect.gen`、`Effect.fn`                                |
| 値と失敗を作る              | `Effect.succeed`、`Effect.fail`、`fromResult` (`shared`) |
| Promise を包む              | `Effect.tryPromise`、`Effect.promise`                    |
| 型に出す失敗                | `Data.TaggedError`、`Effect.catchTag`                    |
| 依存                        | `Context.Service`、`Layer`                               |
| 資源                        | `Effect.acquireUseRelease`                               |
| 実行 (`http`、入口、テスト) | `ManagedRuntime` と実行の関数                            |

使わない機能: `Schema`、`effect/http` や `effect/sql` などの unstable の module、`@effect/sql-pg`、`Logger`、`Config`、`Schedule` による再試行、`Stream`、`Queue`、`Fiber`。同じ役割を別の道具で決めているからです (検証は zod、ログは stdout、再試行は ky と SDK)。`@stability unstable` と `experimental` の API も使いません。
Tracer と `@hono/otel` の span のつなぎ方は、実施の Issue ([Issue #148](https://github.com/yokozi-jp/agent-software-factory/issues/148)) で決めます。

## 現在時刻

現在時刻は、入口 (route の handler、ワーカーの 1 件、バッチの 1 回の実行) が `shared` の `currentInstant` で 1 回読み、`now` の引数で渡します。`application` と `domain` は `Clock` も `Temporal.Now` も `Date` も読みません。1 回の処理の中で時刻が 1 つに決まり、テストで固定できます ([ADR 0043](../adr/0043-instants-in-utc-business-calendar-in-tokyo-with-temporal.md))。

- 入口のテストは、ランタイムに固定の `Clock` (`Layer.succeed(Clock.Clock)`) か `TestClock.layer()` を与えます。`TestClock` は仮想の時間を持つので、`sleep` や timeout を待つ処理も `TestClock.adjust` で進められます。
- `application` の関数のテストは、`now` を値で渡します。

## domain の Result を変える

`domain` の `Result` は、`shared` の `fromResult` で Effect にします。v4 の `Effect.fromResult` は Effect の `Result` を受けるので、自作の `Result` には使えません。v4 の `Result` は `yield*` できません。失敗の `_tag` はそのまま `catchTag` で処理できます。

```ts
const submitClaim = Effect.fn("submitClaim")(function* (args: {
  id: ClaimId;
  now: Temporal.Instant;
}) {
  const claims = yield* ClaimRepository;
  const draft = yield* claims.findDraft(args.id);
  const submitted = yield* fromResult(submit({ claim: draft, now: args.now }));
  yield* claims.save(submitted);
  return submitted;
});
```

## 失敗の扱い

- `application` が分岐して応答を変える失敗 (一意制約の違反、楽観排他の衝突の 409) だけを `Data.TaggedError` で型に出します。
- DB の故障 (接続の失敗、タイムアウト) は型に出さず、defect にします。`Effect.tryPromise` で包んだ後に `Effect.orDie` で defect にします。
- defect が混ざると `catchTag` は動かず、`http` は 500 にします。

## 依存と資源

- 依存は `Context.Service` で宣言し、`Layer` で組み立てます。`Layer` は入口が作った資源を包むだけにし、リクエストごとの状態を持たせません。
- 接続やトランザクションのような資源は `acquireUseRelease` で閉じます。
- 保存先の実装は `infrastructure` に置きます。Kysely ([ADR 0025](../adr/0025-kysely-and-dbmate-sql-first.md)) の呼び出しを `Effect.tryPromise` で包みます。DB の行は `parseX` で `domain` の型にします ([失敗の書き方](failures.md))。

## 実行

- Effect の実行の関数 (`Effect.runPromise` など) は、`http`、入口、テストだけで呼びます。`application` と `infrastructure` で呼ぶと、失敗と依存の型が消えるので、`no-restricted-properties` で止めます。
- `ManagedRuntime` は入口ごとに起動時に 1 つ作り、`app.ts` とワーカーの handler に渡します。リクエストごとに `Effect.provide` すると `Layer` を毎回作ります。停止の合図で `dispose` します。
- `ManagedRuntime` の配線と保存先の実装は、サンプル機能の仕様で決めます。

## 検査

Nx の `lint-effect` の target が `effect-tsgo oxlint` を流し、実行し忘れと v3 の API、unstable と experimental の API を止めます。`vp check` は、実行の関数と、使わない機能の import を止めます。止まったときの直し方は [Effect の検査](../tooling/effect-lint.md) にあります。`effect-tsgo patch` は使いません。
