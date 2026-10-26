---
type: ADR
title: "ADR 0017: 未使用のファイル、export、依存は Knip で検査し、例外は理由とともに個別に書く"
description: pnpm workspace の全てのプロジェクトとルートを Knip 6.42.1 で検査し、未参照のファイル、未使用の export、未使用の依存が見つかったら pre-commit hook と CI で失敗させる決定。例外を entry、project、ignoreDependencies、@public で個別に書き、不要になった例外も失敗させる。Knip で止まったとき、例外を足すとき、Knip の版や設定を変えるときに読む。
tags: [adr, tooling, knip, ci, quality, dependencies]
---

# ADR 0017: 未使用のファイル、export、依存は Knip で検査し、例外は理由とともに個別に書く

どこからも使われていないファイル、export、依存を見つけるものはありませんでした。TypeScript の `noUnusedLocals` や oxlint の `no-unused-vars` は 1 つのファイルの中しか見ません。ほかのファイルから import されない export や、`package.json` に残った依存は見えません。そこで Knip で、workspace 全体の import のつながりを見て検査します。

- **道具**: Knip 6.42.1 です。版は `pnpm-workspace.yaml` の catalog で固定し、ルートの devDependencies に入れます。導入した 2026-10-24 の最新版は 6.43.0 でしたが、その日に公開されたもので、pnpm の `minimumReleaseAge` (v11 からの既定値は 1440 分) より新しい版でした。`pnpm add knip@6.43.0` を実行すると、pnpm 12.15.0 は `minimumReleaseAgeExclude` に `knip@6.43.0` を書き足しました。例外の要らない 1 つ前の 6.42.1 にしました。
- **実行の経路**: ルートの `package.json` の `lint:unused` (`knip`) を、CI の `ci.yml` の `checks` job と、Knip が読むファイルを変えた commit の pre-commit hook から呼びます。設定はすべて `knip.jsonc` に書くので、どちらも同じ検査です。[ADR 0002](0002-nx-orchestrates-vite-plus.md) に従い、`pnpm lint:dup` ([ADR 0014](0014-jscpd-duplication-threshold.md)) と同じ形にしました。
- **対象**: `pnpm-workspace.yaml` の全てのプロジェクト (今は `apps/api`、`apps/web`、`tools/scripts`) とルートです。Knip は `pnpm-workspace.yaml` を読み、workspace ごとに entry を決めます。Knip の plugin が、`package.json` の scripts と、GitHub Actions の workflow、`lefthook.yml`、Vite+、Vite、Vitest、TanStack Router、Nx、mise、commitlint、markdownlint などの設定から、entry と使っている依存を読みます。今動いている plugin は `knip --debug` の `Enabled plugins` で分かります。
- **例外の書き方**: Knip の docs に従い、一括の `ignore` を使わず、例外を 1 つずつ書きます。理由は `knip.jsonc` のその行のそばに書きます。
  - `entry`: Knip が読まない場所から呼ばれるファイル。`tools/scripts/src/checks/renovate-preview/cli.ts` はシェルスクリプト (`tools/scripts/sh/renovate.sh`) から、`apps/api/src/server.ts` は `vite.config.ts` の `build.ssr` から呼ばれます。
  - `project`: 検査の対象から外すもの。`.agents/` は upstream から入れた skill で、このリポジトリのコードではありません。
  - `ignoreDependencies`: コードや Knip が読む設定から使われない依存。`@iwe-org/iwe` は docs-check の入口 (`tools/scripts/src/checks/docs-check/cli.ts`) がパスで呼ぶ実行ファイルと、Kiro の MCP の設定から、`@nx/js` は `nx release` から読み込まれます。
  - export の例外は、その export に `/** @public */` を付け、理由のコメントを添えます。今はありません。
- **不要になった例外**: `treatConfigHintsAsErrors` を有効にしました。entry や ignore が不要になったり、どのファイルにも合わなくなったりすると、Knip は configuration hint を出します。この設定で、hint も失敗にします。

## 導入時の指摘

設定のない Knip は、次の 8 件を報告しました。

| 指摘                                                                                  | 対応                                                      |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 未使用のファイル `apps/api/src/server.ts` と、それだけが使う `@hono/node-server`      | `entry` に足す (production の入口)                        |
| 未使用のファイル `scripts/docs-links.mjs`                                             | `entry` に足す (`scripts/docs-check.sh` が `node` で呼ぶ) |
| 未使用のファイル `.agents/skills/setup-ts-deep-modules/dependency-cruiser.config.cjs` | `project` から `.agents/` を外す                          |
| `apps/api` の未使用の devDependency `vite`                                            | 削除する                                                  |
| ルートの未使用の devDependency `@iwe-org/iwe` と `@nx/js`                             | `ignoreDependencies` に足す                               |
| `apps/api/src/app.ts` の未使用の export の型 `AppType`                                | 削除する                                                  |

`apps/api` の `vite` は、本当に使われていませんでした。`apps/api` のコードは `vite-plus` からだけ import し、`@hono/vite-dev-server` の実行時のコードも `vite` を import しません。Vite+ の migration の規則も、`vite-plus` だけを使う pnpm のパッケージには `vite` の entry が要らないとしています。削除した後も `api` の check、build、test が通ることを確かめました。`apps/web` の `vite` は、`tsconfig.json` の `types: ["vite/client"]` で使うので残ります。
ただ、`@hono/vite-dev-server` の型定義 (`.d.mts`) は、依存に書いていない `vite` から型を import します。この import は、pnpm が既定で `node_modules/.pnpm/node_modules` に置く `vite` (`vite-plus-core` への alias) で解決されます。

