---
type: Runbook
title: module ではない package を足す手順
description: packages/ の直下に、サンプル機能のモジュールではない package (shared-kernel、ui、i18n、db、telemetry、logging のような共有の道具) を足すときに、直す場所を一覧にした手順。packages/ に module ではない package を足すとき、その package の exports を index.ts 以外にしたくなったとき、repo-policy が「moduleOrder にない」と止めたときに読む。
tags: [domain-model, runbook, packages, repo-policy, lint]
---

# module ではない package を足す手順

module ではない package は、業務の層 (`domain` など) を持たず、`moduleOrder` に入りません。足し忘れのうち、機械で止められるものは repo-policy (`tools/scripts/src/checks/repo-policy/modules.ts`) が止めます。module を足すときは [モジュールを足す手順](add-module.md) を読みます。

## 手順

1. **決めて ADR に書く**: `moduleOrder` に入れない理由、`exports`、層の規則と `lint-effect` をどうするか、何に依存してよいかを決めます。例は [ADR 0034](../adr/0034-shared-ui-package.md) (ui)、[ADR 0038](../adr/0038-db-package.md) (db)、[ADR 0044](../adr/0044-i18next-for-texts.md) (i18n)、[ADR 0048](../adr/0048-opentelemetry-traces-only-with-explicit-instrumentation.md) (telemetry)、[ADR 0049](../adr/0049-logging-with-pino-behind-a-logger-interface.md) (logging) です。
2. **package を作る**: `packages/<name>/` に `package.json` (`name` は `@agent-software-factory/<name>`、`nx.name` は `<name>`、`check` の script は `vp check`)、`tsconfig.json`、`vite.config.ts`、`src/` を置きます。`pnpm-workspace.yaml` の `catalog` に無い依存は、先に catalog に足します。
3. **`modules.ts` に足す**:
   - `notModules` に名前を足します。足さないと、module として `moduleOrder` に無いと止まります。
   - 他の workspace の package に依存しないなら `dependOnNone` にも足します。
   - `exports` が `"."` の `./src/index.ts` だけでないなら `ownExports` に 1 エントリ足します (`exports` と、メッセージに書く理由)。`exports` の最初の項目のファイルが無いと止まります。入口の切り方は [ADR 0051](../adr/0051-shared-package-entries-by-feature.md) に従います (機能ごとに切り、`.` は外部ライブラリを import しない契約だけ。外部ライブラリを import する入口は、`vite.config.ts` の `sharedKernelEntries` のように、入口ごとに触るライブラリを表にします)。
4. **`vite.config.ts` の Oxlint の override を決める**: 実行環境の制限 (`process`、`node:*`) を外す必要があるか、SDK のように module に import させたくないものがあるかを決め、`files` を必要なファイルに絞って override を足します。`packages/*/src/**` の制限を丸ごと外さず、外すファイルを名前で挙げます。
5. **fixture を足す**: override が制限を外す、または新しく制限するときは、その効きを示す fixture を `src/__fixtures__/` に置きます。禁止の表 (`lint-restrictions.json`) にある禁止 (Outbox の迂回、`pg` など) なら、fixture の名前を欄のキー (`src/__fixtures__/outbox.ts` など) にし、表の行の `files` に足します。override が届くかは fixture の `vp check` が、表と fixture が合うかは repo-policy が確かめます ([CI](../tooling/ci.md) の「禁止の表」)。表にない制限は、`src/__fixtures__/` の fixture に disable のコメントの行を置きます ([CI](../tooling/ci.md) の「lint の規則と tsconfig のフラグの fixture」)。
6. **Knip と coverage を直す**: 入口のファイルが `package.json` の `exports` から読めないなら `knip.jsonc` の `entry` に足します。テストのない入口は `vite.config.ts` の `coverage.exclude` に理由つきで書きます。
7. **docs を直す**: [ADR 0026](../adr/0026-modules-as-packages-with-oxlint-boundaries.md) の「モジュールの印」の一覧と [CI](../tooling/ci.md) の `exports` の例外の一覧に名前を足します。
8. **`pnpm install` を実行し、`git add` してから repo-policy を実行する**: repo-policy は git の追跡ファイルを読むので、新しいファイルは `git add` するまで「存在しない」と言われます。
