---
type: ADR
title: "ADR 0034: UI の部品は module ではない共有 package の packages/ui に置き、exports は部品の入口にする"
description: shadcn/ui の部品と Tailwind v4 のテーマの CSS を packages/ui (@agent-software-factory/ui) に置き、複数のアプリで共有する決定。ADR 0026 の packages/ の直下に、module でも shared でもない ui を足す例外を決める。ui は moduleOrder に入れず、どの package にも依存せず、module も依存しない。exports は "." ではなく ./components/* などの部品の入口にし、層の規則と lint-effect は掛けず、React と XSS の規則は apps/web と同じに掛ける。components.json の alias は package 内を package.json の imports (#components/*) に、アプリからを package 名にする。CSS は ui に置き、アプリが @import と @source で読む。packages/ui に部品を足すとき、2つ目のアプリを作るとき、packages/ の直下に module ではない package を足すとき、shadcn add の置き場所が変わったときに読む。
tags: [adr, web, ui, shadcn, tailwind, monorepo, repo-policy]
---

# ADR 0034: UI の部品は module ではない共有 package の packages/ui に置き、exports は部品の入口にする

[ADR 0033](0033-shadcn-base-ui-tailwind-v4-storybook.md) は、shadcn/ui の部品を `apps/web/src/components/ui/` に置きました。複数のアプリで UI を共有するので、部品を `packages/ui` に移します。shadcn の標準の構成も、共有するなら `packages/ui` と各アプリの `components.json` に分ける形です ([Monorepo](https://ui.shadcn.com/docs/monorepo))。[ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md) は `packages/` の直下を module、`shared`、`module-fixtures` に限り、`exports` を `src/index.ts` だけにしていたので、その例外を決めます ([Issue #330](https://github.com/yokozi-jp/agent-software-factory/issues/330))。

## 決定

- **配置**: `packages/ui` (`@agent-software-factory/ui`、Nx project 名は `ui`) に、shadcn の部品 (`src/components/`)、`cn` (`src/lib/utils.ts`)、Tailwind v4 のテーマの CSS (`src/styles/globals.css`) を置きます。`ui` は module ではありません。`moduleOrder` に入れず、repo-policy (`modules.ts`) は `shared`、`module-fixtures` と同じく、どの workspace の package にも依存しない package として扱います。module が `ui` に依存すると、「module は `shared` と後ろの module だけに依存する」の規則で止まります。アプリ (`apps/*`) が `workspace:*` で依存します。
- **exports**: `"."` は持たず、`./globals.css`、`./components/*`、`./lib/*` を `src/` の中の対応する場所に向けます。shadcn の CLI は部品を 1 つずつファイルにして、部品の path で import するので、`src/index.ts` に集めると `add` が書く import と合いません。ADR 0026 の「`exports` は `"."` だけ」は、module と `shared` と `module-fixtures` の規則で、`ui` には repo-policy が上の 3 つの形を求めます。`src/index.ts` は求めません。`./components/*` の `*` は部品の名前で、ほかの深い import (`@agent-software-factory/ui/src/...`) は引き続き解決できません。
- **層の規則と Effect**: `ui` は業務のコードを持たないので、`domain` などの層に分けません。層の override は `packages/*/src/<layer>/**` だけに掛かるので、`ui` には届きません。`lint-effect` の script も求めません。`packages/*/src/**` の override (深い import の禁止、ランタイムの制限、`import/no-nodejs-modules`) は `ui` にも掛かります。ブラウザで動く部品は Web 標準の API だけで足り、Node.js の組み込みは要らないので、外しません。`ui` が自分の部品を import するときは、package 名の subpath (深い import として止まります) ではなく、`package.json` の `imports` (`#components/*`、`#hooks/*`、`#lib/*`) を使います。
- **React と XSS の規則**: React、JSX の a11y、`no-console`、XSS の規則 (`vite.config.ts` の `webFiles`) は、`apps/web/src/**` と `packages/ui/src/**` の両方に掛けます。部品を移して、規則が外れないようにするためです。`packages/ui/src/__fixtures__/react.tsx` が、規則が `ui` に届くことを確かめます。`apps/web/src` の `@/` の規則 (`../` を止める) は、`ui` には掛けません。`ui` は `@/*` を持たないからです。
- **alias**: `ui` の `components.json` は、package の中を `package.json` の `imports` の `#components`、`#lib`、`#hooks` にします。`apps/web` の `components.json` は、`ui` と `utils` を `@agent-software-factory/ui/components` と `@agent-software-factory/ui/lib/utils` に、アプリの中の `components`、`lib`、`hooks` を `@/...` にします。shadcn の標準の `@workspace/ui` をこの package 名に替えました。`style` (`base-nova`)、`iconLibrary` (`lucide`)、`baseColor` (`neutral`) は両方で同じです。shadcn はこの 3 つが違うと正しく動きません。`#hooks/*` は、`shadcn add` が alias を解決するために必要なので `imports` に置きますが、hooks はまだなく、`exports` には出しません。
- **`@/*` の `paths`**: ADR 0033 の例外 (すべての target が自分の `./src/` の下) は、そのまま `apps/web` に使います。`ui` は `paths` を持ちません。アプリから `ui` の import は `paths` ではなく、`package.json` の `exports` と workspace の依存で解決するので、ADR 0026 の「宣言していない package を解決させない」の規則と衝突しません。`ui` からアプリの import はありません。`ui` はどの workspace の package にも依存しないので、`apps/*` を import すると型の検査で失敗します。
- **CSS**: テーマの CSS は `packages/ui/src/styles/globals.css` に置きます (`@import "tailwindcss"` から `@theme`、`:root`、`.dark` まで)。`shadcn add` が変数を足す先が `components.json` の `tailwind.css` で、両方の `components.json` が同じファイルを指します。アプリの `apps/web/src/index.css` は、`@import "@agent-software-factory/ui/globals.css"` と `@source "../../../packages/ui/src"` だけです。Tailwind v4 の自動検出は、node_modules の下 (workspace の package は symlink で入ります) を読まないので、部品の class は `@source` で足さないと CSS に出ません (`vp build` の出力で `Button` の class が入ることを確かめた)。Tailwind の Vite plugin (`@tailwindcss/vite`) は `apps/web` に残し、`tailwindcss` と `tw-animate-css` などの CSS の依存は `ui` が持ちます。
- **Knip と jscpd**: Knip の `entry` は `packages/ui` の `src/components/**/*.tsx` です (`apps/web` から移しました)。`src/lib/utils.ts` は `exports` から entry になるので書きません。jscpd の除外は `apps/web/src/index.css` から `packages/ui/src/styles/globals.css` に替えました。

## Considered Options

- **`apps/web` に置いたままにする**: アプリが 1 つなら十分です。ただ、2 つ目のアプリが同じ部品を使うには、アプリ同士の import か、コピーになります。部品は今 2 つだけで、移す費用が小さいうちに移します。
- **`ui` を module として `moduleOrder` に入れる**: module は業務の機能で、層に分かれ、`exports` が `index.ts` だけです。`ui` は業務を持たず、層もないので、`moduleOrder` に入れると「`ui` がどの module に依存してよいか」という意味のない問いが生まれます。`shared` と同じ、module ではない package にしました。
- **`shared` に UI を入れる**: `shared` は module が共有する型と `Result` などで、React を依存に持ちません。UI の依存 (React、Base UI、Tailwind) を `shared` に入れると、`apps/api` と module が間接的にそれらに依存します。
- **`src/index.ts` から全部の部品を再 export する**: `add` が書く import (`@agent-software-factory/ui/components/button`) と合わず、`add --diff` の差分が増えます。barrel は tree-shaking も妨げます。

## Consequences

- 部品を足すときは、`apps/web` で `pnpm dlx shadcn@latest add <部品>` を実行します。部品は `packages/ui/src/components/` に入り、テーマの変数は `packages/ui/src/styles/globals.css` に足されます (2026-10 に shadcn の `add separator` で確かめた)。生成されたファイルは、`vp check --fix` で整えてから commit します。
- 2 つ目のアプリは、`workspace:*` で `@agent-software-factory/ui` に依存し、自分の `index.css` に上の 2 行を書き、`components.json` を `apps/web` のものに合わせます。
- 取り込んだコードの更新は ADR 0033 のとおり人が確かめます (`add --diff`)。
- `packages/` の直下に module ではない package を足すときは、この ADR のように、`moduleOrder`、`exports`、層の規則、`lint-effect` をどうするかを決め、`tools/scripts/src/checks/repo-policy/modules.ts` に書きます。

## 出典

- shadcn の monorepo の構成と、両方の `components.json` が `style`、`iconLibrary`、`baseColor` を揃える要件、`package.json` の `imports` を使う構成: [Monorepo](https://ui.shadcn.com/docs/monorepo) (2026-10-28 に読んだ)
- `apps/web` で `shadcn add` を実行すると部品が `packages/ui` に入ること、`#hooks` が解決できないと失敗すること、`@source` で部品の class が CSS に出ること: このリポジトリで確かめた (2026-10-28、shadcn 4.22.1)
