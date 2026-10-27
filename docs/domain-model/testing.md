---
type: Convention
title: 型述語と遷移の関数の境界値のテスト
description: domain の型述語と遷移の関数を、境界値と反例のテストで確かめる規約。型述語が主張を検証しているかは型検査では確かめられず、domain の変異テストのゲートと組み合わせて補う。domain の型述語や遷移の関数のテストを書くときに読む。
tags: [domain-model, convention, testing]
---

# 型述語と遷移の関数の境界値のテスト

`__brand` の型は、型述語が主張を検証していることを前提にします。述語が嘘をつくと、型検査は通ったまま不正な値が入ります。型検査では見つけられないので、テストで確かめます。決定は [ADR 0027](../adr/0027-domain-model-as-pure-functions-and-unions.md) の「嘘をつく型述語」にあります。新しいゲートは足さず、`domain` の変異テストのゲートで補います ([テストの強さの基準を決める](https://github.com/yokozi-jp/agent-software-factory/issues/30) の決定 3、4)。

## 型述語

述語ごとに、次を書きます。

- 通る値の境界の内側と、ちょうど境界の値 (最小、最大)
- 通らない値の、境界のすぐ外 (最小の 1 つ下、最大の 1 つ上)
- 型は合うが、中身が違う値 (空文字、前後の空白、違う長さ)

境界の比較演算子 (`<` と `<=`) の取り違えと、検査の抜けは、変異テストが見つけます。境界のテストがないと、変異が生き残ります。

```ts
test.each([
  ["", false],
  ["a".repeat(63), false],
  ["a".repeat(64), true],
  ["a".repeat(65), false],
])("isClaimId(%j) is %s", (input, expected) => {
  expect(isClaimId(input)).toBe(expected);
});
```

## 遷移の関数

- 受け取れる状態ごとに、成功した結果の `_tag` と値を確かめます。
- 失敗の `_tag` ごとに、その失敗になる最小の入力を書きます。
- 時刻と ID は引数で渡すので、固定の値を渡します。時計を差し替えません。

`domain` は純粋なので、モックは要りません。
