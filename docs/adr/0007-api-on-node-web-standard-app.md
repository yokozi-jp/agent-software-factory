---
type: ADR
title: "ADR 0007: API のランタイムは Bun に移行せず Node.js のままにし、アプリのコードは Web 標準の API だけで書く"
description: apps/api を Bun に移行せず Node.js で動かし、Lambda、Cloudflare Workers、ECS のどれにも載せられるように、apps/api/src と packages/*/src のランタイム固有のコードを入口のファイルに閉じ込める決定。
tags: [adr, tooling, api, hono, runtime]
---

# ADR 0007: API のランタイムは Bun に移行せず Node.js のままにし、アプリのコードは Web 標準の API だけで書く

API (`apps/api`) のデプロイ先の候補は、AWS Lambda、Cloudflare Workers、ECS です。このうち Bun を使えるのは ECS だけです (2026-10 時点)。

- Lambda のマネージドランタイムに Bun はありません。Lambda Web Functions も「currently support Node.js runtimes only」で、使えるのは `nodejs24.x` だけです (docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.html)。
- Cloudflare Workers は workerd で動き、Node.js も Bun も使いません。

Hono が Bun 上で速いのは主にサーバー部分で、Node.js では `@hono/node-server` が `IncomingMessage` を `Request` に変換する分だけ遅くなります (hono.dev/docs/concepts/benchmarks)。DB や外部 API を待つ API では、この差はほとんど効きません。Vite+ と Nx も Node.js を前提にしています。そのため、ランタイムは Node.js のままにしました。

その代わり、`apps/api/src` と、モジュールを置く `packages/*/src` のコードは Web 標準の API だけで書きます。モジュールは `apps/api` から呼ばれて同じランタイムで動くので、モジュールがランタイム固有の API を使えば、`apps/api` の入口だけに閉じ込めても意味がなくなります。Hono は `fetch(Request) => Response` で動くので、ランタイムやデプロイ先の違いは入口のファイルで吸収できます。

## ルール

- `apps/api/src` と `packages/*/src` では、Node.js の組み込みモジュール、`bun` と `bun:*`、ランタイム用の adapter (`@hono/node-server`、`@hono/aws-lambda`、`@hono/node-ws`) を import しません。グローバルの `process`、`Bun`、`Buffer`、`__dirname`、`__filename`、`require` も使いません。環境変数は `c.env` で受け取ります。
- 同じグローバルを `globalThis` から読む書き方も止めます。`no-restricted-globals` は名前の直接の参照だけを止めるので、`no-restricted-properties` で `globalThis.process`、`globalThis.Bun`、`globalThis.Buffer` を止めます。`globalThis["process"]` のような文字列のアクセスと、`const { process } = globalThis` の分割代入も止まります (Oxlint 1.89.0 で 2026-10-28 に確かめました)。Node.js の別名 `global` は `global.process` と書かれるので、`no-restricted-globals` で `global` ごと止めます (`globalThis` を使います)。
- 止められない書き方が残ります。`const g = globalThis; g.process`、`Reflect.get(globalThis, "process")`、`eval` や `Function` で組み立てる名前は、静的な検査では見つけられません。これらはレビューで止めます。
- ランタイム固有のコードは入口のファイル (今は `server.ts`) にだけ置きます。入口のファイル名は、`server.ts` のようにランタイムやデプロイ先が分かる名前にします。
- ルールはルートの `vite.config.ts` の `lint.overrides` で設定していて、`vp check` (pre-commit と CI) で止まります。入口のファイルとテスト (`apps/api/src/server.ts`、`apps/api/src/**/*.test.ts`、`packages/*/src/**/*.test.ts`) は、ランタイムのグローバルと Node.js の組み込みモジュールの制限の対象から外しています。ただし `packages/*/src` のテストでは、`bun` と adapter の import は止まったままです。`apps/api` のテストの override は `no-restricted-imports` を深い import の制限だけに置き換えますが、packages ではモジュールごとの override が最後に使われ、その `moduleImports` がランタイムの import の制限も持つためです。テストが `bun` や adapter を import する必要はないので、差はそのままにしています。外すのはこのランタイムの制限だけで、モジュールの深い import を止める `no-restricted-imports` の制限は、入口のファイルとテストにも残ります ([ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md))。

## Considered Options

- **ECS とローカルの入口だけ Bun にする**: Bun の性能を活かせるのは ECS だけです。Lambda と Cloudflare Workers には別の入口が要るので、ランタイムが 2 つになります。ECS で計測して Node.js がボトルネックだと分かったら、`server.ts` を Bun 用に差し替えて移行できます。
- **パッケージマネージャーだけ Bun にする**: pnpm の catalog、`overrides` (vite を `@voidzero-dev/vite-plus-core` に差し替え)、`allowBuilds`、`minimumReleaseAge` を置き換えることになり、Hono との相性には関係しません。
- **全部 Bun にする**: Lambda は custom runtime かコンテナが必要になり、Cloudflare Workers と Lambda Web Functions は使えなくなります。Vite+ が管理するランタイムも Node.js だけです。

## Consequences

- Lambda、Cloudflare Workers の入口を足すときは、その入口を `vite.config.ts` の `lint.overrides` の除外の一覧に追加します。
- Lambda では Lambda Web Functions を使うので、リポジトリを Node.js 24 にすることにしました (ADR 0013)。Web Functions のランタイムは `nodejs24.x` だけで、Lambda Event Functions の `nodejs26.x` は 2026-10 時点で public preview です (docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)。Web Functions が Node.js 26 に対応したら、26 に上げます。
- 検出力 ([Issue #43](https://github.com/yokozi-jp/agent-software-factory/issues/43)) は、`apps/api/src/__fixtures__/runtime-apis.ts` と各 package の `src/__fixtures__/runtime-apis.ts` で確かめます。`process`、`globalThis.process`、`globalThis["process"]`、`global`、`const { process } = globalThis` の行に `oxlint-disable-next-line` を付けてあり、規則を消すか `files` が届かなくなると、使われない disable のコメントで `vp check` が失敗します。各 package の `src/__fixtures__/boundaries.test.ts` は、テストの override がランタイムの制限を外しても、深い import の制限を残すことを確かめます。置き場所は ADR 0026 の `__fixtures__/` と同じで、Knip、jscpd、Nx の `production`、build の対象から外れています。`apps/api` の Vitest も、テストと coverage の対象から外します。
- 新しい package を足すときの書き忘れは、repo-policy (`tools/scripts/src/checks/repo-policy/rules.ts`) が止めます。各 package の `src/__fixtures__/` に、`no-restricted-globals`、`no-restricted-properties`、`import/no-nodejs-modules` の `oxlint-disable-next-line` がある fixture と、`no-restricted-imports` のある `*.test.ts` の fixture が要ります。`vite.config.ts` に `"error"` があるかを文字列で見る検査は、fixture に置き換えました ([Issue #230](https://github.com/yokozi-jp/agent-software-factory/issues/230))。文字列では、規則が対象のパスに届くかが分からないためです。今は、`"error"` の規則はどれも、名前の `oxlint-disable-next-line` が fixture にあるかを repo-policy が確かめます。
- `packages/*/src` の `no-restricted-imports` は、モジュールごとの override が最後に使われるので、ランタイムの import の制限 (`bun`、adapter) もそこ (`moduleImports` と `shared` の override) に持たせています。
- `no-restricted-globals` と `no-restricted-properties` は、各モジュールの `domain` の override ([ADR 0027](0027-domain-model-as-pure-functions-and-unions.md)) も `Date` と `Math.random` のために設定します。最後の override だけが使われるので、`domain` の override にもランタイムの制限を持たせています。`src/domain/__fixtures__/runtime-apis.ts` が、これが外れたら `vp check` を失敗させます。repo-policy は、層のある各モジュールにこのファイルを要求します。`domain` の純粋さの fixture (ADR 0027) と同じ規則名の annotation を持つので、後者の検査はこのファイルを数えません。
