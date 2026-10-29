---
type: ADR
title: "ADR 0030: 自作の Oxlint plugin は tools/lint-plugins の Nx project にまとめ、app や package には置かない"
description: "自作の Oxlint の JS plugin (test-title、web-xss、domain、tenant-sql) を tools/lint-plugins の 1 つの Nx project に置き、ルートの vite.config.ts の jsPlugins から読む決定。plugin を対象の app の中に置く案、packages/shared に置く案、別々の project に分ける案を退けた理由と、移した影響を記す。自作の Oxlint plugin を足す、直す、移すとき、plugin のテストを動かす場所を探すとき、新しい app や package に既存の plugin の規則を使いたくなったときに読む。"
tags: [adr, tooling, oxlint, lint, nx]
---

# ADR 0030: 自作の Oxlint plugin は tools/lint-plugins の Nx project にまとめ、app や package には置かない

自作の Oxlint の JS plugin を `tools/lint-plugins/` の 1 つの Nx project に置きます。plugin を読むのはルートの `vite.config.ts` の `jsPlugins` で、`files` が決める対象の app や package から、plugin の置き場所は独立しています。

- **決定**: `tools/lint-plugins/src/` に plugin とそのテスト (`RuleTester`) を置きます。今ある plugin は `test-title-plugin.ts` (テスト名を日本語にする規則)、`xss-plugin.ts` ([ADR 0019](0019-custom-oxlint-plugin-for-xss.md))、`domain-plugin.ts`、`tenant-sql-plugin.ts` です。`tenant-sql-plugin.ts` は、ロールとテナントを変える SQL (`SET ROLE`、`set_config`) を、`shared` の補助関数 (`packages/shared/src/tenant-transaction.ts`) とそのテストの外、つまり `packages/shared/src` と `apps/api/src` で止める規則 `tenant-sql/no-session-setting` で、[ADR 0029](0029-module-data-ownership-and-shared-outbox.md) で決め、[Issue #268](https://github.com/yokozi-jp/agent-software-factory/issues/268) で足しました。`domain-plugin.ts` は `domain` の `throw` を止める規則 `domain/no-throw` で、[ADR 0027](0027-domain-model-as-pure-functions-and-unions.md) で決め、[Issue #259](https://github.com/yokozi-jp/agent-software-factory/issues/259) で足しました。project の `test` target が、plugin ごとのテストを動かし、coverage の下限 (ファイルごとに lines と branches が 90%、全体は上がる方向にだけ動く) を守ります。
- **理由**: plugin はルートの設定から読む開発の道具で、どの app の実行時のコードでもありません。それなのに対象の app に置くと、次の問題がありました。
  - `apps/web/lint/` の `xss-plugin` は、別の React の app や package が増えたとき、使うために `apps/web` の中身を指すことになります。
  - `apps/api/lint/` の `test-title-plugin` は `apps/*/src` 全体に効く規則なのに、api の project の test と coverage の対象でした。plugin を直すと api が affected になり、api の Docker が要るテストの cache も無効になります (出典の 1)。
  - `domain` の `throw` を止める規則は、`packages/*/src/domain` にかかります。api の中に置く理由がありません。
- **project の形**: `tools/scripts` と同じく `tools/` の直下の Nx project にします。`pnpm-workspace.yaml` は `tools/*` をすでに含みます。`check` と `test` の target を持ち、CI の `nx affected` が動かします。plugin は実行時の依存を持たないので、`devDependencies` だけです。
- **対象の指定は変えない**: どの規則をどのファイルにかけるかは、ルートの `vite.config.ts` の `lint.overrides` で決めます。plugin の置き場所を変えても、規則の対象は変わりません。

## Considered Options

- **対象の app の中に置く (`apps/web/lint/`、`apps/api/lint/`)**: 以前の置き方です。plugin が 1 つの app のものに見えますが、`test-title` は複数の app にかかり、`domain` の規則は app にかかりません。React の project が増えると、`xss-plugin` の置き場所の問いが戻ります。
- **`packages/shared/lint/` に置く**: `shared` は、モジュールが実行時に import する共有コードの置き場です ([ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md))。開発の道具が混ざり、`shared` に test の仕組みも要ります (出典の 2)。全体にかかる規則 (`test-title`) の置き場所にもなりません。
- **plugin ごとに別の project にする**: plugin が増えるたびに、`package.json`、`tsconfig.json`、`vite.config.ts` が増えます。plugin ごとに別々に配る必要も、別々に版を決める必要もないので、1 つの project にまとめました (判断)。
- **`tools/scripts` に入れる**: `tools/scripts` は hook と CI から呼ぶ検査のスクリプトで、mutation test や隔離のテストなど、plugin には要らない仕組みを持ちます。plugin を直すと、`tools/scripts` のテストと mutation が走ります。

## Consequences

- plugin を足すときは、`tools/lint-plugins/src/` に plugin と `*.test.ts` を足し、ルートの `vite.config.ts` の `jsPlugins` に path を書きます。coverage の下限を割ると、そのファイルのテストを足すよう `nx test lint-plugins` が失敗します。
- plugin は Oxlint の alpha 機能です ([ADR 0019](0019-custom-oxlint-plugin-for-xss.md))。API が変わったら、Vite+ を上げる PR で `tools/lint-plugins/` を直します。テストは CI の `nx affected` で動くので、壊れれば分かります。
- ルートの `vite.config.ts` は Nx の `sharedGlobals` に入っているので、規則の対象を変えると全 project が affected になります。plugin の置き場所を移したことで、この点は変わりません。
- 工場の成果の指標では、`tools/` の下のファイルは `apps/` や `packages/` の project の外なので、ハーネスの PR に数えます。以前の `apps/*/lint/` を例外にした規則 ([工場の成果の指標](../agents/factory-metrics.md)) は、今の構成では当たるファイルがありません。
- 以前の `apps/web/lint/`、`apps/api/lint/` を指していた docs と設定のコメントは、同じ変更で直しました。工場の成果の指標の `lint/` の例外 (`tools/scripts/src/metrics/metrics.ts`、`factory-metrics.md`) は、「project の中の `lint/` はハーネス」という一般の分類なので、変えていません。

## 出典

1. Nx の `default` の input が `{projectRoot}/**/*` であること、`test` の target が `default` を input にすること: このリポジトリの `nx.json` (`namedInputs.default`、`targetDefaults.test.inputs`)。api の中の `lint/` を直すと api の `test` の cache が無効になる
2. `packages/shared/package.json` の `scripts` が `check` だけで、`test` がないこと: このリポジトリで確かめた (2026-10-27)
