---
type: Convention
title: ドメインモデルの失敗の書き方
description: 失敗を起きる場所で 3 つ (API の入力は zod の 400、DB の行の変換は infrastructure の throw で 500、業務の規則は domain の Result で 422) に分け、Result の形と失敗の _tag の決め方、http での 422 への変換を定める規約。業務の規則の失敗を書くとき、throw と zod と Result のどれを使うか迷うとき、失敗を HTTP の応答に変えるときに読む。
tags: [domain-model, convention, result, error-handling]
---

# ドメインモデルの失敗の書き方

失敗は、起きる場所で 3 つに分けます。決定と理由は [ADR 0027](../adr/0027-domain-model-as-pure-functions-and-unions.md) にあります。

| 失敗                                | 起きる場所       | 表し方              | 応答 |
| ----------------------------------- | ---------------- | ------------------- | ---- |
| API の入力が型に合わない            | `http`           | zod の検証          | 400  |
| DB の行が `domain` の型にならない   | `infrastructure` | `parseX` の `throw` | 500  |
| 業務の規則を満たさない (回復できる) | `domain`         | `Result` の `Err`   | 422  |

迷ったら、呼び出し側が失敗を見分けて処理を変えるかを考えます。変えるなら `Result` です。変えない (人が直すしかない) なら `throw` か defect です。
`throw` で業務の失敗を表すと、4xx への対応の書き忘れを止めるセンサーがありません。

## Result

`Result` の型は `shared` に置き、`domain` は `import type` で使います。

```ts
type Result<T, E> =
  | { readonly _tag: "Ok"; readonly value: T }
  | { readonly _tag: "Err"; readonly error: E };
```

- 値は object literal で作ります。`ok()` と `err()` は置きません。
- 失敗の型 `E` は、`_tag` を持つ判別可能な union にします。1 つの関数が返しうる失敗を全て並べます。

```ts
export type SubmitError =
  | { readonly _tag: "NoLines" }
  | { readonly _tag: "TotalExceedsLimit"; readonly limit: Money };

export const submit = (args: { claim: Draft; now: Instant }): Result<Submitted, SubmitError> =>
  args.claim.lines.length === 0
    ? { _tag: "Err", error: { _tag: "NoLines" } }
    : { _tag: "Ok", value: { _tag: "Submitted", id: args.claim.id, submittedAt: args.now } };
```

呼び出し側は `_tag` で分岐し、[網羅](types.md)で漏れを止めます。

## 失敗の `_tag`

- 起きたことを名詞句で書きます (`NoLines`、`TotalExceedsLimit`)。`Error` や `Failed` は付けません。
- 呼び出し側が見分けて処理を変えるものだけを `_tag` にします。誰も見分けない失敗を型に出しません。
- `Result` を Effect に変えるときも `_tag` のままです ([application の Effect の書き方](application-effect.md))。

## 業務の失敗を HTTP の応答にする

`http` が、失敗の `_tag` ごとに 422 の Problem Details にします。

- スキーマで検証できる入力の誤りは 400、業務の規則の失敗は 422 です ([ステータスコード](../web-api/status-codes.md))。
- 本文は RFC 9457 の Problem Details です ([レスポンスボディ](../web-api/response-body.md))。
- 失敗の `_tag` を足したら、`http` の対応も足します。`switch` の網羅が漏れを止めます。
- 楽観排他の衝突は 409、一意制約の違反は `application` が分岐して応答を変える失敗の例です ([ADR 0028](../adr/0028-effect-in-application-and-infrastructure.md))。

## throw が許される場所

- `infrastructure` の `parseX` (DB の行を `domain` の型にする)。失敗はデータの破損か実装の誤りで、呼び出し側は処理を変えられないので 500 です。
- `domain` では `throw` を書きません。Oxlint の自作の規則が止めます ([Issue #259](https://github.com/yokozi-jp/agent-software-factory/issues/259) で入れます)。
- 外から来る入力の検証は zod の仕事で、`http` だけで使います。
