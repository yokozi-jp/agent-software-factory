---
type: Convention
title: ドメインモデルの型の書き方
description: packages/*/src/domain の状態を _tag の判別可能な union で、値を __brand と型述語で、制約を [T, ...T[]] のような構成で書き、網羅を switch-exhaustiveness-check と never で確かめ、satisfies と object の引数を使う規約。domain のコードを書く、直すときに読む。
tags: [domain-model, convention, typescript]
---

# ドメインモデルの型の書き方

`domain` は、不正な状態を作れない型と、純粋な関数で書きます。決定と理由は [ADR 0027](../adr/0027-domain-model-as-pure-functions-and-unions.md) にあります。
この文書は pstack の `typescript-best-practices` ([cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack/skills/typescript-best-practices)、commit `99b609a`、MIT) から選んだ規則を、このリポジトリの決定に合わせて書き直したものです。モジュールと層の置き場は [ADR 0026](../adr/0026-modules-as-packages-with-oxlint-boundaries.md) にあります。

## 状態と遷移

状態は `_tag` を持つ判別可能な union にします。真偽値と省略可能なフィールドの組み合わせで状態を表すと、矛盾した状態が作れます。

```ts
// 不可: 提出済みなのに submittedAt がない状態を作れる
type Claim = { submitted: boolean; submittedAt?: string };

// 可: 有効な状態だけを表す
type Claim =
  | { readonly _tag: "Draft"; readonly id: ClaimId }
  | { readonly _tag: "Submitted"; readonly id: ClaimId; readonly submittedAt: Temporal.Instant };
```

遷移の関数は、受け取る型を遷移できる状態に絞り、新しい状態を値で返します。時刻 (`Temporal.Instant`) と ID は引数で受けます。`domain` は現在時刻も乱数も持ちません。

```ts
export const submit = (args: {
  claim: Draft;
  now: Temporal.Instant;
}): Result<Submitted, SubmitError> => {
  /* ... */
};
```

状態の粒度 (申請中を 2 段に分けるか)、下書きの明細の要否、集約の境界は、サンプル機能の仕様で決めます。

## 判別のフィールドは `_tag`

状態、失敗、出来事のすべてで `_tag` を使います。`kind` や `type` は使いません。Effect の `Data.TaggedError` と `catchTag` が `_tag` を読むので、`domain` の失敗をそのまま処理できます。

## 値の型

値の型は `__brand` を持つ交差型と、claim を検証する型述語で書きます。型を作るために `as` は書きません。`domain` は何も import しません。

```ts
export type ClaimId = string & { readonly __brand: "ClaimId" };
export const isClaimId = (input: string): input is ClaimId => /^[0-9a-f]{8}-/.test(input);
```

- 日時には自前の `__brand` の型を作らず、`Temporal.Instant` (瞬間) と `Temporal.PlainDate` (暦日) を、import せずに global の型で受けます。`Temporal` は不変で、不正な値を作れないので、brand で足すものがありません ([ADR 0043](../adr/0043-instants-in-utc-business-calendar-in-tokyo-with-temporal.md))。
- 型述語は主張を検証します。検証しない述語は、`as` より悪いものです。名前が安全だと言っているので、バグが隠れます。名前は `isX` か `hasX` にします。
- `__brand` の形を変えません。別の書き方を作りません。
- `throw` する `parseX` は `infrastructure` だけに置きます (DB の行を `domain` の型にする失敗。[失敗の書き方](failures.md))。`domain` では `throw` を止めます。
- zod の `.brand()` は `domain` に入れません。`http` の zod は、`.int().positive()` のような spec のための制約と、`.refine(isX)` で `domain` の型を得ます。
- 外から来たデータの型は `unknown` にして、検証してから使います。`any` は使いません。
- 型述語の検証が正しいかは、型検査では確かめられません。[境界値のテスト](testing.md)で確かめます。

## 構成で表す型

不正な値を作れない形を選びます。実行時の検査を呼び出し側に繰り返させません。

| 制約           | 書き方                                                         |
| -------------- | -------------------------------------------------------------- |
| 空でない       | `type NonEmpty<T> = [T, ...T[]]`                               |
| 偶数個         | `type Pairs<T> = [T, T][]`                                     |
| 開始が終了以前 | `{ start: Temporal.Instant; durationMs: number }` で終了を導く |

`T[]` のまま全ての操作が全域なら (空でも `sum` が 0 になるなど)、強くしません。`!`、`arr[0] as T`、「起きない」はずの `throw` が要るときに強くします。

## 絞り込みの順序

上にあるものほど先に使います。`as` は最後で、検証した後にだけ使います。

1. 判別のフィールドの `switch` と `if`
2. `in` 演算子
3. `typeof` と `instanceof`
4. 型述語
5. `as`

## 網羅

`switch` は、`switch-exhaustiveness-check` ([ADR 0020](../adr/0020-typescript-strictness.md)) と、default の `never` の両方で網羅を確かめます。lint の規則が外れても、型検査が止めます。

```ts
switch (claim._tag) {
  case "Draft":
    return; /* ... */
  case "Submitted":
    return; /* ... */
  default: {
    const _exhaustive: never = claim;
    return _exhaustive;
  }
}
```

値を返す `switch` は上の形に、文の `switch` は `void _exhaustive;` で終えます。

## `satisfies`

設定や定数は `as` ではなく `satisfies` で型を確かめます。リテラルの型を広げません。

```ts
const limits = { maxLines: 50 } satisfies Limits; // limits.maxLines は number のまま、Limits に合わないとエラー
```

## 引数

引数が 2 つ以上の関数は、object で受けます。呼び出しの順序を間違えず、呼び出しが読めます。1 フレームごとに呼ぶような速さが要る関数は、位置引数のままにします。

## 既存の型を導く

OpenAPI や DB の生成された型がある形は、`Pick`、`Omit`、`Parameters`、`ReturnType`、`Awaited` で導き、同じ形の interface を新しく宣言しません。
