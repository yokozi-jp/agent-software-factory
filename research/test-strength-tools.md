# Vite+ のテストで Stryker、fast-check、coverage を使えるか調べる

## 問い

[Issue #29](https://github.com/yokozi-jp/hono-nx-vite-plus/issues/29)
Vite+ の `vp test`（Vitest）で、Stryker の差分だけの mutation test、fast-check（model-based を含む）、coverage の下限とラチェット、フロントエンドの component test（Vitest の browser mode、Testing Library）が動くか、`nx affected` と組み合わせられるかを、一次資料と実際の実行で確かめる。

## 要約

- `vp test` は upstream の Vitest を `vite-plus/test*` として再輸出したもの。docs は版を `5.0.5` と書くが、このリポジトリに入っているのは `vitest@5.0.3` で、ずれがある（実行ログで確認）。
- coverage は `vp test run --coverage` で動く。provider は同梱されず、`@vitest/coverage-v8` を別に入れる必要がある（未導入だと `MISSING DEPENDENCY` で停止）。provider は runner と同じ版に合わせる（docs の指示）。実際に v8 で 100% を計測できた。
- coverage の「下限」は Vitest の `test.coverage.thresholds`、「ラチェット」は `thresholds.autoUpdate: true` で動く。実際に下限割れで exit 1、`autoUpdate` で `vite.config.ts` の数値が上書きされるのを確認した。
- fast-check 4.10.2 は `vite-plus/test` と併用して property test も model-based test（`fc.commands` / `fc.modelRun`）も通った。Vite+ 側の対応は不要。
- Stryker 10.0.0 は公式の `@stryker-mutator/vitest-runner` で動くが、このリポジトリではそのままでは動かず、2 つの回避が要った（TypeScript 7 と pnpm に由来）。実際に mutation score 50% まで走らせた。
- Stryker の「差分だけ」は `--incremental`（結果の再利用）と mutation range（`file:行範囲`）で、`nx affected` のような `--since <branch>` は無い（現行の config docs に `since` 無し）。
- `nx affected -t test` は `api:test`（= `vp test`）を実行でき、Nx とツールの組み合わせは target 経由で成立する（ADR 0002）。

## 比較

| 項目                           | 可否（このリポジトリ、2026-10-23） | 追加依存                                                   | 必要な回避・注意                                                           |
| ------------------------------ | ---------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| coverage（v8）                 | 動く                               | `@vitest/coverage-v8`（runner と同版 5.0.3）               | provider 未導入だと停止。docs は版 5.0.5 を指すが実体は 5.0.3              |
| coverage 下限                  | 動く                               | 同上                                                       | `test.coverage.thresholds`。割れると exit 1                                |
| coverage ラチェット            | 動く                               | 同上                                                       | `thresholds.autoUpdate: true` が `vite.config.ts` を書き換える             |
| fast-check（property）         | 動く                               | `fast-check`                                               | 無し                                                                       |
| fast-check（model-based）      | 動く                               | `fast-check`                                               | 無し                                                                       |
| Stryker（vitest runner）       | 動く（回避つき）                   | `@stryker-mutator/core` + `@stryker-mutator/vitest-runner` | `tsconfigFile: ""` と明示 `plugins` の 2 つが必須                          |
| Stryker 差分（incremental）    | 動く                               | 同上                                                       | `--incremental` + `--incrementalFile`。`--since` は無い                    |
| Stryker 差分（git range）      | 無い                               | -                                                          | `nx affected` 相当の git 差分指定は現行に無い。mutation range は行単位のみ |
| component test（browser mode） | ランタイムは同梱、provider は別    | provider + framework peer                                  | 下記「未確認」参照。今回は未実行                                           |
| `nx affected` との組み合わせ   | 動く                               | -                                                          | `nx affected -t test` が `api:test` を実行（ADR 0002）                     |

## coverage（下限とラチェット）

Vite+ の `vp test` は Vitest なので、coverage は Vitest の機能をそのまま使う。docs は「`vp test run --coverage`」と「Jest 風の coverage をサポート」と書く（出典: Vite+ docs `guide/test.md`）。provider は同梱されず、Vitest v5 の互換 docs は「coverage provider と `@vitest/ui` は runner の版 `5.0.5` に合わせる」と指示する（出典: Vite+ docs `guide/vitest-v5.md`）。

実行で確認したこと（worktree の `apps/api`）:

- provider 未導入での `vp test run --coverage` → `MISSING DEPENDENCY: Cannot find dependency '@vitest/coverage-v8'`。
- `@vitest/coverage-v8@5.0.3`（= 同梱 runner の版）を入れると `Coverage enabled with v8` で `app.ts` が 100% と表示。
- 下限: `test.coverage.thresholds.lines: 100` で未カバーのファイルを含めると `ERROR: Coverage for lines (25%) does not meet global threshold (100%)` で exit 1。
- ラチェット: `thresholds: { lines: 50, autoUpdate: true }` で実行すると `Updating thresholds to configuration file.` が出て、`vite.config.ts` の `lines` が実測値 `100` に上書きされた。これが coverage ラチェット（下限を実測まで引き上げて固定）そのもの。

判断: coverage のラチェットは Vitest 標準の `coverage.thresholds.autoUpdate` を使うのが標準の慣行（出典: Vitest config docs）。別途スクリプトで閾値を書き換えるのはアンチパターン（二重管理になる）。ただし `autoUpdate` は config ファイルを実行時に書き換えるので、CI で走らせると意図しない diff が出る点に注意。

## fast-check

`fast-check@4.10.2` を `apps/api` に入れ、`vite-plus/test` の `describe/it/expect` と併用して 2 つのテストを書いて実行した（`src/fc.test.ts`、どちらも pass）:

- property: `fc.assert(fc.property(fc.string(), ...))`（文字列の反転は involutive）。
- model-based: `fc.commands` と `fc.modelRun` でカウンターのモデル検査。

fast-check は Vitest の中でただのライブラリとして動くので、Vite+ 側の特別な対応は要らない。`@fast-check/vitest`（`test.prop` の統合）は今回入れていないので別途確認が要る（未確認に記載）。

判断: Vitest で property-based test を書くときは、ランナー非依存の `fast-check` をそのまま呼ぶのが標準（出典: fast-check 公式）。アンチパターンは、ランナー固有の薄いラッパーに依存して移植性を落とすこと。

## Stryker（mutation test）

`@stryker-mutator/core@10.0.0` と公式 `@stryker-mutator/vitest-runner@10.0.0` を入れて `apps/api/src/app.ts` を対象に実行した。素の設定では 2 回連続で失敗し、根本原因を切り分けてから成功した。

1. `TypeError: ts.parseConfigFileTextToJson is not a function`。原因はこのリポジトリの `typescript@7.0.2`（TS7。`node -e` で `parseConfigFileTextToJson` が `undefined` と確認）。Stryker の `TSConfigPreprocessor` が `tsconfig.json` を見つけて TS の API で書き換えようとするが、TS7 はその API を同じ形で公開しない。回避: `tsconfigFile: ""`（tsconfig の前処理を無効化）。
2. `Cannot find TestRunner plugin "vitest" ... no TestRunner plugins were loaded`。既定の `plugins: ["@stryker-mutator/*"]` glob が pnpm の node_modules 構成で runner を解決できない。回避: `plugins: ["@stryker-mutator/vitest-runner"]` を明示。

この 2 つを入れた設定で成功:

- `Instrumented 1 source file(s) with 4 mutant(s)`、`Initial test run succeeded`、最終 `All files 50.00`（4 変異のうち 2 kill、2 survive）。

差分だけの mutation test:

- `--incremental` + `reports/stryker-incremental.json` で結果を再利用する（1 回目で `No incremental result file found ... full ... run`、実行後に `stryker-incremental.json` が生成されたのを確認）。2 回目以降は変わった mutant だけを再評価する（出典: Stryker CLI help）。
- `mutate` は `file:startLine[:col]-endLine[:col]` の行範囲指定ができる（出典: Stryker config docs の `mutate`）。
- 現行の config docs に `since` オプションは無く、`nx affected` のような `--since <branch>` 指定での差分 mutation は Stryker 単体には無い。

判断: Vite+（Vitest）で mutation test をするなら、公式の `@stryker-mutator/vitest-runner` を使うのが標準の慣行（出典: Stryker 公式の vitest-runner）。差分化は `--incremental` を使うのが標準で、CI でキャッシュとして incremental file を持ち回す。アンチパターンは、毎回全 mutant を回して CI 時間を浪費すること。なお TS7 と pnpm の回避は、将来 Stryker が TS7 に対応すれば不要になりうる。

## `nx affected` との組み合わせ

ADR 0002 のとおり、タスクの実行・cache・affected は Nx が担当し、Vite+ は `package.json` scripts から呼ばれるツールチェーン。`api` の `test` target は `vp test run` を実行する（`nx show project api` で確認）。`nx affected -t test --files=apps/api/src/app.ts` を実行すると `nx run api:test` が走り成功した。

- coverage は `test` target に `--coverage` を足すか、別 target（例 `test:coverage`）にして `nx affected -t test:coverage` で回せる（判断。target は未作成、動作は `vp test run --coverage` 単体でのみ確認）。
- Stryker は長時間かかるので、`test` とは別の target（例 `mutation`）にして `nx affected -t mutation` で差分プロジェクトだけに絞るのが素直（判断。target は未作成）。Stryker 自身の `--incremental` と、Nx の affected（プロジェクト単位の絞り込み）は別レイヤーなので併用できる。

判断: ツールを足すときは `package.json` scripts に `vp ...` / `stryker run` を置き、`nx.json` の `targetDefaults` に inputs/outputs/cache を書いて Nx から回すのが、このリポジトリの標準（出典: ADR 0002）。`vp run` で回すのはアンチパターン（Nx と二重管理）。

## 未確認のこと

- component test（Vitest browser mode、Testing Library）は実行していない。`@vitest/browser` と `@vitest/browser-preview` は同梱され、`vite-plus/test/browser*` の export も存在する（`vite-plus/package.json` の exports で確認）が、Playwright / WebDriverIO を使うには opt-in provider（`@vitest/browser-playwright` など）と framework peer（`playwright` など）が別に要る（出典: Vite+ docs `guide/migrate.md`）。ブラウザのバイナリが無い環境では実行確認ができないため未実施。`web` アプリ（React）での Testing Library の動作も未確認。
- coverage provider を docs 指定の `5.0.5` ではなく実体に合わせて `5.0.3` で入れて動かした。版をそろえる前提と実体のずれが将来どう影響するかは未確認。
- `@fast-check/vitest`（`test.prop` 統合）は未導入・未確認。素の `fast-check` のみ確認した。
- Stryker の `checkers: ["typescript"]`（型チェック付きの変異除外）は TS7 では動かない可能性が高い（`tsconfigFile` の前処理が既に TS7 で失敗したため）。未検証。
- これらの依存の追加は lockfile と `pnpm-workspace.yaml`（`catalogMode: prefer` によりカタログに追記される）を変える。今回の試行は commit せず元に戻した。`minimumReleaseAge` の既定に引っかからずインストールできたが、恒久採用時の版固定方針は別途判断が要る。

## 出典

- Vite+ docs「Test」`https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/docs/guide/test.md`（2026-10-23 取得）。`vp test` が Vitest、`vite-plus/test`、`--coverage`。
- Vite+ docs「Upgrade to Vitest 5」`https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/docs/guide/vitest-v5.md`（2026-10-23 取得）。coverage provider と `@vitest/ui` は runner の版 `5.0.5` に合わせる、browser 出力先の変更、閾値 `perFile` 等。
- Vite+ docs「Migrate to Vite+」`https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/docs/guide/migrate.md`（2026-10-23 取得）。browser mode の provider（`@vitest/browser` / `-preview` 同梱、Playwright / WebDriverIO は opt-in）。
- Stryker config docs `https://raw.githubusercontent.com/stryker-mutator/stryker-js/master/docs/configuration.md`（2026-10-23 取得）。`mutate` の mutation range、`coverageAnalysis`、`checkers`。`since` の記載は無い。
- Stryker CLI help（`pnpm exec stryker run --help`、`@stryker-mutator/core@10.0.0`）。`--incremental`、`--incrementalFile`、`--force`。
- このリポジトリの実行ログ（worktree `apps/api`、2026-10-23）: `vp test run`（`v5.0.3`）、coverage 計測と閾値・`autoUpdate`、fast-check の pass、Stryker の失敗 2 件と成功（mutation score 50%）、`nx affected -t test`。
- ローカルのファイル: `node_modules/vite-plus/package.json`（exports、version 1.1.0）、`node_modules/.pnpm` の `vitest@5.0.3`・`@vitest/browser(-preview)@5.0.3`、`typescript@7.0.2`（`parseConfigFileTextToJson` 無し）。
- ADR 0002「タスクの実行は Nx が担当し、Vite+ はツールチェーンとしてだけ使う」`docs/adr/0002-nx-orchestrates-vite-plus.md`。
- ADR 0007「API のランタイムは Node.js のまま」`docs/adr/0007-api-on-node-web-standard-app.md`。
