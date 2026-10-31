---
type: Convention
title: "Web API の冪等性と PATCH の部分更新"
description: "POST/PATCH に冪等性を持たせる Idempotency-Key（このリポジトリでは POST と PATCH のすべてで必須。ヘッダーの形式、一意キー、ペイロードのハッシュ、処理中の重複、保存期間、保存する応答）と、PATCH の部分更新形式を定める規約。リトライ時の重複処理を防ぐとき、POST や PATCH の route を足すとき、PATCH のボディ形式を決めるときに読む。"
tags: [web-api, convention, idempotency, http-method]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forWebAPI/web_api_guidelines.html
    title: Web API設計ガイドライン
    author: フューチャー株式会社
---

# Web API の冪等性と PATCH の部分更新

POST や PATCH でもできる限り冪等に設計し、`Idempotency-Key` ヘッダーで重複処理を防ぐ。
PATCH のリクエストボディは JSON Merge Patch 形式に従う。
出典は [Web API設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## POSTとPATCHの冪等

Idempotency-Keyヘッダーという[IETF Draft（2026年10月時点ではDraft 08）](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-08)がある。このDraftでは、POSTやPATCHに冪等性（同じリクエストが2回来たとしても重複で処理をしない性質）を持たせることが議論されている。主なユースケースは、ペイメントなどで多重の引き落としが許容されない場合である。特にマイクロサービスなシステム構成は要求失敗時のリトライが一般的なため、多重で処理が成功してしまわないように制御する必要がある。

推奨は以下の通り。

- POSTやPATCHであっても、リトライ時の重複起動に備えて、できる限り冪等な設計とする
- IETF Draftな状態であるが、`Idempotency-Key` を用いる
- キーにはフロントエンドでUUIDを採番して設定してもらう
- サーバーサイドのDBには `Idempotency-Key` の値とペイロードのハッシュ値を格納するカラムを追加し、`(tenant_id, user_id, Idempotency-Key)` の組にユニーク制約を貼る
- サーバーサイドは、`Idempotency-Key`が指定された場合、その値とペイロードのハッシュ値を突き合わせて、どちらの値も一致していれば処理済みとする
- `Idempotency-Key` が処理済みだが、ペイロードハッシュ値が異なる場合は、400 (Bad Request) エラーを返す（フロントエンド側で別のUUIDを発番してもらう）

このリポジトリでは、上の推奨を次のように具体化する（理由は [ADR 0040](../adr/0040-idempotency-key-in-module-schema.md)）。

- **対象**: POST と PATCH のすべてで `Idempotency-Key` を必須とする。ヘッダーがなければ 400 を返す。Better Auth の `/api/auth/*` は契約の外にあり、対象にしない
- **ヘッダーの形式**: 値は UUID で、Structured Field の String として引用符で囲む（`Idempotency-Key: "<UUID>"`）。この形式でなければ 400 を返す
- **保存先**: キーは、モジュールごとのスキーマの専用の表に、業務の更新と同じトランザクションで書く。キーのカラムだけにユニーク制約を貼ると、別のテナントの同じキーで、行は RLS で見えないのに挿入だけが拒まれるので、`tenant_id` と `user_id` を含める（[ADR 0011](../adr/0011-tenant-id-and-rls-from-the-start.md)）
- **ペイロードのハッシュ**: HTTPメソッド、パス、クエリ文字列、リクエストボディのバイト列を合わせた SHA-256 とする。JSON は正規化しない
- **処理中の重複**: 先の要求が処理中のときは、5 秒まで待つ。待ちが切れたら 409 (Conflict) と `Retry-After` ヘッダーを返す
- **保存期間**: 24 時間（API の利用者に公開する期限）。この間は、同じキーでの再試行に保存した応答を返す
- **保存する応答**: 2xx だけを保存する。2xx 以外の応答は保存せず、キーも残さないので、同じキーでの再試行は業務の処理をもう一度実行する
- **処理済みの再試行への応答**: 保存した HTTPステータスコードとボディをそのまま返す。返し直したことを示すヘッダーは付けない
- **エラーの区別**: ヘッダーなし、形式の誤り、ペイロードの不一致、処理中の重複は、エラー応答（Problem Details）の `type` で区別する

> [!NOTE]
> **フロントエンドの書き方**
>
> キーは `crypto.randomUUID()` で、利用者の1回の操作ごとに採番する。再試行のあいだは同じ値を送る。TanStack Query の mutation は、再試行のたびに `mutationFn` を呼び直すため、キーは `mutationFn` の外で作って変数に渡す。
>
> `crypto.randomUUID()` は secure context でしか使えない。HTTPS と `http://localhost` は使えるが、それ以外の HTTP では動かない（[MDN: Crypto.randomUUID()](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)、[MDN: Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)）。

検査は [ADR 0040 の検査](../adr/0040-idempotency-key-in-module-schema.md#検査) にある。

- **契約**: POST と PATCH の route は、`request.headers` に `idempotencyKeyHeaderSchema` を渡し、`requireIdempotencyKey` を middleware にする（`packages/shared-kernel`）。付け忘れると、`.spectral.yaml` の `idempotency-key-required` が契約の lint で止める
- **use case**: 書き込みの use case（`application` と `infrastructure` で `inTenantTransaction` を使うファイル）は `withIdempotencyKey` を通る。キューのコンシューマーのように HTTP の要求でない書き手は、ファイルに `// idempotency-exempt: <理由>` の行を書く。repo-policy が止める
- **web**: mutation は `apps/web/src/lib/use-idempotent-mutation.ts` の `useIdempotentMutation` で包む。`mutate` を呼ぶたびに新しいキーを採り、`mutationFn` の第 2 引数の `headers` を `hc` の呼び出しにそのまま渡す。TanStack Query の再試行では同じキーを送る。利用者がボタンをもう一度押す操作は、新しい操作なので新しいキーになる

> [!TIP]
> **業務アプリケーションで伝統的に行われていた設計パターン**
>
> ボタン連打などの対策として、業務アプリケーションでは以下の設計がよく行われていた。
>
> 1. フロントエンドで最初に採番APIを呼び出し一意となる値を採番
> 2. 要求IDといった形式で登録項目に追加し、DB側でプライマリーキー（ユニーク制約）にして、重複排除を行う
>
> 採番APIを利用する処理フローは、呼び出し元からすると覚えるべきことが増え、E2Eなどの手間も増えるため、採番APIの代わりにフロントエンド側でUUIDを発行する方式を推奨する。

<!-- 前の注記と分ける -->

> [!NOTE]
> **参考**
>
> - [Idempotent (べき等)](https://developer.mozilla.org/ja/docs/Glossary/Idempotent)
> - [Idempotency-Key Headerの現状・仕様・実装の理解を助けるリソースまとめ](https://ohbarye.hatenablog.jp/entry/2021/09/06/idempotency-key-header-resources)
> - [Idempotency-Keyヘッダによるマイクロサービスの冪等性の担保](https://www.m3tech.blog/entry/2023/12/15/110000)

## PATCHによる部分更新

PATCHメソッドはリソースの部分更新をサポートするが、どのような形式にするかはRFC 5789で決まっていない。一般的には以下の形式が考えられる。

| 観点     | (1) JSON Patch                                   | （2）JSON Merge Patch                                                                                                                     |
| :------- | :----------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| 説明     | RFC 6902。操作が明確に定義でき、細かい制御が得意 | RFC 7396。シンプルな構文で、元のJSONに対して新しい値を上書きするだけのため、直感的である。                                                |
| 主な制約 | ・フォーマットがやや複雑で学習コストが必要       | ・配列のある要素だけ更新といった高度な操作はできない ・フィールドの削除をnullで表現するため、nullの値を持つことができる場合、表現が難しい |

以下に `PATCH /users/123` する操作例を挙げる。

操作内容:

1. 名前を `John Smith` に変更
2. メールアドレスを `john.smith@example.com` に変更
3. 自宅電話番号を変更
4. 新しい住所フィールドを追加

JSON PATCH:

```json
[
  { "op": "replace", "path": "/name", "value": "John Smith" },
  { "op": "replace", "path": "/email", "value": "john.smith@example.com" },
  { "op": "replace", "path": "/phoneNumbers/0/number", "value": "555-555-1234" },
  { "op": "add", "path": "/address/country", "value": "USA" },
];
```

JSON Merge Patch:

```json
{
  "name": "John Smith",
  "email": "john.smith@example.com",
  "address": {
    "country": "USA"
  },
  "phoneNumbers": [
    {
      "type": "home", // 配列の要素のため、更新しない場合も元の要素を含める必要がある
      "number": "555-555-1234"
    }
  ]
}
```

推奨は以下の通り。

- PATCHのリクエストボディは（2）の形式に従う
- JSON Merge Patchでハマりやすい部分更新が出てきた場合は、PUTで処理できるエンドポイントを設けるなど、PATCHにこだわりすぎない
- [#nullの扱い](request-design.md#nullの扱い) 章の通り値が存在しないことを `undefined` で表現し `null` を利用しない。そのため、PATCHで項目削除のために `null` を利用することは問題ない
- `Content-Type: application/merge-patch+json` で送信する。フレームワークなどの都合で対応できない場合は、 `Content-Type: application/json` も許容する

> [!NOTE]
> **参考**
>
> [Web API 設計のベスト プラクティス \- Azure Architecture Center](https://learn.microsoft.com/ja-jp/azure/architecture/best-practices/api-design#patch-methods)
