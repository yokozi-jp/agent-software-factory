---
type: Convention
title: 認可の書き方
description: domain と application の認可の線引き、許可の証（Permit）、網羅のテストの形を定める規約。認可の方針の関数や、遷移の関数が取る引数、認可のテストを書くとき、403 と 404 のどちらを返すか迷うときに読む。
tags: [domain-model, convention, authorization, security]
---

# 認可の書き方

業務の規則は `domain`、誰が要求したかは `application` の方針の関数 `authorize` で確かめ、許可の証 `Permit` を `domain` の遷移の関数に渡します。
役割と操作の表、操作する人の 7 種類、HTTP の応答の表、理由と採らなかった案は [ADR 0045](../adr/0045-authorization-policy-in-application-with-permit-token.md) にあります。この文書には、コードを書くときの規則だけを書きます。

> [!NOTE]
> `authorize`、`Permit`、網羅のテストはまだ実装がありません。サンプル機能の仕様で書きます。BOLA のテストの仕組みは実装済みです (「BOLA のテスト」)。この文書は実装の指針で、書いた後に実装と食い違えば、この文書を直します。

## 線引き

| 確かめること                                                  | 置き場所                                        |
| ------------------------------------------------------------- | ----------------------------------------------- |
| その審査の上長か、職務分掌 (本人は承認も確認もできない)、状態 | `domain` の遷移の関数                           |
| 申請者本人か、経理の役割か、見えるか (見えなければ 404)       | `application` の `authorize(actor, 操作, 対象)` |

- 基準は「身元、役割、クレームに依る確認は `application`、業務の実体、値、状態遷移の規則は `domain`」です。出典は Derek Comartin の [Authorization: Domain or Application Layer?](https://codeopinion.com/authorization-domain-or-application-layer/) で、ブログの主張を、このリポジトリの基準にすると決めた判断です ([ADR 0045](../adr/0045-authorization-policy-in-application-with-permit-token.md))。
- `actor` は、現在時刻と同じく引数で渡します。`Layer` にリクエストごとの状態を持たせません ([application の Effect の書き方](application-effect.md))。
- RLS はテナントだけを分けます。利用者ごとのポリシーを足しません ([ADR 0011](../adr/0011-tenant-id-and-rls-from-the-start.md))。
- 認可のライブラリと方針エンジンを入れません。

## 許可の証

- `authorize` は、許可なら `Permit<操作>` (`__brand` の型) を、拒否なら拒否の `_tag` を返します。
- `domain` の遷移の関数は、操作する人ではなく証を必須の引数に取ります (例: `confirm({ review, permit, now })`)。遷移の関数は、誰が要求したかを知りません。
- 証は `authorize` でだけ作ります。`as` で作りません ([ADR 0020](../adr/0020-typescript-strictness.md))。作る場所を 1 か所に限る検査は、実施で決めます。証の型は、`domain` が `import type` できる場所に置きます。型の書き方は [型の書き方](types.md) です。

## 網羅のテスト

- 方針の関数の単体テストと、遷移の関数の単体テストの 2 つを書きます。操作する人の種類は [ADR 0045](../adr/0045-authorization-policy-in-application-with-permit-token.md) の 7 つです。
- 期待の表はテストの側に 1 つ書き、両方のテストが読みます。操作の union から `satisfies Record<操作, …>` にして、足し忘れを型で止めます。本番の方針の表からは作りません。

## HTTP の応答

見えなければ 404、見えるが許されなければ 403、状態の不一致と楽観排他の衝突は 409、業務のルールを満たさなければ 422、人事システムが応答しなければ 503 です。表は ADR 0045、ステータスコード全体の規約は [Web API の HTTP ステータスコード](../web-api/status-codes.md) にあります。
パスに id を持つ操作で他人のリソースが 404 になることは、`apps/api` の結合テストが OpenAPI の spec から確かめます。

## BOLA のテスト

他人のリソースの id で読めないことは、route ごとの手書きのテストでなく、`apps/api/src/bola.test.ts` が commit した `apps/api/openapi.json` から確かめます。パスに `{id}` を持つ操作はすべて対象になります。

route (パスに id を持つ操作) を足したとき:

1. `pnpm --filter @agent-software-factory/api openapi` で spec を更新します。
2. `bola.test.ts` の `factories` の型が操作の名前 (`GET /api/claims/{id}`) を要求して、型の検査が止まります。その操作について、持ち主のリソースを作る関数を足します。関数は `ResourceContext` (`owner`、`other`、`superuser`) を受け取り、`superuser` の接続で持ち主の行を作り、パスの値 (`params`) と、書き込みの操作なら検証を通る本文 (`body`) を返します。
3. 404 でなくてよい操作 (公開のリソースなど) は、関数の代わりに、理由を付けて `exceptions` に書きます。理由が空だと失敗します。spec から消えた操作が `exceptions` に残っていても失敗します。

判定は、持ち主でない社員が持ち主のリソースの id で叩いたときに、404 の Problem Details が返ることです。書き込みの操作では、DB の全表の行 (`auth` を除く) が変わらないことも見ます。2 人は、今は `signedIn` で作った別々のセッションで、同じテナントのメンバーとしては用意していません ([#487](https://github.com/yokozi-jp/agent-software-factory/issues/487))。別のテナントの行が見えないことは、RLS のテストで確かめます ([ADR 0011](../adr/0011-tenant-id-and-rls-from-the-start.md))。
仕組みの検出力は、`apps/api/test/bola-fixtures.ts` の fixture の route (`leak` で絞り込みをわざと外す) で確かめます。
