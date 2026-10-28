---
type: ADR
title: "ADR 0032: 環境変数は入口のファイルが読んで検査し、createApp に引数で渡す"
description: ADR 0007 の「環境変数は c.env で受け取ります」を、「入口のファイルが環境変数を読んで検査し、createApp に引数で渡す。apps/api/src は process を読まない」に直す決定。Node.js の入口では c.env が環境変数を持たないため。Cloudflare Workers に移すときは、入口が fetch(request, env) で受けた env を同じ引数で渡す。比べた案は fetch の第 2 引数に process.env を渡して c.env で読む案と hono/adapter の env(c)。環境変数の読み方や検査を変えるとき、createApp の引数を変えるとき、アプリのコードで c.env や process.env を読みたくなったときに読む。
tags: [adr, api, hono, runtime, env]
---

# ADR 0032: 環境変数は入口のファイルが読んで検査し、createApp に引数で渡す

環境変数は入口のファイル (今は `apps/api/src/server.ts`) が読んで検査し、`createApp` に引数で渡します。`apps/api/src` の入口以外は `process` を読みません。[ADR 0007](0007-api-on-node-web-standard-app.md) の「環境変数は `c.env` で受け取ります」を、この決定に置き換えます。ADR 0007 のほかのルールは変えず、本文も書き換えません。決定は [.env と環境変数の置き方、読み方、検査を決める](https://github.com/yokozi-jp/agent-software-factory/issues/216) の解決コメントにあります。

## 背景

ADR 0007 の文言と実装が食い違っています。

- `@hono/node-server` の入口では、`c.env` は `{ incoming, outgoing }` で、Node.js の `IncomingMessage` と `ServerResponse` です。環境変数は入っていません ([Hono: Node.js](https://hono.dev/docs/getting-started/nodejs)の「Access the raw Node.js APIs」)。
- Cloudflare Workers では、Workers が `fetch(request, env, ctx)` で渡す `env` が `c.env` になり、環境変数や secret が入ります ([Hono: Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)の「Bindings」、[Hono: API](https://hono.dev/docs/api/hono)の「fetch()」)。
- 実装は `server.ts` が `process.env` を読み、`createAuth` に値を渡し、できた `auth` を `createApp` に渡しています。`c.env` は読んでいません。

`c.env` で受け取るというルールに従うと、Node.js の入口では環境変数が取れません。ルールを実装に合わせて直します。

## ルール

- **読む場所**: 環境変数を読むのは入口のファイルだけです。入口が値を検査し、足りなければ起動時に失敗させます (fail closed)。検査は `apps/api/src/env.ts` の zod の schema と `loadEnv` で行い、入口が `process.env` を渡します ([Issue #254](https://github.com/yokozi-jp/agent-software-factory/issues/254))。真偽の変数は `z.stringbool()` で読みます (`z.coerce.boolean()` は `"false"` を `true` にします)。数値は `z.coerce.number()` が空文字を `0` にするので、文字列の形を先に確かめます。
- **渡し方**: 入口が `createApp` (と、それが使うファクトリー関数) に引数で渡します。`apps/api/src` の入口以外と `packages/*/src` は、環境変数を `process` からも `c.env` からも読まず、引数で受けた値だけを使います。
- **Cloudflare Workers**: 入口を足すときは、`fetch(request, env)` で受けた `env` を、Node.js の入口と同じ引数の形で `createApp` に渡します。アプリのコードは入口の違いを知りません。Workers の入口はまだなく、`env` は request ごとに届くので、検査の結果をいつ作って持つかは、その入口を足すときに決めます (判断)。
- **lint**: `process` を止める Oxlint の規則 (ルートの `vite.config.ts` の `runtimeGlobals`) のメッセージを、「Read environment variables from `c.env`.」から、この決定に合わせた文言に直します。止める対象は変わりません。

## Considered Options

- **Node.js の入口が `fetch` の第 2 引数に `process.env` を渡し、アプリは `c.env` で読む**: ADR 0007 の文言をそのまま保てます。ただし Node.js の入口の `c.env` には `{ incoming, outgoing }` が入っているので、入口がそれを残しながら環境変数を足すか、差し替えるかを決める必要があります (判断)。値の検査もリクエストごとの `c.env` の中になり、`createAuth` のように起動時に値が要る処理 (Better Auth の `secret` や `baseURL`) に渡せません (判断)。
- **`hono/adapter` の `env(c)` で読む**: Node.js では `process.env`、Cloudflare Workers では Bindings を返します ([Hono: Adapter Helper](https://hono.dev/docs/helpers/adapter))。入口の違いは吸収できますが、アプリのコードがランタイムの判定に依存し、読む場所が入口からルートのハンドラーに散ります。環境変数の一覧と検査を入口の 1 か所に置けず、テストでは `c` に環境変数を仕込む必要があります (判断)。
- **ADR 0007 を書き換える**: 文言は直りますが、決定の履歴が残りません。ADR は書き換えず、新しい ADR から参照します。

## Consequences

- ADR 0007 を読むときは、環境変数の項目だけこの ADR が優先します。
- `process` を止める Oxlint の規則のメッセージが変わります。`process` の fixture (`src/__fixtures__/runtime-apis.ts`) は `oxlint-disable-next-line` の有無で検査するので、メッセージの文言には依存しません。
- 検査の実装と、`.env.example` と schema の key の一致のテストは、`apps/api/src/env.ts` と `env.test.ts` にあります。この ADR は文言と方針だけを決めます。
