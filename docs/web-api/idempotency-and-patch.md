---
type: Convention
title: "Web API の冪等性と PATCH の部分更新"
description: "POST/PATCH に冪等性を持たせる Idempotency-Key と、PATCH の部分更新形式を定める規約。リトライ時の重複処理を防ぐとき、PATCH のボディ形式を決めるときに読む。"
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
- サーバーサイドのDBには `Idempotency-Key` の値とペイロードのハッシュ値を格納するカラムを追加し、`Idempotency-Key` 側のカラムにユニーク制約を貼る
- サーバーサイドは、`Idempotency-Key`が指定された場合、その値とペイロードのハッシュ値を突き合わせて、どちらの値も一致していれば処理済みとする
- `Idempotency-Key` が処理済みだが、ペイロードハッシュ値が異なる場合は、400 (Bad Request) エラーを返す（フロントエンド側で別のUUIDを発番してもらう）

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
