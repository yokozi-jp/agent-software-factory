---
type: ADR
title: "ADR 0033: web の UI は shadcn/ui (Base UI) と Tailwind CSS v4 で作り、カタログは Storybook に一本化する"
description: web の UI 部品を shadcn/ui (下位ライブラリは Base UI) で作り、スタイルを Tailwind CSS v4 にし、部品のカタログと component test を Storybook に一本化する決定。部品のコードを components/ui/ に取り込んで自分たちで持つこと、取り込んだコードの更新が Renovate で追えず shadcn add --diff で手で確かめること、Storybook に Vite+ の公式の保証がなく外す条件があること、Base UI の ScrollArea と Select が style 要素を出す CSP の制約を書く。比べた案は Material UI、React Aria Components 単体、CSS-in-JS。UI の部品やスタイルの方式を変えるとき、部品を足すとき、Storybook や component test を入れるとき、web の CSP を決めるときに読む。
tags: [adr, web, ui, shadcn, base-ui, tailwind, storybook, csp]
---

# ADR 0033: web の UI は shadcn/ui (Base UI) と Tailwind CSS v4 で作り、カタログは Storybook に一本化する

`apps/web` の UI 部品は shadcn/ui (下位ライブラリは Base UI) で作り、スタイルは Tailwind CSS v4 で書きます。部品のカタログと component test は Storybook に一本化します。決定は [web の UI コンポーネントとカタログの方式を決める](https://github.com/yokozi-jp/agent-software-factory/issues/227) の解決コメントにあり、比較は [Issue #226](https://github.com/yokozi-jp/agent-software-factory/issues/226) です。導入は [Issue #314](https://github.com/yokozi-jp/agent-software-factory/issues/314) で行いました。Storybook は [Issue #141](https://github.com/yokozi-jp/agent-software-factory/issues/141) で入れました。この ADR の範囲は、shadcn (Base UI)、Tailwind v4、Storybook です。

## 決定

- **UI 部品**: shadcn/ui の CLI で部品のコードを `packages/ui/src/components/` に取り込みます ([ADR 0034](0034-shared-ui-package.md)。最初は `apps/web/src/components/ui/` に置き、Issue #330 で移しました)。取り込んだコードはこのリポジトリのコードで、直接編集します。下位ライブラリは Base UI (`@base-ui/react`) で、`pnpm dlx shadcn@latest init --base base` が選びます。`components.json` に設定が残ります。
- **スタイル**: Tailwind CSS v4 (`tailwindcss` と `@tailwindcss/vite`) です。テーマの CSS は `packages/ui/src/styles/globals.css` で、CSS の入口の `apps/web/src/index.css` が `@import` と `@source` で読み、`main.tsx` が `index.css` を読みます (ADR 0034)。CSS-in-JS は使いません。
- **alias**: `@/*` は `apps/web/src/*` を指します。`tsconfig.json` の `paths` に書きます。`apps/web` の中のコードが `@/routes/...` のように import します。`packages/ui` の部品は `paths` ではなく `package.json` の `imports` (`#components/*`) と `exports` で import します (ADR 0034)。`apps/web/src` は、別のディレクトリのファイルを `@/` で import し、`../` を使いません。`vite.config.ts` の `no-restricted-imports` が `../` を止め、`apps/web/src/__fixtures__/relative-parent.ts` が検出力を確かめます。`apps/api` と `packages/*` には適用しません。
- **alias の実装**: `vite.config.ts` は `resolve.tsconfigPaths: true` にして、`tsconfig.json` の `paths` を Vite が読みます。`resolve.alias` は書きません (Issue #314 は `resolve.alias` を挙げていました)。[ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md) は、宣言していない package を解決させる `paths` と `alias` を repo-policy で止めています。`@/*` が指すのは自分の `./src/*` だけで、ほかの package は解決しません。そこで repo-policy は、すべての target が `./src/` の下にある `paths` を許し、空の `paths`、`..` を含む target、`baseUrl`、`alias` は止めたままにしました。ADR 0026 のほかの規則は変えません。
- **版**: 足した依存の版は `pnpm-workspace.yaml` の catalog で固定します。`shadcn init` が足す行の引用符は `vp fmt` で整えます。
- **置き場所**: 部品は `packages/ui/src/components/` です。業務コンポーネントは置きません ([Webフロントエンドのコンポーネント設計](../web-frontend/component-design.md))。
- **story**: `packages/ui/src/components/` の各部品に隣の `*.stories.tsx` を必須にします。ない部品は失敗にします。この検査は repo-policy の `uiComponentsHaveStories` (`tools/scripts/src/checks/repo-policy/ui-stories.ts`) で、追跡しているファイルの一覧だけを読みます ([Issue #315](https://github.com/yokozi-jp/agent-software-factory/issues/315))。lint の plugin (ADR 0030) にしなかったのは、plugin が 1 つのファイルしか見ず、隣のファイルがあるかを知るには fs を読む必要があるためです (判断)。業務コンポーネントは対象外です。
- **story の書き方**: `eslint-plugin-storybook` を Oxlint の `jsPlugins` で動かします (`vite.config.ts` の `*.stories.tsx` の override)。型の情報が要らない recommended の規則が動くことを確かめました (10.6.5、2026-10-30)。recommended で警告の規則も error にします。`storybook/await-interactions` は入れません。この規則は `@storybook/test` の import しか読まず、Storybook 10 の `storybook/test` では何も報告しないためです。`await` の漏れは、型を使う `typescript/no-floating-promises` が止めます (警告は `denyWarnings` で失敗になる)。`storybook/no-uninstalled-addons` は入れていません (`.storybook/main.ts` に別の override が要り、足す理由がまだありません)。ESLint は併用しません ([ADR 0002](0002-nx-orchestrates-vite-plus.md))。
- **a11y**: `@storybook/addon-a11y` (axe) を入れ、`parameters.a11y.test` を `"todo"` にします (`apps/web/.storybook/preview.ts`)。違反は story のテストを失敗にせず、Storybook の画面に警告で出ます。公式の仕組みは CI のログに何も出さないので、Vitest の reporter (`apps/web/test/a11y-warnings-reporter.ts`) が、警告の違反を実行ログに `a11y warning: <story>: <規則>` と出します。止める側に上げるときは、`"error"` に変えます。違反のある story だけ `"todo"` に戻せます。
- **テスト**: Storybook の story を component test にします。`*.test.tsx` と `vitest-browser-react` は使いません。`packages/ui` に専用のテストは書きません。基盤の確認は `vp check` と `vp build` です。
- **`apps/web` の画面のテスト**: `apps/web` の画面とルーターのガードも、story の `play` で確かめます。ルーターはメモリ履歴で包み、API はモックにします。unit は `*.test.ts` で書き、使わないのは `*.test.tsx` と `vitest-browser-react` だけです。story の漏れを CI で止めるのは `packages/ui/src/components/` だけです。画面の story は `apps/web/src/` に置きます (`.storybook/main.ts` の `stories` が読む)。ルーターは story の中で、本物の route の木 (`createAppRouter`) をメモリ履歴と mock の context (`/api/me` の結果、`signIn`、`apiFetch`) で動かします。全部の story に効く文言 (`I18nextProvider`) は `.storybook/preview.ts` の decorator が与えます。route のファイル (`src/routes/`) も coverage の対象で、この story と unit で通します ([Issue #406](https://github.com/yokozi-jp/agent-software-factory/issues/406))。決めた経緯は [ログインとトップとメニューの受け入れ条件と、テストの境界を決める](https://github.com/yokozi-jp/agent-software-factory/issues/401) の解決コメントにあります。

## 制約

- **取り込んだコードの更新は Renovate で追えません。** 部品のコードは依存ではなくリポジトリのファイルなので、Renovate は上流の変更を知りません。依存 (`@base-ui/react`、`shadcn` など) の版は Renovate が追います。部品のコードは `pnpm dlx shadcn@latest add <部品> --diff` で上流との差を見て、必要な変更を手で取り込みます。`--dry-run` は書かずに内容を確かめられます。
- **Base UI の `ScrollArea` と `Select` (`alignItemWithTrigger`) は `<style>` 要素を出します。** CSP が `style-src` を制限すると、この `<style>` が止まります。使うときは、アプリの上位に Base UI の `CSPProvider` を置き、`disableStyleElements` を付けるか `nonce` を渡します (`@base-ui/react/csp-provider` の型定義で確認)。web の CSP はまだ決まっていないので、検査は作りません。この制約を、CSP を決める Issue に引き継ぎます。
- **Storybook に Vite+ の公式の保証はありません。** Storybook は Vite を使いますが、このリポジトリの `vite` は `@voidzero-dev/vite-plus-core` に差し替えています。Vite+ が Storybook の動作を保証する文書はなく、動かなくなっても Vite+ 側の修正は約束されません。
- **Storybook を外す条件**: Vite+ の更新で Storybook が起動しないか story の test が動かず、直す手間が story を持つ利点を上回るときです。外すときは、ここに書いた story 必須の検査も外し、component test を Vitest の browser mode の `*.test.tsx` に戻すかを決め直し、この ADR を置き換える ADR を書きます。

## Knip と jscpd の扱い

`shadcn add` が書くコードは、このリポジトリの検査をそのままでは通りません。

- **Knip** ([ADR 0017](0017-knip-unused-code.md)): `packages/ui/src/components/` の部品は、画面が使うまで import されず、部品の中に使わない export (variant、小さな部品) があります。`knip.jsonc` の `packages/ui` に、`src/components/**/*.tsx` を `entry` として書きました (`src/lib/utils.ts` は `exports` から entry になります)。生成された部品は `cn` を npm の `cn` (shadcn-ui の公式の package) から直接 import するので、`utils.ts` は今は import されません。`components.json` の `aliases.utils` が指すファイルで、自分で書くコードが `@agent-software-factory/ui/lib/utils` から `cn` を import するときに使います。entry の export は報告されず、部品が import する `@base-ui/react` や `cn` も使用中と数えられます。上流が出す export を、使うたびに `@public` で許可する運用は避けました。
- **jscpd** ([ADR 0014](0014-jscpd-duplication-threshold.md)): `shadcn init` が書く `index.css` は、`:root` と `.dark` のテーマ変数が似た 7 行の並びになり、閾値 0 の重複として止まります。生成されたファイルなので、`.jscpd.json` の `ignore` に `packages/ui/src/styles/globals.css` だけを足しました (移す前は `apps/web/src/index.css`)。部品の `.tsx` は重複が出ていないので、除外しません。重複が出たら、その部品に限って足します。

## Considered Options

- **Material UI**: 部品が揃い、保守も活発です。ただし、見た目の調整は MUI のテーマと CSS-in-JS (Emotion) を通すことになり、Tailwind と別の方式が増えます。コードを自分で持たないので、見た目や構造を大きく変えにくいです (判断)。
- **React Aria Components 単体**: アクセシビリティの品質は高く、Base UI と同じ位置づけです。ただし、スタイルのついた部品の一式はなく、見た目を一から作ります。shadcn/ui が下位ライブラリに React Aria を選ぶ道もありますが、既定は Base UI で、既定に従うほうが `shadcn add` の更新に追従しやすいです (判断)。
- **CSS-in-JS**: 実行時に `<style>` を挿入する方式は、CSP の `style-src` と相性が悪く、Tailwind と二重になります。
- **Storybook と Vitest の browser mode の `*.test.tsx` を分ける**: story が腐ったときに人が気づく必要があります。一本化なら CI が story の壊れを止めます ([Issue #227](https://github.com/yokozi-jp/agent-software-factory/issues/227))。

## Consequences

- 部品を足すときは `pnpm dlx shadcn@latest add <部品>` を `apps/web` で実行し (部品は `packages/ui` に入ります)、`vp check` と `vp build` を通します。
- 取り込んだコードの更新は人が確かめます。Renovate の PR は出ません。
- `globals.css` には shadcn が書くダークモード用の変数と `.dark` の変種が入っています。ダークモードは使わない範囲で、決めるときは [ダークモード](../web-frontend/dark-mode.md) を読みます。
- 部品は `packages/ui` に置き、複数のアプリで共有します。ADR 0026 の例外は [ADR 0034](0034-shared-ui-package.md) で決めました ([Issue #330](https://github.com/yokozi-jp/agent-software-factory/issues/330))。
- Storybook は `apps/web/.storybook/` にあり、`stories` の glob に `apps/web/src` と `packages/ui/src/components` を並べて、1 つのカタログにまとめています。story は Vitest の `storybook` project で流れます。
- `packages/ui` の story は、`src/components/tsconfig.json` の program で型を見ます。`@storybook/react-vite` の型が Node.js の型を連れてくるので、`packages/ui` の本体の program (`types: []`) に入れると、`src/__fixtures__/node-modules.ts` が確かめる「ブラウザの部品に Node.js の型がない」が崩れるためです (判断。`vp check` は story を、最も近い `tsconfig.json` で型検査する)。
- 検査の lint の規則は、`packages/ui/src/__fixtures__/*.stories.tsx` の fixture が検出力を確かめます。Storybook の `stories` は `src/components/` の下だけを読むので、fixture はカタログに出ません。fixture の story は `src/__fixtures__/tsconfig.json` の program で型を見ます (`src/components/tsconfig.json` と同じ理由)。
- Knip の Storybook plugin は、既定で全ての `*.stories.tsx` を entry にして、fixture が意図して使う依存を未登録と報告します。`knip.json` の `packages/ui` で、entry を `src/components/**/*.stories.tsx` に絞っています。
