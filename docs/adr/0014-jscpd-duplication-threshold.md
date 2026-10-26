---
type: ADR
title: "ADR 0014: 手書きのソースの重複は jscpd で検査し、導入時の重複率を閾値にする"
description: apps/ と packages/ の手書きのコードを jscpd 5.4.2 で検査し、重複率が閾値を超えたら pre-commit hook と CI で失敗させる決定。閾値は導入時に測った 0% で、それより下げられないので 0 のまま保つ。対象の形式、外すもの、baseline の方式を選ばなかった理由も書く。重複の検査で止まったとき、検査の対象や閾値、jscpd の版や設定を変えるときに読む。
tags: [adr, tooling, jscpd, ci, quality]
---

# ADR 0014: 手書きのソースの重複は jscpd で検査し、導入時の重複率を閾値にする

ファイルをまたぐコードの重複を検査するものはありませんでした。oxlint の `no-dupe-keys`、`no-dupe-class-members`、`no-duplicate-case` などは、1 つのオブジェクト、クラス、`switch` の中の重複を見る規則です。そこで jscpd で、ファイルをまたぐ重複を検査します。

- **道具**: jscpd 5.4.2 です。v5 は検出を Rust で書き直した版で、npm の `jscpd` は、platform ごとの optionalDependencies からビルド済みのバイナリを入れ、Node.js の小さな wrapper (`run-jscpd.js`) から呼びます。install script はありません。版は `pnpm-workspace.yaml` の catalog で固定し、ルートの devDependencies に入れます。
- **実行の経路**: ルートの `package.json` の `lint:dup` (`jscpd`) を、CI の `ci.yml` の `checks` job と、`apps/`、`packages/`、`.jscpd.json`、`pnpm-workspace.yaml` を変えた commit の pre-commit hook から呼びます。設定はすべて `.jscpd.json` に書くので、どちらも同じ検査です。リポジトリ全体のタスクはルートの `package.json` scripts で足りる、とした [ADR 0002](0002-nx-orchestrates-vite-plus.md) に従います。`pnpm lint:md` と同じ形です。
- **対象**: `apps/` と `packages/` の JavaScript、JSX、TypeScript、TSX、CSS です (`pattern` と `format`)。`packages/` はまだないので、パスとしては渡さず、`.` を `{apps,packages}/**` で絞ります。jscpd は存在しないパスを渡すと失敗するためです。
- **外すもの**: `.gitignore` の対象 (`dist`、`node_modules`、TanStack Router が一時ファイルを書く `.tanstack/`)、生成物の `**/routeTree.gen.ts`、テストの fixture (`**/fixtures/**`、`**/__fixtures__/**`) です。fixture はまだありませんが、わざと同じ内容を並べるものなので、先に外しておきます。テストのコード (`*.test.ts`) は手書きなので対象です。
- **閾値**: `threshold` は 0 です。2026-10-24 に、この設定で `apps/` を測った重複率が 0% (5 ファイル、367 トークン、clone 0) だったので、その値を閾値にしました。jscpd は重複率が閾値を超えると失敗するので、今は clone が 1 つでもあれば止まります。0 より下げられないので、0 のまま保ちます。

`apps/api/src` と `apps/web/src` に同じ 11 行の関数を置くと、`jscpd found too many duplicates (12.4%) over threshold (0.0%)` で exit 1 になることを確かめました。`tools/scripts/src/configs/jscpd.tools.test.ts` が、この設定で、`apps/` と `packages/` の重複で失敗し、対象外の場所の重複と `jscpd:ignore` で囲んだ重複では通ることを確かめます。

## Considered Options

- **baseline で新しい重複だけを止める (`--baseline-from-ref origin/main --fail-on-new-clones 0`)**: jscpd の README は、既にある重複で build が止まらないよう、Super Linter や MegaLinter にはこちらを勧めています。既にある重複は残したまま、増えた分だけを止められます。ただ、重複率は下がらず、main の ref を fetch してある必要があり、pre-commit hook と CI で比べる相手が変わります。HEAD の clone を baseline にする `--changed` も、比べる相手がローカルの HEAD になる点で同じです。今は重複がないので、重複率の閾値で足ります。重複を抱えたコードを取り込むことになったら、閾値を上げずに、こちらへ移ることをこの ADR を直して決めます。
- **各プロジェクトの Nx の target にする**: Nx の cache と affected が使えます。ただ、jscpd はプロジェクトの中しか見なくなり、`apps/api` と `apps/web` の間の重複のように、プロジェクトをまたぐ重複を見つけられません。jscpd はこのリポジトリの大きさで 15 ms ほどで終わるので、cache も要りません。
- **`package.json`、`tsconfig.json`、`index.html` も対象にする**: 手で書くファイルですが、プロジェクトを足すたびに同じ形の設定が並ぶので、閾値 0 では正当な設定で止まります。これは判断です。
- **mise で入れる**: 版を固定する CLI ツールは mise で入れます ([ADR 0009](0009-mise-for-pinned-cli-tools.md))。jscpd は npm で配られていて、`markdownlint-cli2` と同じく pnpm の lockfile で版と checksum を固定できるので、Node.js の道具として pnpm で入れます。Issue #55 もそう求めています。
- **jscpd v4 (`jscpd@4`)**: 検出も Node.js で動く版で、`master-v4` ブランチで保守されています。v5 は同じ `.jscpd.json` と CLI の option をそのまま読むので、新しく入れるなら v5 にします。

## Consequences

- 検査は作業ツリーを丸ごと見ます。clone は stage していないファイルにもまたがるためです。commit していない作業用のファイル (`.gitignore` の対象でないもの) も、ローカルでは検査の対象になります。
- jscpd は既定で、50 トークンか 5 行より短い clone を数えません (`minTokens`、`minLines`)。短い重複は止まりません。
- 意図した重複は、閾値を上げずに、その場所を `// jscpd:ignore-start` と `// jscpd:ignore-end` で囲み、理由を書きます。生成物を足したら、`.jscpd.json` の `ignore` に足します。
- `failOnEmpty` を有効にしたので、`pattern` や `format` を誤って 1 つもファイルを拾わなくなると失敗します。
- 版を上げるときは、`pnpm-workspace.yaml` の catalog の版を変えて `pnpm install` を実行します。`pnpm-workspace.yaml` を変えた commit では、pre-commit hook が `pnpm lint:dup` を実行します。

## 出典

- v5 が Rust のバイナリで、v4 の `.jscpd.json` と CLI の option をそのまま読むこと、v4 との違い: [jscpd v5 (Rust Engine)](https://github.com/kucherenko/jscpd/blob/master/docs/rust.md) ("Migrating from jscpd v4")
- option、既定の `minTokens` と `minLines`、`--fail-on-empty`、`--changed`、exit code、`jscpd:ignore-start`: 同じ文書の "Options"、"Changed files"、"Exit codes"、"Config File"、"Ignoring source regions"
- baseline で新しい重複だけを止める方式を勧めていること: [jscpd の README](https://github.com/kucherenko/jscpd#recommended-aggregator-settings) ("Recommended aggregator settings")
- npm の `jscpd` が platform ごとのバイナリを optionalDependencies で入れること: [jscpd の README](https://github.com/kucherenko/jscpd#packages) ("Packages")、`pnpm view jscpd@5.4.2 optionalDependencies scripts bin`
- oxlint の規則が見る範囲: [oxlint の `no-dupe-keys`](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-dupe-keys.html)、[`no-duplicate-case`](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-duplicate-case.html)
- 5.4.2 の公開日 (2026-10-20): `pnpm view jscpd time`
