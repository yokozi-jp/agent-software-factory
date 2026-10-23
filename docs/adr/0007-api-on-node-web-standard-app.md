---
type: ADR
title: "ADR 0007: API のランタイムは Bun に移行せず Node.js のままにし、アプリのコードは Web 標準の API だけで書く"
description: apps/api を Bun に移行せず Node.js で動かし、Lambda、Cloudflare Workers、ECS のどれにも載せられるように、ランタイム固有のコードを入口のファイルに閉じ込める決定。
tags: [adr, tooling, api, hono, runtime]
---

# ADR 0007: API のランタイムは Bun に移行せず Node.js のままにし、アプリのコードは Web 標準の API だけで書く

API (`apps/api`) のデプロイ先の候補は、AWS Lambda、Cloudflare Workers、ECS です。このうち Bun を使えるのは ECS だけです (2026-10 時点)。

- Lambda のマネージドランタイムに Bun はありません。Lambda Web Functions も「currently support Node.js runtimes only」で、使えるのは `nodejs24.x` だけです (docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.html)。
- Cloudflare Workers は workerd で動き、Node.js も Bun も使いません。

Hono が Bun 上で速いのは主にサーバー部分で、Node.js では `@hono/node-server` が `IncomingMessage` を `Request` に変換する分だけ遅くなります (hono.dev/docs/concepts/benchmarks)。DB や外部 API を待つ API では、この差はほとんど効きません。Vite+ と Nx も Node.js を前提にしています。そのため、ランタイムは Node.js のままにしました。

その代わり、`apps/api/src` のコードは Web 標準の API だけで書きます。Hono は `fetch(Request) => Response` で動くので、ランタイムやデプロイ先の違いは入口のファイルで吸収できます。

## ルール

- `apps/api/src` では、Node.js の組み込みモジュール、`bun` と `bun:*`、ランタイム用の adapter (`@hono/node-server`、`@hono/aws-lambda`、`@hono/node-ws`) を import しません。グローバルの `process`、`Bun`、`Buffer`、`__dirname`、`__filename`、`require` も使いません。環境変数は `c.env` で受け取ります。
- ランタイム固有のコードは入口のファイル (今は `server.ts`) にだけ置きます。入口のファイル名は、`server.ts` のようにランタイムやデプロイ先が分かる名前にします。
- ルールはルートの `vite.config.ts` の `lint.overrides` で設定していて、`vp check` (pre-commit と CI) で止まります。入口のファイルとテスト (`*.test.ts`) は対象から外しています。

## Considered Options

- **ECS とローカルの入口だけ Bun にする**: Bun の性能を活かせるのは ECS だけです。Lambda と Cloudflare Workers には別の入口が要るので、ランタイムが 2 つになります。ECS で計測して Node.js がボトルネックだと分かったら、`server.ts` を Bun 用に差し替えて移行できます。
- **パッケージマネージャーだけ Bun にする**: pnpm の catalog、`overrides` (vite を `@voidzero-dev/vite-plus-core` に差し替え)、`allowBuilds`、`minimumReleaseAge` を置き換えることになり、Hono との相性には関係しません。
- **全部 Bun にする**: Lambda は custom runtime かコンテナが必要になり、Cloudflare Workers と Lambda Web Functions は使えなくなります。Vite+ が管理するランタイムも Node.js だけです。

## Consequences

- Lambda、Cloudflare Workers の入口を足すときは、その入口を `vite.config.ts` の `lint.overrides` の除外の一覧に追加します。
- Lambda Web Functions を使うときは、Node.js 24 で動くようにする必要があります。このリポジトリは Node.js 26 (`.node-version`、`engines`、build の target `node26`) なので、デプロイ先を決めるときに判断します。
