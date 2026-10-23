# モジュール境界と禁止 API の検査の道具を比べる

## 問い

[Issue #28](https://github.com/yokozi-jp/hono-nx-vite-plus/issues/28)：
Nx の `enforce-module-boundaries`、dependency-cruiser、ast-grep、Oxlint の `no-restricted-imports` を、Nx 24 と Vite+（Oxlint、ESLint なし）の環境で使えるか、検出できる違反の種類、失敗メッセージに直し方と docs のパスを書けるか、で比べる。Nx の規則が ESLint なしで動くかを特に確かめる。

## 要約

- このリポジトリは Nx 24.0.0、vite-plus 1.1.0（Oxlint 1.87.0 を同梱）、`@nx/js` だけが入っていて `@nx/eslint-plugin` は入っていない（`node_modules` と `pnpm-workspace.yaml` で確認）。
- Nx の `@nx/enforce-module-boundaries` は、ESLint 版（`@nx/eslint-plugin`）に加えて、`@nx/oxlint` が Oxlint の JS プラグイン（`@nx/oxlint/boundaries-plugin`）として同じ規則を提供する。ESLint なしで Oxlint だけでも使える（Nx 公式 docs、2026 時点）。
- ただし Nx 公式は Oxlint 版を「Experimental」とする。Oxlint の JS プラグイン API は semver の対象外で、どの版でも壊れ得るからだ。`@nx/oxlint@24.0.0` は `oxlint ^1.43.0` を peer に持ち、依存に `@nx/eslint-plugin` を含む（規則の実体を共有するため。ESLint の実行は不要）。
- Oxlint の `no-restricted-imports` は v0.15.0 で入り、`paths`、`patterns`、`regex`、`importNames`、モジュールごとの `message` に対応する。このリポジトリの ADR 0007 のルール（`vite.config.ts` の `lint.overrides`）がまさにこれを使い、`message` に「直し方 + docs/adr/0007」を書いている。1.87.0 で実動を確認した（下記）。
- Oxlint の JS プラグイン API は ESLint v9+ 互換（alpha）。Vite+ は `lint.jsPlugins` で JS プラグインを登録できるので、理屈の上では `@nx/oxlint/boundaries-plugin` を Vite+ の `vp lint` から読む余地はある。ただし Nx の `@nx/oxlint` は「Nx のタスクとして Oxlint を走らせる」前提で、ADR 0002（タスクは Nx、Vite+ はツールチェーン）と衝突する設計上の論点がある（未確認、下記）。
- dependency-cruiser は Oxlint/ESLint から独立した別プロセスの検査器。`forbidden` 規則で import の from/to を制限し、循環・孤立・依存の欠落も見る。`comment` を違反メッセージに出せる。Nx にも Oxlint にも依存しない。
- ast-grep は AST パターンで任意のコードを検査する汎用ツール。`message`・`note`・`severity`・`fix` を YAML 規則に書ける。import 専用の規則はなく、パターンで `import` 文を自分で書く。このマシンには未インストール（`/usr/bin/sg` は setgroups）。
- 四つのどれも、失敗メッセージに「直し方」と docs のパスを載せられる（Oxlint は `message`、dependency-cruiser は `comment`、ast-grep は `message`/`note`、Nx は規則固定の文面）。

## 比較

| 項目                                   | Nx enforce-module-boundaries                                        | dependency-cruiser                             | ast-grep                               | Oxlint no-restricted-imports                           |
| -------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| ESLint なしで動くか                    | 動く（`@nx/oxlint` の JS プラグイン版。Experimental）               | 動く（独立した別プロセス）                     | 動く（独立した別プロセス）             | 動く（Oxlint 本体の規則）                              |
| このリポジトリに同梱か                 | 否（`@nx/oxlint` も `@nx/eslint-plugin` も未インストール）          | 否                                             | 否（`sg` は setgroups）                | 同梱（Oxlint 1.87.0、ADR 0007 で使用中）               |
| 主な検出対象                           | プロジェクトの tag に基づく依存制約（import と package.json）       | import の from/to 制約、循環、孤立、依存の欠落 | 任意の AST パターン（import 文を含む） | 特定モジュール/パターンの import 禁止                  |
| 境界の単位                             | Nx のプロジェクトと tag                                             | パスの glob/正規表現                           | AST の構造                             | モジュール名・glob・正規表現                           |
| 失敗メッセージに直し方/docs を書けるか | 規則固定の文面（depConstraints の tag 名から生成）                  | `comment` に自由記述                           | `message`/`note` に自由記述            | モジュールごとの `message` に自由記述（help 行に出る） |
| semver の扱い                          | ESLint 版は通常。Oxlint 版は Experimental（JS プラグイン API 依存） | 通常の semver                                  | 通常の semver                          | Oxlint 本体の規則として通常（JS プラグインではない）   |
| Nx との統合                            | ネイティブ（tag、affected、cache）                                  | なし（別タスクとして呼ぶ）                     | なし                                   | Vite+ 経由。Nx は `@nx/oxlint` で Oxlint をタスク化    |

## Nx `@nx/enforce-module-boundaries`

- tag ベースの依存制約。`project.json` または `package.json` の `nx.tags` でプロジェクトに tag を付け、`depConstraints` の `sourceTag` / `onlyDependOnLibsWithTags` で許す依存を宣言する。tag は exact・`*`・正規表現・glob を受ける（Nx docs「Enforce Module Boundaries」）。
- 入れ方は二通り。
  - ESLint 版：`nx add @nx/eslint-plugin @nx/devkit`。`eslint.config.mjs` で `@nx/enforce-module-boundaries` を設定する。
  - Oxlint 版：`nx add @nx/oxlint`。`.oxlintrc.json` に `"jsPlugins": ["@nx/oxlint/boundaries-plugin"]` と `@nx/enforce-module-boundaries` の規則を書く。`depConstraints` の構文は ESLint 版と同じ（Nx docs「Nx with Oxlint」）。
- ESLint なしで動くか：動く。Oxlint 版が Oxlint の JS プラグインとして同じ規則を提供する。ただし Nx 公式は Oxlint 版を Experimental とする。「Module boundaries support depends on the Oxlint JavaScript plugin API, which Oxlint excludes from its semantic versioning policy and can change in any release.」（Nx docs「Nx with Oxlint」の警告）。
- `@nx/oxlint@24.0.0`（このリポジトリの Nx と同じ版）は `oxlint ^1.43.0` を peer に持ち、依存に `@nx/eslint-plugin@24.0.0` と `@nx/devkit@24.0.0` を含む（registry のメタデータ）。規則の実体を共有するためで、ESLint の実行は不要。export に `./boundaries-plugin` がある。
- 違反メッセージは depConstraints の tag 名から生成する固定の文面（例：`A project tagged with "scope:admin" can only depend on projects tagged with "scoped:shared" or "scope:admin".`）。任意の docs パスを差し込む口は docs にない（未確認、下記）。
- Oxlint 版の注意：Oxlint は JSON を lint しないため `@nx/dependency-checks`（package.json の依存を見る規則）は Oxlint では動かない。これには ESLint が要る（Nx docs の注記）。
- ワークスペース内に置いたプラグインは、lint 対象のプロジェクトに依存できない（循環になる）。`dependsOn: ["^build"]` だと circular-dependency で失敗し、`NX_IGNORE_CYCLES=true` で回避する（Nx docs の警告）。

## dependency-cruiser

- Oxlint・ESLint・Nx から独立した単体のツール。`npx dependency-cruiser --init` で `.dependency-cruiser.js` を作り、`forbidden` 配列に規則を書く（公式 README）。
- 規則は `name`・`comment`・`severity`・`from`・`to` を持つ。`from`/`to` はパスの正規表現や `pathNot` などで、層をまたぐ import を禁止できる（README のサンプル：test フォルダ外からの test への依存を禁止）。
- `--init` が付ける既定の規則で、循環依存・package.json に無い依存・孤立ファイル・本番コードからの dev/optional 依存を検出する。
- 出力は eslint 風のテキスト（`err` レポーター）のほか、dot/mermaid/json/csv/html。違反には `comment` を出せるので、直し方と docs のパスを書ける。
- JS/TS/CoffeeScript、ES6/CommonJS/AMD、jsx/tsx/vue/svelte、webpack の alias に対応（README「features」「FAQ」）。
- Nx の tag は見ない。境界はパスの glob/正規表現で表す。Nx のプロジェクトグラフとは別に、自前でパス規約を保つ必要がある。

## ast-grep

- AST パターンで任意のコードを検査・書き換える汎用ツール。lint 規則は YAML で、`id`・`language`・`rule`（パターン）に加え、`message`・`severity`・`note`・`fix`・`constraints`・`files`/`ignores`・`labels` を書ける（公式 docs「Lint Rule」）。
- import の禁止には専用の口はなく、`pattern` で `import ... from "..."` を自分で書いて検出する。禁止 API（特定のグローバルや関数呼び出し）の検出に強い。
- `message` と `note` に自由記述でき、`note` は「actionable fix を書くのが望ましい」とされる。直し方と docs のパスを載せられる。`fix` で自動修正もできる。
- `ast-grep scan`（CI 向け）、`ast-grep scan -r rule.yml`（単一規則）、`--json`、LSP、GitHub Action に対応（docs「Command Line Tooling Overview」）。
- このマシンには未インストール。`which sg` が返す `/usr/bin/sg` は ast-grep ではなく setgroups（`sg --version` が `Usage: sg group ...`）。使うには別に入れる必要がある。
- Nx の tag も Oxlint の規則体系も使わない。モジュール境界そのもの（プロジェクト間の依存グラフ）の表現は苦手で、禁止 API/禁止構文の検査に向く。

## Oxlint `no-restricted-imports`（と関連規則）

- このリポジトリの Vite+（1.1.0）は Oxlint 1.87.0 を同梱する。`no-restricted-imports`・`no-restricted-globals`・`no-restricted-properties`・`import/no-nodejs-modules`・`import/no-cycle` などが `oxlint --rules` に出る。
- `no-restricted-imports` は v0.15.0 で追加。`paths`（exact）・`patterns`（glob）・`regex`・`importNames`・`allowImportNames`・`allowTypeImports` と、モジュールごとの `message` に対応する。`message` は help テキストとして出る（Oxlint docs「eslint/no-restricted-imports」）。
- 実動の確認（このリポジトリの Oxlint 1.87.0、使い捨ての config と file で検証、commit しない）：`bun` の import、`bun:*` パターン、`node:fs`（`import/no-nodejs-modules`）、`process` グローバル（`no-restricted-globals`）がすべて error になり、`message` が `help:` 行に出た。終了コードは 1。
- ADR 0007 はこの規則を `vite.config.ts` の `lint.overrides` で使い、`apps/api/src/**` に対し `no-restricted-imports`・`no-restricted-globals`・`import/no-nodejs-modules` をかけ、`message` に「Runtime-specific code belongs in an entry file such as apps/api/src/server.ts (docs/adr/0007).」と docs のパスを書いている。入口（`server.ts`）とテストは override で除外。
- 境界の単位はモジュール名・glob・正規表現。Nx のプロジェクト tag や依存グラフは見ない。「プロジェクト A はプロジェクト B に依存してよいか」という境界は表せず、「このパスのファイルはこのモジュールを import するな」という禁止 API 向け。
- Vite+ の推奨は、Oxlint の設定を `.oxlintrc.json` ではなく `vite.config.ts` の `lint` ブロックに置くこと。`vp check` はワークスペースルートの `lint` ブロックを使う（Vite+ docs「Lint」）。

## 未確認のこと

- Vite+ の `vp lint` から `@nx/oxlint/boundaries-plugin` を `lint.jsPlugins` で読めるか、実際に試していない。Oxlint の JS プラグイン API は ESLint v9+ 互換（alpha）で、Vite+ も `lint.jsPlugins` を持つので理屈は通るが、`@nx/oxlint` のプラグインが Nx のプロジェクトグラフ（`@nx/devkit`）に依存するため、Nx のタスク外（`vp lint` 単体）で動くかは確認していない。
- ADR 0002（タスクは Nx、`vp run` と `@nx/vite` は使わない）と `@nx/oxlint`（Oxlint を Nx のタスクとして走らせる executor）の関係は、設計判断として未確認。`@nx/oxlint` を入れると Oxlint のタスク化が Nx 側に寄り、Vite+ の `vp lint`/`vp check`（pre-commit・CI で使用中）と二重になり得る。
- Nx の `@nx/enforce-module-boundaries` の違反メッセージに、任意の docs パスや直し方を差し込めるか（`message` 相当のオプションがあるか）は docs で確認できていない。見えたのは tag 名から生成される固定文面だけ。
- dependency-cruiser と ast-grep の、このリポジトリでの導入コスト（mise/catalog への固定、ADR の要否）は本チケットの範囲外。ADR 0009（版を固定する CLI は mise）と ADR 0003/0008（ツールの版固定）の慣行に沿う必要がある（判断は別チケット）。

## 出典

- Nx docs「Enforce Module Boundaries」：<https://raw.githubusercontent.com/nrwl/nx/master/astro-docs/src/content/docs/features/enforce-module-boundaries.mdoc>（2026-10-23 取得）
- Nx docs「Nx with Oxlint」：<https://raw.githubusercontent.com/nrwl/nx/master/astro-docs/src/content/docs/technologies/oxlint/introduction.mdoc>（2026-10-23 取得）
- `@nx/oxlint@24.0.0` の registry メタデータ（dependencies、peerDependencies、exports）：<https://registry.npmjs.org/@nx/oxlint/24.0.0>（2026-10-23 取得）
- dependency-cruiser README：<https://raw.githubusercontent.com/sverweij/dependency-cruiser/main/README.md>（2026-10-23 取得）
- ast-grep docs「Lint Rule」：<https://raw.githubusercontent.com/ast-grep/ast-grep.github.io/main/website/guide/project/lint-rule.md>（2026-10-23 取得）
- ast-grep docs「Command Line Tooling Overview」：<https://raw.githubusercontent.com/ast-grep/ast-grep.github.io/main/website/guide/tooling-overview.md>（2026-10-23 取得）
- Oxlint docs「eslint/no-restricted-imports」：<https://raw.githubusercontent.com/oxc-project/oxc-project.github.io/main/src/docs/guide/usage/linter/rules/eslint/no-restricted-imports.md>（rule version 0.15.0、2026-10-23 取得）
- Oxlint docs「JS Plugins」：<https://raw.githubusercontent.com/oxc-project/oxc-project.github.io/main/src/docs/guide/usage/linter/js-plugins.md>（2026-10-23 取得）
- Vite+ docs「Lint」：<https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/docs/guide/lint.md>（2026-10-23 取得）
- このリポジトリ：`vite.config.ts`（ADR 0007 の `lint.overrides`）、`nx.json`、`pnpm-workspace.yaml`、`node_modules`（Oxlint 1.87.0、Nx 24.0.0、`@nx/js` のみ）。Oxlint の実動確認は 1.87.0 の使い捨て config で検証（commit しない）。
- ADR 0002「タスクの実行は Nx が担当し、Vite+ はツールチェーンとしてだけ使う」、ADR 0007「API のランタイムは Node.js のままにし、アプリのコードは Web 標準の API だけで書く」。
