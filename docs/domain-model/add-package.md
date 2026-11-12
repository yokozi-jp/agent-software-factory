---
type: Runbook
title: module ではない package を足す手順
description: packages/ の直下に、サンプル機能のモジュールではない package (shared-kernel、ui、i18n、db、telemetry、logging のような共有の道具) を足すときに、直す場所を一覧にした手順。packages/ に module ではない package を足すとき、その package の exports を index.ts 以外にしたくなったとき、repo-policy が「tag がない」「moduleOrder にない」と止めたときに読む。
tags: [domain-model, runbook, packages, repo-policy, lint]
---

# module ではない package を足す手順

module ではない package は、業務の層 (`domain` など) を持たず、`moduleOrder` に入りません。足し忘れのうち、機械で止められるものは repo-policy (`tools/scripts/src/checks/repo-policy/modules.ts`) が止めます。module を足すときは [モジュールを足す手順](add-module.md) を読みます。

## 役割の tag

`packages/*/package.json` のすべてに、`nx.tags` で役割の tag を `type:` の次元でちょうど 1 つ付けます。repo-policy は、層、`lint-effect`、どの package にも依存しないことなどの規則を、この tag から決めます。tag がない、2 つある、表にない値の package は、`packagesHaveOneRole` が止めます。package の名前を規則の一覧に書き足す手順は、もうありません。

| tag                  | 役割                                                                                                          | package                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `type:module`        | サンプル機能のモジュール。層、`lint-effect`、`moduleOrder` を持つ ([手順](add-module.md))                     | claim、approval、closing                |
| `type:fixtures`      | モジュールの形をした、lint の fixture だけの package                                                          | module-fixtures                         |
| `type:shared-kernel` | モジュールが共有する業務のコード                                                                              | shared-kernel                           |
| `type:ui`            | shadcn/ui の部品                                                                                              | ui                                      |
| `type:driver`        | 外部のシステムや道具を包む package ([ADR 0054](../adr/0054-drivers-with-domain-and-infrastructure-layers.md)) | db、hr-system、i18n、logging、telemetry |

どれにも当てはまらない package は、新しい役割が要るかを決めて ADR 0026 に書き、`roles.ts` の `roles` と、その役割の規則を足します。events の package (`packages/<module>/events`) は役割を持たず、`type:` の tag を付けません。

## 手順

1. **ドライバか確かめる**: 外部のシステムや道具を直接触り、業務の規則を持たない package は「ドライバ」で、[package の構成](package-layout.md) と [ADR 0054](../adr/0054-drivers-with-domain-and-infrastructure-layers.md) の構成 (`domain/` と `infrastructure/`、入口は再 export だけ、`effect` を使わない) にします。tag は `type:driver` です。`tools/scripts/src/checks/repo-policy/drivers.ts` の `driverShapes` に足し (tag があって `driverShapes` にない、またはその逆は repo-policy が止めます)、`vite.config.ts` の `driverOverrides` (Node.js で動くものは `nodeDrivers`、そうでなければ `webDrivers`) と、`lint-restrictions.json` の `driver-in-module` の値に足します。
2. **決めて ADR に書く**: `moduleOrder` に入れない理由、`exports`、層の規則と `lint-effect` をどうするか、何に依存してよいかを決めます。例は [ADR 0034](../adr/0034-shared-ui-package.md) (ui)、[ADR 0038](../adr/0038-db-package.md) (db)、[ADR 0044](../adr/0044-i18next-for-texts.md) (i18n)、[ADR 0048](../adr/0048-opentelemetry-traces-only-with-explicit-instrumentation.md) (telemetry)、[ADR 0049](../adr/0049-logging-with-pino-behind-a-logger-interface.md) (logging) です。
3. **package を作る**: `packages/<name>/` に `package.json` (`name` は `@agent-software-factory/<name>`、`nx.name` は `<name>`、`nx.tags` は上の表の役割の tag を 1 つ、`check` の script は `vp check`)、`tsconfig.json`、`vite.config.ts`、`src/` を置きます。`pnpm-workspace.yaml` の `catalog` に無い依存は、先に catalog に足します。
4. **`exports` の例外を `modules.ts` に足す**: `exports` が `"."` の `./src/index.ts` だけでないなら `ownExports` に 1 エントリ足します (`exports` と、メッセージに書く理由)。`exports` の最初の項目のファイルが無いと止まります。入口の切り方は [ADR 0051](../adr/0051-shared-package-entries-by-feature.md) に従います (機能ごとに切り、`.` は外部ライブラリを import しない契約だけ。外部ライブラリを import する入口は、`vite.config.ts` の `sharedKernelEntries` のように、入口ごとに触るライブラリを表にします)。`type:module` 以外の役割は、workspace のほかの package に依存すると repo-policy が止めます。`db` だけが例外です ([ADR 0038](../adr/0038-db-package.md))。
5. **`vite.config.ts` の Oxlint の override を決める**: 実行環境の制限 (`process`、`node:*`) を外す必要があるか、SDK のように module に import させたくないものがあるかを決め、`files` を必要なファイルに絞って override を足します。`packages/*/src/**` の制限を丸ごと外さず、外すファイルを名前で挙げます。
6. **fixture を足す**: override が制限を外す、または新しく制限するときは、その効きを示す fixture を `src/__fixtures__/` に置きます。禁止の表 (`lint-restrictions.json`) にある禁止 (Outbox の迂回、`pg` など) なら、fixture の名前を欄のキー (`src/__fixtures__/outbox.ts` など) にし、表の行の `files` に足します。override が届くかは fixture の `vp check` が、表と fixture が合うかは repo-policy が確かめます ([CI](../tooling/ci.md) の「禁止の表」)。表にない制限は、`src/__fixtures__/` の fixture に disable のコメントの行を置きます ([CI](../tooling/ci.md) の「lint の規則と tsconfig のフラグの fixture」)。
7. **Knip と coverage を直す**: 入口のファイルが `package.json` の `exports` から読めないなら `knip.jsonc` の `entry` に足します。テストのない入口は `coverage-policy.json` の `entries` に理由つきで書きます (記録の対象も検査も、この表を読みます)。
8. **docs を直す**: [CI](../tooling/ci.md) の `exports` の例外の一覧に名前を足します。新しい役割の tag を足したときは、[ADR 0026](../adr/0026-modules-as-packages-with-oxlint-boundaries.md) の「package の役割の tag と登録」と、上の表も直します。
9. **`pnpm install` を実行し、`git add` してから repo-policy を実行する**: repo-policy は git の追跡ファイルを読むので、新しいファイルは `git add` するまで「存在しない」と言われます。
