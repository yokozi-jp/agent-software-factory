---
type: ADR
title: "ADR 0047: API の契約は @hono/zod-openapi の route から OpenAPI 3.1 を生成して commit し、web は Hono RPC の hc で型を共有する"
description: apps/api の route を @hono/zod-openapi の createRoute で書き、OpenAPI 3.1 の spec を apps/api/openapi.json に生成して commit する決定。生成は tools/scripts の TypeScript で、テストが再生成して commit した spec との一致を確かめる。検証エラーの形は defaultHook の 1 か所に書く。web は Hono RPC の hc で API を呼び、apps/api の AppType を import type で読むのは 1 か所だけにする。同一オリジンなので CORS の middleware は入れず、spec のサーバー URL は相対パスにする。API の route を足す、変えるとき、openapi.json の差分が出たとき、web から apps/api を import したくなったとき、hono-openapi や Orval や Hono RPC だけに替えたくなったときに読む。
tags: [adr, web-api, openapi, hono, zod, rpc, contract]
---

# ADR 0047: API の契約は @hono/zod-openapi の route から OpenAPI 3.1 を生成して commit し、web は Hono RPC の hc で型を共有する

`apps/api` は素の Hono で、OpenAPI を出しませんでした。Spectral や oasdiff のような契約の検査は生成した spec が前提で、web と API は別々にデプロイされ、新旧が混ざる間があります ([docs/web-api/versioning.md](../web-api/versioning.md))。API の route から spec を生成し、web が同じ契約の型で API を呼べるようにするため、方式を決めます ([Issue #147](https://github.com/yokozi-jp/agent-software-factory/issues/147)、実装は [Issue #189](https://github.com/yokozi-jp/agent-software-factory/issues/189))。

## 決定

- **route の書き方**: `@hono/zod-openapi` の `OpenAPIHono` と `createRoute` で書きます。応答のステータスコードは route に明示します。Zod 専用です (peer `zod ^4`、`hono >=4.10.0`)。
- **spec**: OpenAPI 3.1 (`getOpenAPI31Document`) です。生成した spec は 1 つ、`apps/api/openapi.json` に置いて commit します。PR の差分で、人が API の変更を読めます。
- **生成**: `tools/scripts/src/openapi/cli.ts` が書きます (`pnpm exec nx openapi api`)。`apps/api` のコードは `node:fs` を使わない ([ADR 0007](0007-api-on-node-web-standard-app.md)) ので、ファイルへの書き込みはここに閉じます ([ADR 0024](0024-scripts-and-hooks-in-typescript.md))。`openapi.json` は生成物なので、フォーマッタと lint の対象から外します。
- **drift の検出**: `apps/api/src/openapi.unit.test.ts` が spec を route から再生成し、commit した `openapi.json` と突き合わせます。古い spec が commit されると、`ci.yml` の `api:test` が落ちます。同じテストが、route を欠いた古い spec とは一致しないことを確かめます。
- **検証エラーの形**: `defaultHook` の 1 か所 (`apps/api/src/http/validation-hook.ts`) に書きます。RFC 9457 の Problem Details (`type: /problems/validation`) で、`errors` に `pointer` と `code` を持ちます ([ADR 0035](0035-problem-details-for-api-errors.md))。Problem の schema を `shared-kernel` に移すのは [Issue #307](https://github.com/yokozi-jp/agent-software-factory/issues/307) です。
- **同一オリジン**: web と API は同じオリジン (`/api/*`、[ADR 0022](0022-better-auth-cookie-bff.md)) なので、CORS の middleware は入れず、spec のサーバー URL は相対パス `/` にします。[Issue #114](https://github.com/yokozi-jp/agent-software-factory/issues/114) の結論が覆ったら、この部分だけ直します。
- **web の呼び方**: Hono RPC の `hc` を使います。`apps/api` の `package.json` の `exports` は `src/contract.ts` で、`AppType` の型だけを出します。web が `@agent-software-factory/api` を import してよいのは `apps/web/src/lib/api-client.ts` の `import type` 1 か所だけで、ほかの import は Oxlint の `no-restricted-imports` が止めます。API の route の入力や応答を変えると、web の型検査が直接落ちます。

## Considered Options

- **hono-openapi** (第三者製): Standard Schema を通して Zod 以外の schema library も使えます。ただ、この repo は Zod だけを使うので、その柔軟さは要りません。`@hono/zod-openapi` は Hono の組織の monorepo にあり、版が安定しています。
- **Hono RPC だけ** (spec を出さない): コード生成も spec もなく、いちばん軽いです。ただ、Spectral と oasdiff が使えず、検証を OpenAPI に寄せる前提 ([docs/web-api/validation-and-code-values.md](../web-api/validation-and-code-values.md)) も捨てることになります。
- **Orval で client を生成する**: spec から型と client を作れ、MSW の mock も生成できます。ただ、生成物が増え、今は web に MSW が要りません。MSW が要るようになったら足します。
- **spec を commit せず CI だけで生成する**: PR の差分に API の変更が出ず、レビューで見えません。oasdiff が main の版とそのまま比べるのにも、commit した spec が要ります。

## Consequences

- API の route を変えたら `pnpm exec nx openapi api` を実行し、`openapi.json` を commit します。忘れると `api:test` が落ちます。
- `apps/web` の依存に `apps/api` が増え、Nx の project graph にアプリ同士の依存が出ます。import が 1 か所に限られるので、API のコードが web の bundle に入ることはありません。
- `createApp` の戻り値の型 (`AppType`) は、`createApp` の中で chain した route だけを含みます。`auth` を渡したときだけ付く `/api/auth/*` と `/api/me` は、まだ契約に入っていません。契約に足すときは `createRoute` で書き直します。
- Spectral と oasdiff のゲートは [Issue #190](https://github.com/yokozi-jp/agent-software-factory/issues/190) で足します。

## 出典

- `OpenAPIHono`、`createRoute`、`defaultHook`、`getOpenAPI31Document`: [`@hono/zod-openapi` の README](https://github.com/honojs/middleware/tree/main/packages/zod-openapi)
- `hc` と `AppType`: [Hono の RPC のガイド](https://hono.dev/docs/guides/rpc)
