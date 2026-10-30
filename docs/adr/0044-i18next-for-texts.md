---
type: ADR
title: "ADR 0044: 画面の文言は i18next で packages/i18n に置き、言語はブラウザで決め、キーの欠落と未使用を i18next-cli で CI で止める"
description: web の画面の文言を i18next と react-i18next で出し、ja と en のリソースと初期化を module ではない共有 package の packages/i18n に置く決定。言語はブラウザの言語で決めて ja と en 以外は en、切り替えの UI は作らない。API のエラーは type から文面を引き、知らない type は汎用の文面にする。キーの欠落と未使用は i18next-cli の status と status --unused を nx の i18n-keys の target で CI と pre-commit に置く。文言やキーを足す、直すとき、言語の決め方を変えるとき、Paraglide、FormatJS、Lingui に移したくなったとき、MessageFormat 2 を使いたくなったとき、API のエラーの文面を API に持たせたくなったときに読む。
tags: [adr, i18n, web, i18next, monorepo, repo-policy]
---

# ADR 0044: 画面の文言は i18next で packages/i18n に置き、言語はブラウザで決め、キーの欠落と未使用を i18next-cli で CI で止める

web の画面の文言は、コードに直書きせず、言語ごとのリソースのキーを通して出します。テンプレートは日本語と英語の案件に使われ、`docs/web-frontend/i18n.md` も、単一言語の要件でも i18n の仕組みを入れるよう勧めています。方式の比較と決定は [i18n の方式を決める](https://github.com/yokozi-jp/agent-software-factory/issues/146) にあり、実施は [Issue #176](https://github.com/yokozi-jp/agent-software-factory/issues/176) です。

## 決定

- **ライブラリ**: i18next と react-i18next です。コアが framework 非依存で、将来 API やメールのワーカーでも同じ方式で使えます。MessageFormat 2 は選ぶ条件にしません。仕様は Final Candidate で TC39 は Stage 1 のままで、ja は複数形の区別がなく、対象は 2 言語だけです。
- **置き場所**: `packages/i18n` (`@agent-software-factory/i18n`、Nx project 名は `i18n`) に、ja と en の JSON、i18next の初期化、言語の決定、API のエラーの文面の引き方を置きます。module ではありません。`moduleOrder` に入れず、どの package にも依存せず、module も依存しません。exports は `"."` だけです。
- **リソース**: 名前空間は `translation` の 1 つで、`src/locales/{ja,en}/translation.json` です。キーの型は ja のリソースから作り、`i18next` の `CustomTypeOptions` の augmentation (`src/i18next-types.ts`) で `t` に効かせます。`t("存在しないキー")` は型の検査で止まります。
- **言語**: ブラウザの言語 (`navigator.languages`) を優先順位の高い順に見て、最初の ja か en にします。[Issue #146](https://github.com/yokozi-jp/agent-software-factory/issues/146) と [Issue #176](https://github.com/yokozi-jp/agent-software-factory/issues/176) は `navigator.language` と書いていますが、先頭の 1 つだけを見ると `["fr", "ja"]` の利用者が en になるので、一覧を見ます (判断)。決めた言語は `<html lang>` にも設定します。ja と en 以外だけのときは en です。アプリの中の切り替えと保存は作りません。instance は言語ごとに `createInstance()` で作り、グローバルの instance は使いません。
- **API のエラー**: 識別子は `type` だけです ([ADR 0035](0035-problem-details-for-api-errors.md))。web が `type` から文面を引き (`problemMessage`)、知らない `type` (`about:blank` や後から足された `type`) は汎用の文面にします。API の `title` と `detail` は英語で固定のままです。
- **キーの検査**: `i18next-cli` を 1.80.5 に固定し、`status` (欠落) と `status --unused` (未使用) を `i18n-keys` の Nx target にします。CI の `nx affected -t i18n-keys` と pre-push の hook (`nx-affected-i18n-keys`) で流します。target は `web` に置き (`apps/web/package.json` の script が `packages/i18n` に移って CLI を流す)、`web` が `packages/i18n` に依存するので、どちらを変えても affected になります。対象は `apps/web/src` と `packages/i18n/src` で、コメントとテストと `__fixtures__` の `t("…")` は使われている印にしません。
- **直書きの検査**: `i18next-cli lint` を `i18n-lint` の script として置き、web の画面だけを対象にします。ゲートには入れません。手で流して件数を見る警告から始めます。対象が web の画面だけで `packages/i18n` の中を含めないことは、`keys.test.ts` の fixture で確かめます。
- **検出力**: `packages/i18n/test/keys.test.ts` が、キーの欠けた fixture と使われないキーのある fixture で、設定 (対象の glob と除外) が実際に失敗することを確かめます (`i18next-cli` の中身は確かめません)。設定の glob を壊すと、このテストが失敗します (手で確かめた)。

## Considered Options

- **Paraglide JS**: 型安全な message の関数に compile するので、キーの誤りは型エラーになります。ただ、compiler 方式で Vite のプラグインに依存し、Vite+ での実ビルドは確かめていません。API やメールのワーカーで同じ方式を使うには、runtime の i18next が簡単です。
- **FormatJS (react-intl)**: ICU MessageFormat 1 で、キーの検査は extract と eslint のプラグインです。キーの欠落と未使用を 1 つの CLI で止められる i18next-cli に及びません。
- **Lingui**: compiler 方式で、typed message ID は opt-in です。Paraglide と同じ理由で採りません。
- **MessageFormat 2 を条件にする**: runtime で使えるのは `i18next-mf2` だけで、仕様は Final Candidate のままです。2 言語だけの今は条件にしません。
- **`code` の拡張で文面を引く**: [ADR 0035](0035-problem-details-for-api-errors.md) が識別子を `type` だけにしたので採りません。
- **API が文面を翻訳して返す**: API が `Accept-Language` を読むことになり、web が持つ文言と二重になります。

## Consequences

- Nx の target `i18n-keys` は `web` に置きます。`packages/i18n` に置き、`web` への `implicitDependencies` で画面の変更を affected にする案は、`web` ⇄ `i18n` の循環ができるので採りませんでした。循環があると、`i18n` に `dependsOn: ["^…"]` の target を足したとき task graph が循環で失敗し、`web` だけの変更でも `i18n` のテスト (CLI を起動するので 10 秒以上) が走ります。`web` に置けば、`web` は `packages/i18n` に依存しているので、どちらを変えても affected になります。

- キーは `t("…")` に文字列で書きます。テンプレートリテラルでキーを組み立てる書き方は `i18next-cli` が検出できず、そのキーは未使用として報告されます。`problemMessage` が `switch` で書き下すのは、この理由です。`t` の第 1 引数が文字列リテラルであることは、自作の Oxlint の規則 `i18n/literal-key` (`tools/lint-plugins/src/i18n-plugin.ts`、[Issue #417](https://github.com/yokozi-jp/agent-software-factory/issues/417)) が `apps/web/src` と `packages/i18n/src` で止めます (テストは対象外)。Oxlint の組み込みの規則 (`vp lint --rules` で `restricted-syntax`、`literal`、`i18n` を含む名前を探した) に、呼び出し先の名前で第 1 引数を調べるものはなく、plugin にしました。検出できる `t` は、`t`、`i18n.t`、`i18next.t`、`useTranslation()` の分割代入で別名にした名前です。名前はファイル全体で集め、スコープは見ません。
- `/problems/…` の新しい `type` を API が足すとき、`problemMessage` にも文面を足します。足し忘れても、web は汎用の文面を出して壊れません。足し忘れを型で止める `Record<ProblemType, キー>` と、web の呼び出しは [Issue #308](https://github.com/yokozi-jp/agent-software-factory/issues/308) で足します ([ADR 0035](0035-problem-details-for-api-errors.md) の「型の連鎖」)。
- `t` のキーが文字列リテラルであることを止める lint は、[Issue #417](https://github.com/yokozi-jp/agent-software-factory/issues/417) で足します。それまでは、このルールを文書で守ります。
- 画面で文言が出ることは、`vp build` と `vp check` の型の検査までしか確かめていません。React の描画の component test は、Storybook の土台 ([Issue #141](https://github.com/yokozi-jp/agent-software-factory/issues/141)) が入ったので、story の `play` で足せます。
- API は `packages/i18n` に依存しません。依存だけを足すと Knip が止めるためです ([ADR 0017](0017-knip-unused-code.md))。通知メールの言語 (`user.locale`) を作るときに足します。
- `i18next-cli` は SWC の `@swc/core` に依存します。`pnpm-workspace.yaml` の `allowBuilds` で postinstall を実行しないようにしています。ネイティブの binary は optionalDependencies の別 package で入ります。
- `i18next-cli` の `ignore` と `input` は、cwd (この package) からの相対パスで書きます。`../../apps/web` の下は `**/*.test.tsx` では届かないので、同じ起点で書きます (手で確かめた)。