`AppType` は Hono の RPC client (`hc<AppType>`) が API の型を受け取るための型ですが、使う client がまだありません。web から API を呼ぶ PR で足し直します。

設定を書いた後、`tools/scripts/src/configs/knip.tools.test.ts` (当時は `scripts/test/unused-code.test.sh`) で次を確かめました。

- Knip が失敗し、そのものを報告すること: 未使用の export、未使用のファイル、使わない依存を足したとき。使っている依存を `ignoreDependencies` に書いたとき。
- 通ること: `@public` を付けた export、`.agents/` の下のファイル。

## Considered Options

- **各プロジェクトの Nx の target にする**: Knip は `--workspace` で workspace を 1 つずつ検査できます。ただ、そのときも、祖先、依存先、依存元の workspace を一緒に読みます。Nx の target に分けても読む範囲はほとんど変わらず、設定を target ごとに書くことになります。今の 2 つのプロジェクトとルートの検査は 2 秒ほどで終わるので、Nx の cache も要りません。これは判断です。
- **production mode (`--production`) と `--strict` も CI で実行する**: テストと設定のファイルを除いて、本番のコードだけで使われていないものを見つけます。`dependencies` と `devDependencies` の取り違えも見つかります。今はまだ実行しません。テストがほとんどなく、default mode との差が小さいためです。これは判断です。入れるときは、本番の entry (`src/server.ts` など) に `!` を付けます。付けないと、production mode ではその entry が使われません。
- **設定を `knip.ts` に書く**: 型の補完と正規表現が使えます。ただ、設定ファイルそのものが TypeScript のコードとして Knip と `vp check` の対象になり、実行もされます。`knip.jsonc` ならコメントで理由を書け、`$schema` (`schema-jsonc.json`) で検証もできるので、こちらにしました。
- **depcheck、unimported、ts-prune**: depcheck は依存だけを、ts-prune は export だけを見ます。unimported は archive されています。depcheck と unimported の README は、どちらも Knip への移行を勧めています。

## Consequences

- 新しい export を足すときは、同じ PR でそれを使います。使う予定の export は、使う PR で足します。外のパッケージやツールから使われるので import が見えない export には、`@public` と理由を書きます。
- Knip は既定で、entry のファイルの export を検査しません。`apps/web` は `main.tsx` と route のファイルがすべて entry なので、今は export の検査が効く場所がありません。`apps/api` では `src/app.ts` だけが対象です。
- Knip が読めない場所 (シェルスクリプト、Kiro の設定など) からだけ使う依存やファイルを足したら、`knip.jsonc` に例外と理由を書きます。その場所を pre-commit hook の `glob` にも足します。足さないと、例外が要らなくなっても CI まで分かりません。
- 検査は作業ツリーを丸ごと見ます。未使用かどうかは、ほかのファイルの import で決まるためです。commit していない作業用のファイル (`.gitignore` の対象でないもの) も、ローカルでは検査の対象になります。
- `apps/web/src/routeTree.gen.ts` がないと、Knip は route のファイルを見つけられません (Knip の docs の「Missing generated files」)。このファイルは commit しているので、CI にもあります。
- 版を上げるときは、`pnpm-workspace.yaml` の catalog の版を変えて `pnpm install` を実行します。`pnpm-workspace.yaml` を変えた commit では、pre-commit hook が `pnpm lint:unused` とテストを実行します。新しい版で指摘が増えたら、同じ PR で直します。

## 出典

- 例外の書き方 (一括の `ignore` を避け、entry と project を直す)、entry の export を既定で検査しないこと、「Missing generated files」: [Knip の Configuring Project Files](https://knip.dev/guides/configuring-project-files)、[Handling Issues](https://knip.dev/guides/handling-issues)
- configuration hint とその直し方: [Knip の Configuration Hints](https://knip.dev/reference/configuration-hints)
- `treatConfigHintsAsErrors`、`ignoreDependencies`、JSONC 用の `schema-jsonc.json`: [Knip の Configuration](https://knip.dev/reference/configuration)
- workspace の読み方と `--workspace`: [Knip の Monorepos & Workspaces](https://knip.dev/features/monorepos-and-workspaces)
- `@public`: [Knip の JSDoc & TSDoc Tags](https://knip.dev/reference/jsdoc-tsdoc-tags)
- `minimumReleaseAge` の既定値: [pnpm の Dependency Resolution settings](https://pnpm.io/settings/dependency-resolution)
- `vite-plus` だけを使うパッケージに `vite` が要らないこと: [Vite+ の migrate rules](https://github.com/voidzero-dev/vite-plus/blob/main/docs/guide/migrate-rules.md)
- `nx release` が既定で `@nx/js/src/release/version-actions` を読むこと: `node_modules/nx/dist/src/command-line/release/config/config.js` の `DEFAULT_VERSION_ACTIONS_PATH` (nx 24.0.0)
- unimported が archive されたこと、depcheck と unimported が Knip を勧めること: [smeijer/unimported](https://github.com/smeijer/unimported)、[depcheck/depcheck](https://github.com/depcheck/depcheck) の README
