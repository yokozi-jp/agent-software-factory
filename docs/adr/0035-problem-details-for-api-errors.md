---
type: ADR
title: "ADR 0035: API のエラー応答は RFC 9457 の Problem Details にし、識別子は type だけにして、変換は 4 か所に限る"
description: API のすべてのエラー応答を application/problem+json にし、type・title・status を必須にする決定。識別子は type だけで code を足さず、ステータスだけで分かるものは about:blank、共通は /problems/<kebab>、業務の失敗と 409 は /problems/<module>/<kebab-tag> にする。title と detail は英語で固定し、5xx は内部の情報をどの環境でも出さず trace_id を付ける。変換は defaultHook、onError、notFound、route の _tag の switch の 4 か所だけで shared の関数を通す。Better Auth の /api/auth/* は契約の外に置き、405 は返さない。型は domain の _tag から web の Record<ProblemType, キー> まで連ねる。oasdiff にはエラーの type を x-extensible-enum で載せる。エラー応答の形や type を足す、変えるとき、defaultHook や onError を書くとき、code の拡張や 405 を足したくなったとき、Better Auth の応答を書き換えたくなったときに読む。
tags: [adr, web-api, error, problem-details, rfc9457, hono, openapi, i18n]
---

# ADR 0035: API のエラー応答は RFC 9457 の Problem Details にし、識別子は type だけにして、変換は 4 か所に限る

[docs/web-api/response-body.md](../web-api/response-body.md) は、エラーを RFC 9457 の Problem Details にすると定めています。ただ、`type` の名前、拡張のメンバー、変換する場所、Better Auth の応答、405 は決めていません。クライアント (web) が応答の形に依存し、後から変えにくいので、実装の前に決めます ([Issue #221](https://github.com/yokozi-jp/agent-software-factory/issues/221)、[Issue #306](https://github.com/yokozi-jp/agent-software-factory/issues/306))。

## 決定

- **形**: すべてのエラー応答を RFC 9457 の Problem Details (`Content-Type: application/problem+json`) にし、`type`、`title`、`status` を必須にします。
- **識別子は `type` だけ**: `code` の拡張は足しません。RFC 9457 3.1.1 は、consumer が `type` を主な識別子に使うことを求めています。`code` を足すと識別子が 2 つになり、ずれる余地ができます。i18n の方式を決めた [Issue #146](https://github.com/yokozi-jp/agent-software-factory/issues/146) の「`code`」は「`type`」と読みます。
- **`type` の名前**:
  - ステータスだけで分かるもの (404、415、500、503。405 は返さない) は `about:blank` です (RFC 9457 4.2.1)。
  - web が見分けるものだけ、相対の完全なパスにします (RFC 9457 3.1.1)。派生プロジェクトでドメインが変わるので、絶対 URI にしません。
  - 共通は `/problems/<kebab>` です (`validation`、`unauthenticated`、`session-expired`、`forbidden-origin`、`rate-limited` など)。
  - 業務の失敗と 409 は `/problems/<module>/<kebab-tag>` です。`domain` の失敗の `_tag` から機械的に作ります (`ApprovalNotAllowed` → `/problems/expense/approval-not-allowed`)。`_tag` はモジュールをまたいで重なりうるので、モジュール名を前に付けます。
- **文面**: `title` と `detail` は英語で固定し、`Content-Language` を付けません。利用者向けの文面は web が `type` から i18n で出します。
- **5xx**: `type`、`title`、`status` だけを返し、例外のメッセージとスタックは、どの環境でも出しません。今の span があれば、拡張の `trace_id` を全ての Problem に付けます。利用者はブラウザの向こうの業務の利用者で、`response-body.md` の「内部 API なら詳細を許容」に当たりません。環境で出し分けると、設定の誤りで漏れます。
- **検証エラー**: 400 の `errors` は `[{ pointer, code, ...差し込みの値 }]` です。zod の issue から作り、`pointer` は RFC 9457 の例と同じ JSON Pointer、`code` は zod の issue の `code` です。`errors` の要素に `detail` は持ちません (規約の「`detail` は必須」を外します)。`title` と同じく英語の文面を返しても web は使わず、`pointer` と `code` から i18n で出すためです。422 も入力項目に結びつくなら `pointer` を持ちます。web はどちらも入力欄の直下に出し、欄に当たらないものはフォームの上に出します。
- **変換の場所**: 次の 4 か所だけで、`shared-kernel` の 1 つの関数を通します。ほかの場所で `c.json(..., 4xx)` を書きません。
  - `defaultHook` (`@hono/zod-openapi`): 400。
  - `app.onError`: `HTTPException` はそのステータス、それ以外は 500。5xx のログもここで書きます。ログのキーとレベルは [Issue #229](https://github.com/yokozi-jp/agent-software-factory/issues/229) に任せます。
  - `app.notFound`: 404。
  - route の失敗の `_tag` の `switch`: 422 と 409。

  `sessionGuard`、`csrfProtection` の middleware は、4 か所の外に応答を作らず、`shared-kernel` の同じ関数を呼んで Problem Details を返します (これまで各自で `c.json` を書いていたものを移します)。

- **置き場所**: Problem の schema と関数は `shared-kernel` の公開 API に置きます。`shared-kernel` が `@hono/zod-openapi` に依存します。各モジュールの `http` の層が使うので、`apps/api` には置けません ([ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md))。`domain` は `import type` のままで、HTTP を知りません。
- **Better Auth**: `/api/auth/*` は Better Auth の `{ code, message }` のまま、契約の外に置きます。その前に掛かる自前の middleware は Problem Details です ([ADR 0022](0022-better-auth-cookie-bff.md))。
- **405**: 返しません。Hono の既定の 404 のままにします。`status-codes.md` の「405 を返す」とは違います。
- **型の連鎖**: `domain` の `_tag` の union → `http` の `switch` と、route の `type` の一覧の `satisfies` での突き合わせ → route の zod schema の `type` のリテラルの union → `hc` → web の `Record<ProblemType, キー>`。`_tag` を足して `http` の対応を忘れると `switch` の網羅で、`type` の一覧に足し忘れると `satisfies` で、web の文面を足し忘れると `Record` で、型の検査が止まります ([ADR 0027](0027-domain-model-as-pure-functions-and-unions.md) の「失敗を型に出す」を web まで伸ばします)。web は型付きの失敗で `parseResponse` を使わず、`res.status` で分岐します。`parseResponse` の `DetailedError` は `detail.data` が型を持たないためです (Hono 4.13.13)。
- **oasdiff**: spec ではエラーの `type` を `string` と `x-extensible-enum` にし、値の追加で oasdiff が止まらないようにします。oasdiff は、応答の enum への値の追加を ERR にします (`response-property-enum-value-added`)。CI は `--fail-on ERR` で例外のファイルを持たず、知らない `type` は web が汎用の文面にするので、古い web は壊れません。`.openapi({ "x-extensible-enum": [...] })` で出力でき、oasdiff 1.34.1 で値の追加が止まらないことを確かめました (下の Consequences)。`--severity-levels` で WARN に下げる案は使いません。
- **検査**: Spectral の独自の規則 (4xx と 5xx が `application/problem+json` で `type`、`title`、`status` を持つ)、4 か所の `app.request()` のテスト、保証カタログの「エラー応答の形」の行で守らせます ([Issue #190](https://github.com/yokozi-jp/agent-software-factory/issues/190))。Oxlint の規則は足しません。`c.json(..., 4xx)` を確実に見つける書き方がなく、route の応答 schema が型で止めるからです。

```json
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "/problems/expense/approval-not-allowed",
  "title": "Approval is not allowed.",
  "status": 422,
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

## Considered Options

- **`code` の拡張を足す**: 業務のコードを `type` と別に持てます。ただ、識別子が 2 つになり、ずれる余地ができます。RFC 9457 3.1.1 も `type` を主な識別子にすると定めています。足しません。
- **環境ごとに詳細を出し分ける (開発では例外のメッセージを返す)**: 開発は楽になります。環境の設定を誤ると本番で内部の情報が漏れます。開発のときはログとトレースを読みます。
- **Better Auth の応答を書き換える middleware**: `/api/auth/*` も Problem Details にそろえられます。ただ、Better Auth 1.7.12 の `onAPIError.onError` は通知だけで、応答の形を替える手段がありません。応答を書き換える middleware は、版の更新で壊れやすいです。契約の外に置きます。
- **405 を自作する**: 規約どおりになります。Hono に組み込みがなく、メソッドごとに route を網羅する処理を持つことになります。web は `hc` の型でメソッドの誤りを止めるので、返しません。
- **`--severity-levels` だけで oasdiff を済ませる**: 設定は 1 行です。ただ、`type` 以外の応答の enum の追加も WARN になり、止めたい変更まで通ります。`x-extensible-enum` なら `type` だけを緩められるので、こちらにします。

## Consequences

- 実装は [Issue #307](https://github.com/yokozi-jp/agent-software-factory/issues/307) (API)、[Issue #308](https://github.com/yokozi-jp/agent-software-factory/issues/308) (web)、[Issue #190](https://github.com/yokozi-jp/agent-software-factory/issues/190) (契約の検査) で行います。
- 型と spec の前提は、scratch の最小構成で確かめました (2026-10-28。hono 4.13.13、zod 4.6.7、`@hono/zod-openapi` 1.6.3、TypeScript 7.0.2、oasdiff 1.34.1)。確かめたのは次の点です。実装の型テストは [Issue #307](https://github.com/yokozi-jp/agent-software-factory/issues/307) で書きます。
  - `application/problem+json` の応答は、`hc` の `res.json()` で型が付きます。
  - `res.status === 422` で分岐すると、`res.json()` の `type` がその route の 422 のリテラルの union に絞られます (400、409 も同じ。違うリテラルを書くとコンパイルが落ちる)。
  - `defaultHook` の戻り値は route の応答の型に入りません。`res.status` の型は route に書いた 200、400、422、409 だけで、`onError` と `notFound` と middleware が返す 404、500、401 などは入りません。web は `res.status` の残りを共通の Problem として扱い、共通の `type` の union (`shared-kernel` の schema) で絞ります。`defaultHook` の 400 は、route が 400 を書いたときだけ型に出ます。
  - `.openapi({ "x-extensible-enum": [...] })` で、spec の `type` を `string` と `x-extensible-enum` にでき、TypeScript の型はリテラルの union のままです。
  - oasdiff 1.34.1 は、`enum` の `type` に値を足すと `response-property-enum-value-added` (ERR) で止め、`x-extensible-enum` に足すと止めません。
- 実装 ([Issue #307](https://github.com/yokozi-jp/agent-software-factory/issues/307)): `shared-kernel` の `problem.ts` に `problemSchema`、`problemTypes`、`problemResponse`、`commonProblemResponses`、`problemErrorHandler`、`problemNotFoundHandler` を置いた。`HTTPException` が持つ `res` は使わず、エラー応答はすべて `problemResponse` の形にする。5xx のログは、Hono のロギング ([Issue #327](https://github.com/yokozi-jp/agent-software-factory/issues/327)) まで `console.error` に例外の型と path だけを出す。
- `domain` の失敗の `_tag` を足したら、`http` の `switch`、route の `type` の一覧、web の文面の 3 か所を足します。足し忘れは型の検査が止めます。
- `type` の名前を変えると、クライアントが壊れます。名前は `_tag` から機械的に決まるので、`_tag` の改名も同じ扱いです。
- Better Auth の `/api/auth/*` だけ、エラーの形が違います。

## 出典

- Problem Details の `type`、`title`、`status`、拡張のメンバー、`about:blank`: [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) (3.1.1、4.2.1)
- `defaultHook` と route の応答 schema、`hc` の型 (上の確認で使った版): [`@hono/zod-openapi` の README](https://github.com/honojs/middleware/tree/main/packages/zod-openapi)
- Better Auth の `onAPIError.onError` が通知だけであること: Better Auth 1.7.12 の `onAPIError` の実装 (2026-10-28 より前に Issue #221 で読んだ。応答を替える手段は見つからなかった)
- 応答の enum への値の追加が ERR で、`x-extensible-enum` では止まらないこと: oasdiff 1.34.1 の実行 (2026-10-28 に確かめた) と、main の [`checker/rules.go`](https://github.com/oasdiff/oasdiff/blob/main/checker/rules.go)。固定する版は #190 で決める
