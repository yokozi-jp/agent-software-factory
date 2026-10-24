---
type: ADR
title: "ADR 0013: 手書きのソースの重複は jscpd で検査し、導入時の重複率を閾値にする"
description: apps/ と packages/ の手書きのコードを jscpd 5.4.2 で検査し、重複率が閾値を超えたら pre-commit hook と CI で失敗させる決定。閾値は導入時に測った 0% で、重複を減らす変更で下げていく。対象の形式、外すもの、baseline の方式を選ばなかった理由も書く。重複の検査の対象や閾値を変えるとき、jscpd の版や設定を変えるとき、検査で止まったときに読む。
tags: [adr, tooling, jscpd, ci, quality]
---

# ADR 0013: 手書きのソースの重複は jscpd で検査し、導入時の重複率を閾値にする

コードの重複を検査するものはありませんでした。Vite+ の lint (oxlint) の `no-dupe-*` や `no-duplicate-*` は 1 つのファイルの中しか見ません。エージェントが書くコードは、既にある関数を探さずに同じ処理をもう一度書きがちです。そこで jscpd で、ファイルをまたぐ重複を検査します。

- **道具**: jscpd 5.4.2 です。v5 は Rust で書き直した版で、npm の `jscpd` は、platform ごとの optionalDependencies からビルド済みのバイナリを入れます。install script はありません。版は `pnpm-workspace.yaml` の catalog で固定し、ルートの devDependencies に入れます。
- **実行の経路**: ルートの `package.json` の `lint:dup` (`jscpd`) を、CI の `ci.yml` の `main` job と、`apps/`、`packages/`、`.jscpd.json` を変えた commit の pre-commit hook から呼びます。設定はすべて `.jscpd.json` に書くので、どちらも同じ検査です。リポジトリ全体のタスクはルートの `package.json` scripts で足りる、とした [ADR 0002](0002-nx-orchestrates-vite-plus.md) に従います。`pnpm lint:md` と同じ形です。
- **対象**: `apps/` と `packages/` の JavaScript、JSX、TypeScript、TSX、CSS です (`pattern` と `format`)。`packages/` はまだないので、パスとしては渡さず、`.` を `{apps,packages}/**` で絞ります。jscpd は存在しないパスを渡すと失敗するためです。
- **外すもの**: `.gitignore` の対象 (`dist`、`node_modules`)、生成物の `**/routeTree.gen.ts`、テストの fixture (`**/fixtures/**`、`**/__fixtures__/**`) です。fixture はまだありませんが、わざと同じ内容を並べるものなので、先に外しておきます。テストのコード (`*.test.ts`) は手書きなので対象です。
- **閾値**: `threshold` は 0 です。2026-10-24 に、この設定で `apps/` を測った重複率が 0% (5 ファイル、367 トークン、clone 0) だったので、その値を閾値にしました。jscpd は重複率が閾値を超えると失敗するので、今は clone が 1 つでもあれば止まります。閾値は上げず、0 のまま保ちます。

`apps/api/src` と `apps/web/src` に同じ 11 行の関数を置くと、`jscpd found too many duplicates (12.4%) over threshold (0.0%)` で exit 1 になることを確かめました。`packages/` の下のファイルとの重複も見つかり、同じ内容を `fixtures/` や `dist/` に置いたときは見つかりませんでした。

## Considered Options

- **baseline で新しい重複だけを止める (`--baseline-from-ref origin/main --fail-on-new-clones 0`)**: jscpd の README は、既にある重複で build が止まらないよう、Super Linter や MegaLinter にはこちらを勧めています。既にある重複は残したまま、増えた分だけを止められます。ただ、重複率は下がらず、main の ref を fetch してある必要があり、pre-commit hook と CI で比べる相手が変わります。今は重複がないので、重複率の閾値で足ります。重複を抱えたコードを取り込むことになったら、こちらに移ることを考えます。
- **各プロジェクトの Nx の target にする**: Nx の cache と affected が使えます。ただ、jscpd はプロジェクトの中しか見なくなり、`apps/api` と `apps/web` の間の重複のように、プロジェクトをまたぐ重複を見つけられません。jscpd はこのリポジトリの大きさで 15 ms ほどで終わるので、cache も要りません。
- **`package.json`、`tsconfig.json`、`index.html` も対象にする**: 手で書くファイルですが、プロジェクトを足すたびに同じ形の設定が並ぶので、閾値 0 では正当な設定で止まります。これは判断です。
- **mise で入れる**: 版を固定する CLI ツールは mise で入れます ([ADR 0009](0009-mise-for-pinned-cli-tools.md))。jscpd は npm で配られていて、`markdownlint-cli2` と同じく pnpm の lockfile で版と checksum を固定できるので、Node.js の道具として pnpm で入れます。Issue #55 もそう求めています。
- **jscpd v4 (`jscpd@4`)**: Node.js の実装で、`master-v4` ブランチで保守されています。v5 は同じ `.jscpd.json` と CLI の option をそのまま読み、Node.js も要らないので、新しく入れるなら v5 にします。

## Consequences

- 検査は作業ツリーを丸ごと見ます。clone は stage していないファイルにもまたがるためです。commit していない作業用のファイル (`.gitignore` の対象でないもの) も、ローカルでは検査の対象になります。
- jscpd は既定で、50 トークンか 5 行より短い clone を数えません (`minTokens`、`minLines`)。短い重複は止まりません。
- 意図した重複は、その場所を `// jscpd:ignore-start` と `// jscpd:ignore-end` で囲み、理由を書きます。生成物を足したら、`.jscpd.json` の `ignore` に足します。
- 閾値を上げる変更は、この ADR を直す変更と同じ PR にし、理由を書きます。
- `failOnEmpty` を有効にしたので、`pattern` や `format` を誤って 1 つもファイルを拾わなくなると失敗します。
- 版を上げるときは、`pnpm-workspace.yaml` の catalog の版を変えて `pnpm install` を実行し、`pnpm lint:dup` の結果が変わらないことを確かめます。

## 出典

- v5 が Rust のバイナリで、v4 の `.jscpd.json` と CLI の option をそのまま読むこと、v4 との違い: [jscpd v5 (Rust Engine)](https://github.com/kucherenko/jscpd/blob/master/docs/rust.md) ("Migrating from jscpd v4")
- option、既定の `minTokens` と `minLines`、`--fail-on-empty`、exit code、`jscpd:ignore-start`: 同じ文書の "Options"、"Exit codes"、"Config File"、"Ignoring source regions"
- baseline で新しい重複だけを止める方式を勧めていること: [jscpd の README](https://github.com/kucherenko/jscpd#recommended-aggregator-settings) ("Recommended aggregator settings")
- npm の `jscpd` が platform ごとのバイナリを optionalDependencies で入れること: [jscpd の README](https://github.com/kucherenko/jscpd#packages) ("Packages")、`pnpm view jscpd@5.4.2 optionalDependencies scripts`
- 5.4.2 の公開日 (2026-10-20): `pnpm view jscpd time`
