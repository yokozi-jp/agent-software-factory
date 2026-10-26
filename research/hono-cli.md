# Hono CLI（`@hono/cli`）が、このリポジトリで API を書くエージェントを速くするかを調べる

## 問い

[Issue #217](https://github.com/yokozi-jp/agent-software-factory/issues/217) の調査。結果は [Hono CLI を入れるかを決める（#218）](https://github.com/yokozi-jp/agent-software-factory/issues/218) の材料にする。決定はここでは下さない。

1. サブコマンドの中身と出力。
2. `hono request` でサーバーを起動せずにアプリを呼べるか。ADR 0007 の入口の分け方、`@hono/zod-openapi`、Better Auth の Cookie、RLS の DB 接続と両立するか。
3. 今の手段（Vitest の `app.request()`、`hc` のクライアント、開発サーバー）と比べて、何が増えるか。
4. 入れ方（mise、`pnpm` の devDependency、`npx`）と、版と保守の状態。
5. Kiro の skill や steering から使う形。

調べた日は 2026-10-26。コマンドは `/tmp` に入れた `@hono/cli` 0.1.11 と 1.0.0-rc.8 で実際に動かし、このリポジトリの `apps/api` を読ませた。リポジトリの中には、ファイルも `node_modules` も足していない。

## 要約

- 確かめた事実: 公式ドキュメントの `hono routes`、`request`、`batch`、`snapshot`、`diff`、`benchmark`、`ssg`、`init` は `next` タグ（1.0.0-rc.8）にだけあり、`latest`（0.1.11）にない。0.1.11 にあるのは `docs`、`search`、`request`、`serve`、`optimize` で、issue #217 の一覧は 2 つの版が混ざっている。`next` には `docs`、`search`、`serve`、`optimize` がない。
- 確かめた事実: `hono request` と `hono routes` は、サーバーを起動せずに `apps/api/src/index.ts` を呼べた（`/health` は 200 で約 0.75 秒）。ただし CLI が読むのは default export の Hono だけで、`app.ts`（名前付き export だけ）と `server.ts`（`serve()` を呼ぶ）は読めない。
- 確かめた事実: 認証つきの `createApp({ auth })` は、default export する小さな入口ファイルを `/tmp` に置けば、`routes`、`request`、`batch` で呼べた。`batch` は Secure な `__Host-` の Cookie も次の step に運び、CSRF の 403 と 415 も再現した。本物の Better Auth、Keycloak、RLS つきの PostgreSQL では試していない。
- 判断: 増えるのは、Vitest を書かずに 1 コマンドで確かめる手段、`routes` と `diff` による「アプリの現状」の読み取り、Hono の資料（llms.txt）への案内だ。Vitest の `app.request()` の代わりにはならない。テストは残り、CI の判定には使えない。
- 判断: 版は `next` の rc が実質的な標準（Hono の skill も `@hono/cli@next` を指す）が、`latest` は 0.1.11 のまま。ADR 0009 の mise の npm backend は使えるが、アプリの devDependency（pnpm の catalog）の方が Hono の公式の置き方に近い。決める論点は末尾に並べた。

## 1. サブコマンドと出力

### 版ごとの違い（確かめた事実）

| 項目               | `latest` 0.1.11（2026-08-05）                                | `next` 1.0.0-rc.8（2026-10-15）                                                                                |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| コマンド           | `docs`、`search`、`request`、`serve`、`optimize`             | `routes`、`request`、`batch`、`browse`、`snapshot`、`diff`、`benchmark`、`ssg`、`init`、`agent-init`           |
| 既定の出力         | `request` は status、headers、body の JSON。`search` は JSON | 全コマンドが `{ "ok": true, "data": ... }` か `{ "ok": false, "error": { code, message, suggestions, docs } }` |
| `request` の呼び方 | `hono request -P /path [file]`                               | `hono request /path [file]`（path は位置引数）                                                                 |
| `engines.node`     | `>=22.13.0`                                                  | `>=22.13.0`                                                                                                    |
| 主な依存           | `hono`、`esbuild`、`commander`、`@hono/node-server`          | `hono`（`^4.9.12 \|\| ^5.0.0-0`）、`esbuild`、`commander`、`@inquirer/select`、`@bluwy/giget-core`             |

- 出典: [npm の `@hono/cli`](https://www.npmjs.com/package/@hono/cli)（`npm view @hono/cli` で dist-tags と time を確かめた）、[honojs/cli の release](https://github.com/honojs/cli/releases)、`hono --help`（両方の版を実行した）、[Hono CLI](https://hono.dev/docs/agents/cli)。
- 公式の README（[honojs/cli の README](https://github.com/honojs/cli/blob/main/README.md)）は main で 0.1.11 の内容（`docs`、`search`、`serve`、`optimize`）を書き、公式サイトの [Hono CLI](https://hono.dev/docs/agents/cli) は `next` の内容（`routes`、`batch`、`diff` など）を書く。2 つの一次情報が食い違うのは、サイトが先に 1.0 に移ったため（判断）。`next` の最後の release の本文は、`browse` と `agent-init` と `diff` の docs を足したと書く（[v1.0.0-rc.8](https://github.com/honojs/cli/releases/tag/v1.0.0-rc.8)）。

### `next` の各コマンド（公式ドキュメントの要約。`request`、`routes`、`batch` は実行して確かめた）

| コマンド                | 中身                                                                                                                                                    | このリポジトリで確かめたか                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `routes [file]`         | 実際のアプリから経路を読む（`showRoutes()` と同じ）。`--verbose` で middleware も出す。`--plain` で人向け                                               | 実行した。`index.ts` は 1 経路、認証つきは 4 経路 |
| `request [path] [file]` | `app.request()` を 1 回呼ぶ。`-X`、`-d`（`@file`、`@-`）、`-H`、`--trace`、`--runtime`（node、bun、deno、workerd、vite）                                | 実行した                                          |
| `batch <source> [file]` | JSONL の複数の要求を 1 つのアプリ instance に順に送る。`expect`（status、body の部分一致）と `save` を持つ。Cookie を引き継ぐ。失敗は `diff` 付き       | 実行した                                          |
| `snapshot [file]`       | 引数なしの GET 経路を実行し、結果を `expect` にした batch の行で出す。ファイルは書かない                                                                | 実行していない                                    |
| `diff`                  | 最後の commit と今の作業ツリーでアプリを動かし、GET 経路の応答の差を出す。一時的な git worktree を使う                                                  | 実行していない（main の作業ツリーに触れないため） |
| `benchmark [file]`      | `app.request()` を直接呼ぶ micro benchmark。HTTP も network もない                                                                                      | 実行していない                                    |
| `ssg [file]`            | 静的ファイルを書き出す                                                                                                                                  | 実行していない（API には使わない見込み、判断）    |
| `init`、`agent-init`    | `init` は create-hono のテンプレートを今のディレクトリに足す。`agent-init` は AGENTS.md に「Hono CLI」の節を書き、devDependencies に `@hono/cli` を足す | `--help` だけ読んだ                               |
| `browse <path>`         | happy-dom に頁を読み込み、JavaScript を動かし、入力とクリックをする                                                                                     | 実行していない（API には使わない見込み、判断）    |

- 出典: [Hono CLI](https://hono.dev/docs/agents/cli)、`hono <command> --help`（1.0.0-rc.8）。
- `hono --help` の先頭に「For coding agents」の注意書きがある（JSON の契約、`routes` から読み始める、複数の要求は `batch` にまとめる、変更後は `diff`）。`hono <command> --help` に例がある（同、1.0.0-rc.8 を実行して確かめた）。

### 0.1.11 の `docs` と `search`（確かめた事実）

- `hono search "zod openapi" -l 2` は JSON で `/examples/zod-openapi` を返し、`hono docs /docs/guides/rpc` は RPC の頁を Markdown で出した（0.1.11 を実行した）。`search` は Algolia を使う（[honojs/cli の README](https://github.com/honojs/cli/blob/main/README.md)）。
- `next` には `docs` も `search` もない。代わりに Hono は、全頁を `Accept: text/markdown` で取れるようにし、`/llms.txt`（頁の一覧）、`/llms-full.txt`、`/llms-small.txt` を置いた（[Hono for Coding Agents](https://hono.dev/docs/agents)）。判断: 1.0 では「資料を引く」役を CLI から外し、HTTP で直接取る形に移したと読める（理由は一次情報に書かれていない）。

## 2. サーバーを起動せずにアプリを呼べるか

### 仕組み（確かめた事実）

- CLI は esbuild でアプリのファイルを束ね、`app.request()` を呼ぶ。ファイルは TypeScript と JSX を直接読める（[Hono CLI](https://hono.dev/docs/agents/cli)）。
- 読むのは default export の Hono instance だけ。`apps/api/src/app.ts` を渡すと、1.0.0-rc.8 は `INVALID_APP`（"Export the Hono instance as the default export"）を返す。`app.ts` は `export const app` と `export function createApp` の名前付き export しかない。0.1.11 は同じ入力で "Error building app" を stderr に出したあと、プロセスが終わらなかった（`timeout 15` で打ち切るまで残った）。
- `apps/api/src/server.ts` を渡すと、1.0.0-rc.8 は `UNEXPECTED_ERROR`（`@hono/node-server` を data URL から解決できない）を返し、エラーの文字列に束ねたコード全体が入った（出力が約 5.4 MB）。`server.ts` は読み込むだけで `serve()` を呼び、環境変数がないと投げるので、CLI の対象にならない。

### ADR 0007 の入口の分け方との両立

| 入口                                                        | `hono request` / `routes` で読めたか                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/api/src/index.ts`                                     | 読めた。`vp dev` 用の入口で `export default app`（認証なしの `createApp()`） |
| `apps/api/src/app.ts`                                       | 読めない（default export がない）                                            |
| `apps/api/src/server.ts`                                    | 読めない（`serve()` と環境変数）                                             |
| `/tmp` に置いた入口（`export default createApp({ auth })`） | 読めた（下の「Better Auth の Cookie」）                                      |

- 判断: ADR 0007 の「ランタイム固有のコードは入口のファイルにだけ置く」とは両立する。CLI は `app.ts` の `createApp` を呼べないので、CLI 用に default export する入口が要る。今ある `index.ts` は認証なしなので、`/api/me` のような認証の経路は 404 になる（実行した）。認証つきの経路を CLI から呼ぶには、認証を差し込める入口を 1 つ足す必要がある（足すかは論点）。
- 避けるアンチパターン: CLI のために `app.ts` に default export を足し、ADR 0007 が分けた「アプリ」と「入口」を混ぜること。入口は ADR 0007 が命名の規則を持つ（ランタイムやデプロイ先が分かる名前）ので、名前は決める必要がある。

### `@hono/zod-openapi`

- 確かめた事実: `/tmp` で `@hono/zod-openapi` 1.6.3 と `hono` 4.13.14 の小さなアプリを作った。`hono routes` は `/users/:id` と `/doc` を出し、`hono request /users/ab`（`min(3)` に違反）は 400（`success: false`）、`/doc` は OpenAPI の JSON を返した。`OpenAPIHono` は Hono を継承するので、default export すれば CLI は特別な扱いなしに読める。
- このリポジトリは `@hono/zod-openapi` も `zod` もまだ入れていない（`pnpm-workspace.yaml` の catalog、`grep` で確かめた）。入れたあとのアプリで確かめたわけではない。

### Better Auth の Cookie

- 確かめた事実: Better Auth を差し替えた stub（`Cookie` に `__Host-sid=ok` があればセッションあり）を `createApp({ auth })` に渡す入口を `/tmp` に置いて試した。
  - `hono routes` は `/health`、`/api/auth/*`（GET、POST）、`/api/me` を出した。
  - `hono request /api/me` は 401、Origin が違う POST は 403（"forbidden origin"）。
  - `hono batch` で「ログイン（`Set-Cookie: __Host-sid=ok; Secure; HttpOnly; SameSite=Strict; Path=/`）→ `/api/me` が 200 で `id: "u1"`」を確かめられた。Secure な Cookie も次の step に運ばれた。フォーム形式の POST は 415（`csrfProtection`）。
- 確かめていない: 本物の Better Auth（OIDC のログイン、IdP の redirect）。`batch` の Cookie の引き継ぎは公式ドキュメントに「ブラウザのよう」とあるだけで、OIDC のような別オリジンへの redirect の往復は書かれていない。判断: ログインの往復は Keycloak が要るので、`batch` に向かず、既存の Playwright と Vitest（`apps/api/test`）に残る。セッションを作ったあとの経路の確認は、DB に直接セッションを作る手段が別に要る。
- 公式の skill は「認証情報を CLI の引数に直接渡さない。環境変数を使う」と書く（[honojs/skills の hono](https://github.com/honojs/skills/blob/main/skills/hono/SKILL.md)）。このリポジトリでは、Cookie の値を `-H` に書く形が該当する。

### RLS の DB 接続

- 確かめていない。CLI は app をそのプロセスで動かすので、アプリが `pg` で DB に接続する経路は、DB が動いていれば動くはずだが、PostgreSQL を起動して試していない（`docker` はあるが PostgreSQL の image が手元にない）。
- 公式ドキュメントは `-e, --external <package>` で `pg` を束ねずに外部扱いにできると書く（`hono request -e pg -e dotenv`、0.1.x の README。`next` の `request --help` にも `-e` がある）。
- 判断: `batch` は「1 つのアプリ instance の中の状態が step の間で残る」ので、RLS のテナントの設定（接続ごとの `SET`）が接続を使い回す形だと、step の間で状態が漏れる可能性がある。テナントを跨いだ確認（ADR 0011）は、Testcontainers の本物の PostgreSQL に対する Vitest の方が、隔離が確かだ。CLI は「人が見て確かめる」補助に留まる。

## 3. 今の手段と比べて、何が増えるか

| 手段                                                  | できること                                                     | CLI との差                                                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest の `app.request()`（`apps/api/src/*.test.ts`） | 型のある assertion、fixture、Testcontainers、coverage、Stryker | CLI は assertion を書かずに 1 回確かめる。テストの代わりではなく、書く前の探りと、書いたあとの目視の確認（判断）                        |
| `hc` のクライアント                                   | 型付きの呼び出し（型の確認が主）                               | 重ならない。CLI は型を使わず、JSON を返す。`hc` の型は `typeof app` から作る                                                            |
| 開発サーバー（`vp dev`、`@hono/vite-dev-server`）     | ブラウザと HMR、実際の HTTP                                    | `request` は起動しないので速い。1 回 0.75 秒だった。ただし HTTP の層（`@hono/node-server` の変換、Cookie の `Secure` の扱い）は通らない |
| `curl` + 開発サーバー                                 | 実際の HTTP                                                    | CLI は JSON の契約（`ok`、`error.suggestions`）と `batch` の `expect` を持ち、エージェントが結果を機械的に読める                        |

- 増えるもの（`next` の公式ドキュメントと実行の結果、判断を含む）:
  - `routes`: ソースを読まずに経路の一覧を得る。mount した sub-app と `basePath` を展開する。大きくなったアプリでエージェントが全ファイルを読む手間が減る。
  - `request --trace`: どの middleware と handler が応答したかを出す。
  - `batch`: 手順（POST してから GET）を JSONL 1 つで宣言し、`failed: 0` まで繰り返す。
  - `diff`: 最後の commit との差を、手でスナップショットを作らずに得る。refactor の前後の確認に使える。実行は未確認。
  - `benchmark`: 経路と handler の micro benchmark。数 % の差は noise（公式）。
- 増えないもの: CI の判定、coverage、Stryker、型の検査、DB を含む結合、認証の往復。
- 避けるアンチパターン（判断）: CLI の結果を、テストの代わりに「確認した」の根拠にすること。このリポジトリは coverage の下限と mutation test を ADR 0024 などで要求しているので、CLI の確認は commit の前にテストを書くことの代わりにならない。

速くなるかの根拠は、Hono 自身の測定（[Agent DX](https://hono.dev/docs/agents) のリンク先）が示すはずだが、`https://hono.dev/docs/agents/agent-dx` は 404 を返し、確かめられなかった。

## 4. 入れ方、版、保守

### 版と保守の状態（確かめた事実）

- `latest` は 0.1.11（2026-08-05）。`next` は 1.0.0-rc.8（2026-10-15）で、rc は 2026-10-07 から 8 日間に 9 回出ている。`0.2.0-next.0` から `.9`（2026-08-31〜09-18）を経て 1.0 の rc になった（`npm view @hono/cli time`）。
- `honojs/cli` は archived でなく、最後の push は 2026-10-15、open の issue は 5 件、star は 364（`gh api repos/honojs/cli`）。作者は Hono の作者の Yusuke Wada と Taku Amano（[README](https://github.com/honojs/cli/blob/main/README.md)）。ライセンスは MIT。
- 判断: rc が短い間隔で出ており、コマンドの形も 0.1 から変わった（`request -P /path` が `request /path` に、`docs` と `search` が消えた）。`next` を固定すると、1.0 の GA までは版を上げるたびに出力の形の確認が要る。0.1.11 は 8 月から更新がなく、`routes` や `batch` を持たないので、エージェントに使わせる意味は薄い。

### 入れ方の比較

| 方式                                           | 版の固定                                                                                     | 供給網                                                                                                                      | このリポジトリとの整合                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api` の devDependency（pnpm の catalog） | `pnpm-lock.yaml` と catalog。Renovate が更新（ADR 0018）                                     | pnpm の `minimumReleaseAge` が効く。`esbuild` の postinstall は、`allowBuilds` に書かない限り走らない（pnpm 10 以降の既定） | Hono の公式の置き方（「Install it in your project. Coding agents find it in package.json」）と create-hono のテンプレートに沿う。Knip が「未使用の devDependency」と報告する可能性が高く、`ignoreDependencies` に理由つきで足す（ADR 0017）。`hono` が依存なので、catalog の `hono` と重複しないかを `pnpm why hono` で確かめる必要がある  |
| mise の `npm:@hono/cli`（ADR 0009）            | `mise.toml` の版と `mise.lock`。npm backend は依存の graph を `.mise/locks/npm-*` に記録する | mise の埋め込み aube が、依存の script を既定で走らせず、`minimum_release_age` も依存に適用する。`node` が PATH に要る      | ADR 0009 は「CLI ツールの install だけに使う」とし、`mise.toml` に Node.js を書かない（Vite+ の役割）。`.mise/locks/pypi-semgrep` の前例はあるが npm の例はまだない。mise の公式は「アプリの依存は package.json で入れる」と書く。CLI はアプリのファイルを `node_modules` 込みで束ねるので、アプリと同じ `hono` の版を見る方が自然（判断） |
| `npx hono`（devDependency なし）               | 固定されない（`npx hono --help` は install 済みの bin、なければ取得）                        | 都度の取得で `minimumReleaseAge` の外                                                                                       | 公式の AGENTS.md の例は `npx hono --help` だが、版が固定されない。このリポジトリの固定の方針（ADR 0009、0018）と合わない（判断）                                                                                                                                                                                                           |
| グローバル（`npm install -g`）                 | 個人の環境                                                                                   | 個人の環境                                                                                                                  | 再現しない。避ける（判断）                                                                                                                                                                                                                                                                                                                 |

- 出典: [Hono CLI の Installation](https://hono.dev/docs/agents/cli)、[Hono for Coding Agents](https://hono.dev/docs/agents)、[mise の npm backend](https://mise.jdx.dev/dev-tools/backends/npm.html)、ADR 0009、0017、0018。
- 標準の慣行か: Hono の公式は devDependency を標準とし、`create-hono` のテンプレートが同梱する（[Hono for Coding Agents](https://hono.dev/docs/agents)）。mise の npm backend は「CLI を npm から入れる」ための仕組みで、mise 自身が、アプリの依存は `package.json` に置くよう書く。
- 確かめていない: `pnpm add -D @hono/cli@next` を実際にこのリポジトリで実行した結果（リポジトリに `node_modules` を増やさない条件のため）。`/tmp` では npm で入れ、`esbuild@0.25.12` の postinstall は npm の警告（承認待ち）になったが、CLI は動いた。pnpm の `minimumReleaseAge` を満たす版かは、2026-10-26 時点で rc.8（2026-10-15）が 11 日前なので、既定の 1 日なら通る見込み（判断。リポジトリの設定値は `pnpm-workspace.yaml` に明示がなく、pnpm の既定に依る）。

## 5. Kiro の skill や steering から使う形

### Hono が配っているもの（確かめた事実）

- `AGENTS.md` に 1 行（"Run `npx hono --help` first, and use the CLI instead of a dev server."）。`create-hono` のテンプレートには入っている（[Hono for Coding Agents](https://hono.dev/docs/agents)）。`hono agent-init` が同じ節を AGENTS.md に書き、devDependency を足す（`hono agent-init --help`）。
- Hono Skills（[honojs/skills](https://github.com/honojs/skills)、MIT、最後の push は 2026-10-15）: `hono`（API の inline の参照と、CLI でのテスト）、`hono-jsx`、`hono-void`。入れ方は `npx skills add honojs/skills` か `gh skill install honojs/skills hono`（[Hono for Coding Agents](https://hono.dev/docs/agents)）。
- `hono` の skill の中身は、`hono request` と `batch` の使い方、`llms.txt` と `Accept: text/markdown` での資料の引き方、`npm install -D @hono/cli@next`（"TODO at the 1.0 release" のコメントつき）を書く（[SKILL.md](https://github.com/honojs/skills/blob/main/skills/hono/SKILL.md)）。

### このリポジトリでの形（判断）

- このリポジトリの skill は `.agents/skills/` に upstream から入れたもので、Kiro は `.kiro/skills/` から読む（今回の skill の読み込みが `.kiro/skills/research` を指した）。`honojs/skills` を入れるなら、upstream の skill を取り込む既存の手順（`.agents/` は Knip の `project` から外れている、ADR 0017）に沿わせる。
- ただし upstream の skill は Cloudflare Workers を中心にした記述（bindings、`cloudflare.config.ts`）が長く、ADR 0007 の `apps/api/src` の規則（Node.js の組み込みを使わない）を知らない。そのまま入れると、規則に反する例をエージェントが書く可能性がある（判断。skill の全文は読んでいない。冒頭と該当節だけ読んだ）。
- 軽い形の候補（判断）: 全部の skill を入れず、AGENTS.md か steering に「`hono routes` と `hono request` の使い方」と、このリポジトリで default export する入口のファイル名だけを書く。`hono --help` が先頭に注意書きを持つので、使い方の説明は短くて済む。AGENTS.md の追加は ADR 0016 の adr-check の対象になるかを確かめる必要がある（未確認）。
- Kiro の hook で `hono diff` を走らせる案は、`diff` が一時的な git worktree を作る（公式）ため、ADR 0024 の「テストが git でこのリポジトリを触る」リスクの節と同じ種類の注意が要る（判断）。

## 標準の慣行と出典、避けるアンチパターン

| 項目                          | 標準か                                                  | 出典                                                                        | 避けるアンチパターン                                                 |
| ----------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| devDependency として入れる    | Hono の公式の標準。create-hono のテンプレートも同じ     | [Hono for Coding Agents](https://hono.dev/docs/agents)                      | `npx` の都度取得で版を固定しない、グローバル install                 |
| AGENTS.md に 1 行書く         | Hono の公式が勧める                                     | [Hono for Coding Agents](https://hono.dev/docs/agents)                      | 使い方を長く書いて `--help` と二重にする（判断）                     |
| 確認は `app.request()` を通す | Hono の標準のテストの形（このリポジトリのテストも同じ） | [Hono のテストの頁](https://hono.dev/docs/guides/testing)                   | CLI の結果を、テストの代わりの根拠にする（判断）                     |
| 入口のファイルを分ける        | ADR 0007 の決定                                         | ADR 0007                                                                    | CLI のために `app.ts` へ default export を足し、アプリと入口を混ぜる |
| 認証情報を引数に書かない      | 公式の skill が書く                                     | [SKILL.md](https://github.com/honojs/skills/blob/main/skills/hono/SKILL.md) | Cookie や token を `-H` に直書きする                                 |

## 比較表（入れ方 × 評価軸）

| 軸                           | devDependency（`next`）                 | devDependency（`latest` 0.1.11） | mise の `npm:`                        | `npx`（固定なし） | 入れない |
| ---------------------------- | --------------------------------------- | -------------------------------- | ------------------------------------- | ----------------- | -------- |
| `routes`、`batch`、`diff`    | ある                                    | ない                             | ある                                  | ある              | ない     |
| 版の固定と Renovate          | できる（rc の更新が頻繁）               | できる                           | できる（mise.lock、前例は PyPI のみ） | できない          | 該当なし |
| 供給網の対策                 | `minimumReleaseAge`、`allowBuilds`      | 同左                             | aube の既定（script 不実行）          | 効かない          | 該当なし |
| Knip との整合                | `ignoreDependencies` の例外が要る見込み | 同左                             | 要らない                              | 要らない          | 該当なし |
| アプリの `hono` の版との整合 | 同じ catalog で揃えやすい               | 同左                             | 別の版が入り得る                      | 別の版が入り得る  | 該当なし |
| 安定性                       | rc（出力の形が動く可能性）              | 古い、機能が少ない               | rc                                    | rc                | 影響なし |
| 追加のコード                 | CLI 用の入口 1 つ（判断）               | 同左                             | 同左                                  | 同左              | なし     |

## 決めるべき論点

1. 入れるか、入れないか。入れない場合、Vitest の `app.request()` と `vp dev` だけで足りるか。
2. 入れるなら、どの版か。`next`（rc、機能は多い）か、1.0 の GA を待つか。`latest`（0.1.11）は `routes`、`batch`、`diff` がなく、対象外とするか。
3. 入れ方。pnpm の catalog の devDependency か、mise の `npm:@hono/cli` か。Knip の例外と、ADR 0009 の「CLI ツールだけを mise に」という範囲の読み方。新しい ADR が要るか（ADR 0016 の adr-check は、判断が絡むツールの追加に警告を出す）。
4. CLI 用の入口。default export する入口を足すか。足すなら名前と置き場所（ADR 0007 の入口の命名）、認証つきで呼ぶ形（stub か、テストと同じ fixture か）、`vite.config.ts` の `lint.overrides` と Knip の `entry` への影響。
5. 使い方の範囲。形を決めた確認（`routes`、`request`、`batch`）に絞るか、`diff`、`snapshot`、`benchmark` まで含めるか。`serve`、`optimize`、`ssg`、`browse`、`init` は使わないとするか。
6. エージェントへの伝え方。AGENTS.md に数行か、steering か、`honojs/skills` の取り込みか。upstream の skill が Cloudflare 中心である点と、ADR 0007 の規則の扱い。
7. テストとの役割分担。CLI の確認を commit の前の必須の手順にするか、任意の補助にするか。認証と RLS の確認は Vitest と Testcontainers に残す、でよいか。
8. 認証の経路の確認の仕方。セッションを DB に作って Cookie を渡す手段を別に用意するか、CLI では認証の外側（`/health`、401 の確認）までに留めるか。

## 未確認のこと

- 本物の Better Auth（OIDC、Keycloak）と RLS つきの PostgreSQL を通した `hono request` と `batch`。
- `hono diff`、`snapshot`、`benchmark`、`agent-init`、`init` の実行（`diff` は main の作業ツリーで git worktree を作るため実行していない）。
- `pnpm add -D @hono/cli@next` をこのリポジトリで実行した結果（`pnpm why hono` の重複、`allowBuilds` の警告、Knip の指摘、`minimumReleaseAge` の通過）。
- Hono の Agent DX の測定の結果（`https://hono.dev/docs/agents/agent-dx` は 404）。エージェントが実際に速くなる量は、数字で確かめていない。
- 1.0.0 の GA の時期と、`latest` が 1.0 に切り替わる時期。`docs` と `search` を 1.0 で外した理由。
- `honojs/skills` の `hono` の skill の全文（冒頭と CLI の節だけ読んだ）。
- `@hono/zod-openapi` を入れたあとの、このリポジトリのアプリでの動作（`/tmp` の小さなアプリでだけ確かめた）。

## 出典

- Hono: [Hono CLI](https://hono.dev/docs/agents/cli)、[Hono for Coding Agents](https://hono.dev/docs/agents)、[RPC](https://hono.dev/docs/guides/rpc)、[Testing](https://hono.dev/docs/guides/testing)
- リポジトリ: [honojs/cli](https://github.com/honojs/cli)、[README](https://github.com/honojs/cli/blob/main/README.md)、[release v1.0.0-rc.8](https://github.com/honojs/cli/releases/tag/v1.0.0-rc.8)、[honojs/skills](https://github.com/honojs/skills)、[hono の SKILL.md](https://github.com/honojs/skills/blob/main/skills/hono/SKILL.md)
- npm: [@hono/cli](https://www.npmjs.com/package/@hono/cli)、[@hono/zod-openapi](https://www.npmjs.com/package/@hono/zod-openapi)
- mise: [npm backend](https://mise.jdx.dev/dev-tools/backends/npm.html)
- このリポジトリ: ADR 0007、0009、0011、0016、0017、0018、0022、0024、`apps/api/src/app.ts`、`index.ts`、`server.ts`、`auth/session.ts`、`security/csrf.ts`、`pnpm-workspace.yaml`、`mise.toml`
