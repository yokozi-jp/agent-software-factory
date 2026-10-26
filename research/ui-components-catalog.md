# web の UI コンポーネントの方式と、コンポーネントのカタログの道具を、一次情報で比べる

## 問い

[Issue #226](https://github.com/yokozi-jp/agent-software-factory/issues/226) の調査。[web の UI コンポーネントとカタログの方式を決める](https://github.com/yokozi-jp/agent-software-factory/issues/227) の材料にする。この文書は決定を下さない。

- UI コンポーネント: shadcn/ui（Radix UI か Base UI か、CLI、registry、MCP）、React Aria Components、Material UI などの完成品、自作。Tailwind CSS v4 との組み合わせ、アクセシビリティ、i18n（[#146](https://github.com/yokozi-jp/agent-software-factory/issues/146)）、bundle の大きさ、更新の追い方、エージェントの書きやすさ。
- カタログ: Storybook（最新の版、Vitest addon、React 19、Vite+ との相性）、Ladle、React Cosmos、カタログを持たず Vitest の browser mode だけにする形。
- カタログとテストの関係: story を Vitest の browser mode で流す形と [#141](https://github.com/yokozi-jp/agent-software-factory/issues/141) の重なり。視覚の回帰テスト。
- 検査: CSP、XSS の lint（ADR 0019）、Knip（ADR 0017）、jscpd（ADR 0014）。

調べた日は 2026-10-26。`apps/web` を `/tmp` に複製して（`@tanstack/react-router`、React 19.3.1、`vite-plus` 1.4.0、pnpm の catalog、`catalogMode: prefer`）、実際にコマンドを動かした。worktree には `node_modules` を残していない。複製の環境と本物の差は「未確認のこと」に書いた。

## 要約

確かめた事実:

- shadcn/ui の既定は 2026-07-02 から Base UI。Radix は `--base radix` で選べ、2026-07-17 から React Aria も `--base aria` で選べる。3 つとも同じ CLI と registry から入る。
- shadcn の CLI は、このリポジトリの pnpm catalog の構成でそのまま動いた。`init --base base` が `package.json` に `catalog:` を書き、`pnpm-workspace.yaml` の catalog に版を足した。
- Storybook は 10.6.4（今日公開）が最新で、`next` ブランチは 11.0.0-alpha.8。`@storybook/react-vite` と `@storybook/addon-vitest` は Vite 8 と React 19 と Vitest 5 に対応を宣言している。`vite-plus-core` の alias の上で、`storybook build`、`storybook dev`、`vp test run` の 3 つとも動いた。
- Vite+ の公式 docs に Storybook の記述はない。動いたのは、Storybook が `vite.config.ts` と Vitest の plugin の仕組みを通常の Vite として使うため。公式の保証ではない。
- Ladle の最新は 5.1.1（2025-11-04）で、最後の commit は 2026-06-28。React Cosmos は 7.4.1（2026-08-31）。どちらにも Vitest で story をテストにする仕組みは見つからなかった。
- Vitest の browser mode は `toMatchScreenshot` を持つ。カタログがなくても視覚の回帰テストを書ける。ただし Vitest の docs 自身が、安定させるには Docker などの固定した環境を勧めている。
- shadcn の生成物を `vp check`（lint、format、型検査、ADR 0019 の XSS plugin、ADR 0020 の厳しい tsconfig）に通すと、format だけが指摘され、`vp check --fix` で直った。Knip は使わない export と未使用のファイルを報告した。jscpd は TS/TSX の重複を報告せず、生成された CSS で 1 件報告した。

判断（私の見立て。決定ではない）:

- 取り込む方式（shadcn）と、完成品（Material UI）と、ヘッドレス（React Aria Components 単体）は、更新の追い方、CSP、Knip、i18n の 4 点で差が大きい。比較表は末尾にある。
- Storybook を入れるかは、「story を Vitest で流す」ことの価値が、`apps/web` の component test（#141）を story に一本化する価値と釣り合うかで決まる。#141 を先に入れても、後から Storybook に移れる（同じ Vitest の browser mode、同じ Playwright の provider）。
- 論点の一覧は末尾にある。

## UI コンポーネント

### shadcn/ui

確かめた事実:

- shadcn/ui は「コンポーネントの library ではなく、library を作る方法」と自称する。コンポーネントのコードを自分のリポジトリに置き、編集できる（[Introduction](https://ui.shadcn.com/docs)、ソース: [`apps/v4/content/docs/(root)/index.mdx`](https://github.com/shadcn-ui/ui/blob/8f04138777c1b6996e709993362a7b0a12888ecf/apps/v4/content/docs/%28root%29/index.mdx)）。
- 既定は Base UI。2026-07-02 の告知は、新しい project は Base UI を既定にし、Radix は廃止せず、更新と新しいコンポーネントは両方に出すとしている。Radix にするなら `npx shadcn init -b radix`。CI で `init` を非対話で流す場合は `-b radix` を付けないと Base UI になる（[July 2026 - Base UI as the Default](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)）。
- 2026-07-17 から React Aria も同じ `--base aria` で選べる。既存の project は今の base のまま（[July 2026 - React Aria](https://ui.shadcn.com/docs/changelog/2026-07-react-aria)）。docs の `components/` に `base`、`radix`、`aria` の 3 つの一覧がある（それぞれ 67、68、66 ファイル。clone した `8f04138`、2026-10-26 時点）。
- Radix から Base UI への移行は、codemod ではなく agent 向けの skill（`npx skills add shadcn/ui`）。`asChild` は `render` に変わる（同じ告知）。
- CLI v4（2026-03-06）に `--dry-run`、`--diff`、`--view`、`info`、`docs`、`--preset`、`--template`（Vite を含む）、`--monorepo` がある（[March 2026 - shadcn/cli v4](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4)、[CLI](https://ui.shadcn.com/docs/cli)）。`add` の更新の確認は `--diff` を使う（同じ告知）。
- 2026-09-03 から、コンポーネントは `cn` を `cn` パッケージ（`twMerge(clsx())` の代わり）から import する。`lib/utils.ts` は `export { cn } from "cn"` の 1 行になる（[September 2026 - cn](https://ui.shadcn.com/docs/changelog/2026-09-cn)）。実際に `init` で同じ 1 行が生成された。
- `init` は CSS に `@import "shadcn/tailwind.css"` を足し、`shadcn` パッケージを依存に入れる。外すには `npx shadcn eject`（[May 2026 - shadcn eject](https://ui.shadcn.com/docs/changelog/2026-05-shadcn-eject)）。実際に `shadcn` が `dependencies` に入った。
- registry: 公式の registry のほか、`components.json` の `registries` に `@namespace` の URL を足して、外部や社内の registry から入れられる（[MCP Server](https://ui.shadcn.com/docs/mcp)、[Registry](https://ui.shadcn.com/docs/registry)）。2026-06 から GitHub を registry にでき、2026-08 から private の GitHub も使える（[changelog の一覧](https://github.com/shadcn-ui/ui/tree/8f04138777c1b6996e709993362a7b0a12888ecf/apps/v4/content/docs/changelog)）。
- MCP: `npx shadcn@latest mcp init --client <claude|cursor|vscode|codex|opencode>` で設定を書く（[MCP Server](https://ui.shadcn.com/docs/mcp)）。ソースの tool は `get_project_registries`、`list_items_in_registries`、`search_items_in_registries`、`view_items_in_registries`、`get_item_examples_from_registries`、`get_add_command_for_items`、`get_audit_checklist`（[`packages/shadcn/src/mcp/index.ts`](https://github.com/shadcn-ui/ui/blob/8f04138777c1b6996e709993362a7b0a12888ecf/packages/shadcn/src/mcp/index.ts)）。MCP の他に skill（[Skills](https://ui.shadcn.com/docs/skills)）と `shadcn docs <name>`、`shadcn info` がある。
- 最新の `shadcn` は 4.22.1（npm、2026-10-18）。

実際に動かした結果（`/tmp/uicat/apps/web`、pnpm 11.21.0、Node 24.22.1）:

- Tailwind v4（`tailwindcss` と `@tailwindcss/vite` 4.3.3）、`@/*` の alias（tsconfig の `paths` と `resolve.alias`）を足した後、`pnpm dlx shadcn@latest init --base base -y -d` が約 55 秒で通った。`components.json` は `"style": "base-nova"`、`"tailwind.config": ""`（v4）。
- `package.json` に `"@base-ui/react": "catalog:"` など 10 件が入り、`pnpm-workspace.yaml` の catalog に `'@base-ui/react': ^1.9.0` などが足された。足された行は単引用符で、既存の行は二重引用符だった。`oxfmt` に整形させる必要がある（#120 の記録と同じ）。誰が catalog に書いたか（shadcn か、shadcn が呼んだ `pnpm add`）は確かめていない。
- `shadcn add dialog card` と `shadcn add card dialog --dry-run` が通った。`--dry-run` は作るファイルと依存を表示し、既存の `button.tsx` は `skip (identical)` になった。
- `vp check`（`--fix` の後）は lint、format、型検査に通った。複製したルートの `vite.config.ts` に ADR 0019 の `web-xss` plugin と ADR 0020 の厳しい設定が入っている。生成された `button.tsx`、`dialog.tsx`、`card.tsx` は指摘されなかった。最初の `vp check` は format の指摘だけ（生成物は oxfmt の形式ではない）。
- bundle（`vp build`、minify）: 何も足さない状態の JS は 296.79 kB（gzip 95.86 kB）。Base UI の `Dialog` と `Button` を route から使うと、route の chunk が 93.53 kB（gzip 33.89 kB）増えた。CSS は 37.50 kB（gzip 7.59 kB）、Geist の font が約 77 kB。

### Base UI と Radix の違い（CSP と更新に関わる点）

確かめた事実:

- Base UI は、一部のコンポーネントがインラインの `<style>` や `<script>` を出す。`ScrollArea.Viewport`、`alignItemWithTrigger` を有効にした `Select.Popup`/`Select.List` が `<style>` を出す。`<script>` は opt-in。`CSPProvider` に `nonce` を渡すか、`disableStyleElements` で `<style>` を止められる（[CSP Provider](https://base-ui.com/react/utils/csp-provider)）。`@base-ui/react` 1.9.0 の `internals/PrehydrationScript.js`、`slider/thumb/SliderThumb.js`、`tabs/indicator/TabsIndicator.js` がインラインの script を使う（`node_modules` を grep した結果）。
- 同じ docs は、`style=""` 属性は `CSPProvider` の対象外で、`style-src-attr` が関わると書く。ただし、サーバーで描画した HTML の属性に限り、client の JavaScript が設定する style は影響を受けない。
- `@base-ui/react` の最新は 1.9.0（npm、2026-10-09）。shadcn の告知は 1.6.0 を安定の根拠にした。

### React Aria Components

確かめた事実:

- スタイルを持たない。`className` と `style` を受け取り、状態を `data-*` 属性で出す。Tailwind v4 では `data-[selected]:bg-blue-400` と書くか、`tailwindcss-react-aria-components` の plugin（`@plugin "tailwindcss-react-aria-components";`）で `selected:` と書く（[Styling](https://react-aria.adobe.com/styling)）。
- i18n: 30 以上の言語の文字列を持ち、日付と数値は多くの暦と数字体系に対応し、右から左の操作も扱う。`I18nProvider` の `locale` で、ブラウザの設定を上書きできる（[Quality](https://react-aria.adobe.com/quality)、[I18nProvider](https://react-aria.adobe.com/I18nProvider)）。
- 最新は 1.22.1（npm、2026-10-09）。ユーザー操作を再現するテスト用 util と、`Select`、`Menu`、`Table` などの個別のテストの docs がある（[Testing](https://react-aria.adobe.com/testing)）。
- shadcn の `--base aria` で入る（上記）。

実際に動かした結果: `react-aria-components` の `Button`、`DialogTrigger`、`Modal`、`Dialog` を route から使うと、route の chunk が 80.84 kB（gzip 26.20 kB）増えた。同じ操作をする Base UI（shadcn の `dialog.tsx`）は 93.53 kB（gzip 33.89 kB）。同じ UI ではないので、優劣ではなく桁の目安。

### Material UI（完成品の例）

確かめた事実:

- 最新は `@mui/material` 9.5.0（npm、2026-10-12）。
- Emotion が `<style>` を実行時に出す。CSP の docs は、サーバーがあるなら request ごとの nonce を `style-src-elem` に使えるが、「S3 や CDN だけの静的な配信では nonce を作るサーバーがなく、`'unsafe-inline'` が唯一の選択肢」と書く（[Content Security Policy](https://mui.com/material-ui/guides/content-security-policy/)）。
- このリポジトリの web が静的配信かどうかは、`docs/web-frontend/hosting.md` と ADR 0013 に依る（未確認のことに書いた）。

### 自作

確かめた事実: 取り込んだ規約 `docs/web-frontend/component-design.md` は、まず既存の library を検討し、その次にヘッドレス UI と Tailwind CSS の中間の方式を挙げ、フルスクラッチは「ユニークな UI の要求か、専門の人手がある場合」とする。これは出典がフューチャー社のガイドライン（2025 年）で、shadcn/Base UI/RAC の 2026 年の状況は反映していない。

## カタログ

### Storybook

確かめた事実:

- 最新の安定版は 10.6.4（`storybook`、`@storybook/react-vite`、`@storybook/addon-vitest` ともに 2026-10-26 に公開）。`next` ブランチ（`eeeb753`）は 11.0.0-alpha.8（[storybookjs/storybook](https://github.com/storybookjs/storybook)）。
- 動作要件: Node.js 22.12 以上、Vite 5 以上、Vitest 3 以上、pnpm 9 以上、TypeScript 5.9 以上。Storybook の UI は Chrome 147 以上、Edge 150 以上などを対象にする（[Install](https://storybook.js.org/docs/get-started/install)、ソース: Storybook リポジトリの `get-started/install.mdx`）。このリポジトリは Node `^24`、pnpm 12.15.0、TypeScript 7 なので、要件の範囲内。
- `@storybook/react-vite` 10.6.4 の peer は Vite `^5 || ^6 || ^7 || ^8`、React `^16.8 || … || ^19`。`@storybook/addon-vitest` の peer は Vitest `^4 || ^5`、`@vitest/browser-playwright` `^4 || ^5`（`npm view`）。Vite+ 1.4.0 は Vitest 5.0.5 に固定している（[Test](https://github.com/voidzero-dev/vite-plus/blob/main/docs/guide/test.md)）。
- Vitest addon は、story を Vitest の browser mode のテストに変換する。Vite を使う framework が前提で、webpack は対象外（[Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon)）。CI で多数の story を流すと「Failed to fetch dynamically imported module」が出ることがあり、`isolate: false` か shard で避ける（同じ docs）。
- a11y addon は axe-core 上に作られ、Vitest addon に統合できる。axe で WCAG の問題の最大 57% が自動で見つかるとする（[Accessibility testing](https://storybook.js.org/docs/writing-tests/accessibility-testing)）。
- 視覚の回帰テストは、公式には Chromatic（Storybook のチームが作る cloud service）を使う（[Visual tests](https://storybook.js.org/docs/writing-tests/visual-testing)）。
- Vite+ の公式 docs（`guide/` の index、test、build、migrate、check、troubleshooting）に Storybook の記述はなかった（`grep -i storybook` の結果）。

実際に動かした結果（`/tmp/uicat/apps/web`。`@storybook/react-vite` と `storybook` を devDependencies に足した。pnpm が選んだ版は 10.6.3。10.6.4 は `minimumReleaseAge` より新しかった）:

- `pnpm add -D storybook @storybook/react-vite` は `ERR_PNPM_IGNORED_BUILDS: esbuild@0.28.2` で止まった。`allowBuilds` に `esbuild: true` を足す必要がある（ADR にある CI の「判断のない build script は失敗」と同じ仕組み）。
- `.storybook/main.ts` は `stories` と `framework: "@storybook/react-vite"` だけ。`storybook build --test` が 14 秒で通った。Vite は `@voidzero-dev/vite-plus-core` 1.4.0（rolldown）で、`pnpm why vite` が `@storybook/builder-vite` と `@storybook/react-vite` の依存先もこれだと示した。preview の chunk は 1,127.94 kB。`vite.config.ts` の `tanstackRouter()` plugin はそのまま読み込まれ、警告は出なかった。
- `storybook dev --ci --no-open -p 6006` は 25 秒以内に起動し、`/iframe.html` が 200、`/index.json` が story を返した。
- `@storybook/addon-vitest`、`@vitest/browser-playwright` 5.0.5、`playwright` 1.64.1、`@vitest/coverage-v8` 5.0.5 を足し、`vite.config.ts` の `test.projects` に `storybookTest({ configDir: ".storybook" })` と `playwright()`（`vite-plus/test/browser-playwright`）を書いた。`vp test run` で 2 つの story（`Button` と、Base UI の `Dialog` を開く `play` 関数付きの story）が通った（8〜13 秒）。
- 実行環境の注意: この machine は `libnspr4`/`libnss3` がなく、最初は Chromium が起動しなかった（[#124](https://github.com/yokozi-jp/agent-software-factory/issues/124) と同じ）。`apt-get download` した deb を `dpkg -x` して `LD_LIBRARY_PATH` を渡して通した。CI では `playwright install --with-deps chromium` が入れる。

### Ladle

確かめた事実:

- 最新は `@ladle/react` 5.1.1（npm、2025-11-04）。リポジトリ（[tajo/ladle](https://github.com/tajo/ladle)）の最後の commit は 2026-06-28（npm の Trusted Publishing への移行）。peer は React `>=18`。devDependencies は Vite `^8.1.0`、`@vitejs/plugin-react` `^6.0.3`。
- README に、Vitest の browser mode や axe で story をテストにする仕組みは見つからなかった。確かめていないこと: story を Vitest から import して流す書き方が公式にあるか。

### React Cosmos

確かめた事実:

- 最新は `react-cosmos` 7.4.1（npm、2026-08-31）。リポジトリ（[react-cosmos/react-cosmos](https://github.com/react-cosmos/react-cosmos)）の最後の commit は 2026-10-19。Vite は別 package（`react-cosmos-plugin-vite`）で扱う。
- 確かめていないこと: React 19 と Vite 8 と `vite-plus-core` の alias での動作、Vitest との連携。

### カタログを持たず、Vitest の browser mode だけにする

確かめた事実:

- #141 が、`@vitest/browser-playwright` 5.0.5、`playwright`、`vitest-browser-react`、`@vitest/coverage-v8` を足す方針を決めている。[#120](https://github.com/yokozi-jp/agent-software-factory/issues/120) の確認では、ローカルと GitHub Actions で component test が通り、`nx run web:test` から回り、ファイルごとの coverage の下限も効いた。CI の `playwright install --with-deps chromium` は約 23 秒。
- Vitest の `toMatchScreenshot` で視覚の回帰テストを書ける。基準の画像は `__screenshots__` に commit する。ファイル名に browser と OS が入る（`-chromium-linux.png` など）。Vitest の docs は、GPU、OS、font、headless かどうかで描画が変わるので、Docker や CI だけでの実行を勧める。テストは `*.vrt.test.ts` と別の project に分ける（[Visual Regression Testing](https://vitest.dev/guide/browser/visual-regression-testing)）。
- 削除や改名したテストの基準画像は自動で消えない（同じ docs）。

## カタログとテストの関係

確かめた事実と見立て:

- 重なり: Storybook の Vitest addon は、#141 が入れる Vitest の browser mode と Playwright の provider の上で動く。同じ依存（`@vitest/browser-playwright`、`playwright`）、同じ Chromium、同じ `vite.config.ts` の `test.projects` を使う。実際に `projects` に `storybook` 1 つを足すだけで動いた。
- 違い: story のテストは「story ファイルの `play` 関数」に書く。#141 の component test は `*.test.tsx` に `vitest-browser-react` で書く。両方を持つと、同じコンポーネントの確認が 2 か所に分かれる。どちらかに寄せるかは論点。
- #141 の「仕様を書くときに決める」項目（node の unit test とブラウザの component test を `projects` で分けるか、`coverage.thresholds.autoUpdate` が `vite.config.ts` を書き換える件）は、Storybook を足すかどうかにかかわらず先に決める必要がある。`projects` を使うことは、上の実験で動いた。
- `toMatchScreenshot` は Storybook 無しで使える。Chromatic は外部の cloud service で、料金は調べていない。このリポジトリの方針に合うかは別の論点。
- coverage: Storybook の Vitest addon は project の coverage も計算できる（[Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon)）。確かめていないこと: #138 の「ファイルごとの下限 90%」と組み合わせたときの数え方。

## 検査との相性

### CSP

確かめた事実:

- このリポジトリの docs から web の CSP の値（`connect-src 'self'` を含む）は見つからなかった。`docs/web-api/security.md` の表にあるのは API の `default-src 'none'`。Issue #226 本文の `connect-src 'self'` が前提だが、リポジトリのどこにも書かれていない。
- Base UI は、`<style>` と `<script>` を出す一部のコンポーネントに nonce か `disableStyleElements` が要る（上記）。React が `style` を設定する方法（`element.style`）は CSP の対象外。Material UI は静的配信なら `'unsafe-inline'` が要る（上記）。
- Storybook の preview は別のオリジン（dev server や `storybook-static`）で動くので、web 本体の CSP とは別になる。確かめていないこと: `storybook build` の出力を本番に配らない運用で、CSP を別に持つ必要があるか。

### XSS の lint（ADR 0019）

確かめた事実: ADR 0019 は `apps/web/src/**` に `web-xss/*` の 4 規則を適用する。shadcn の生成物（`button.tsx`、`card.tsx`、`dialog.tsx`、`dialog.stories.tsx`）は、`vp check` で指摘されなかった。`@base-ui/react` の内部には `dangerouslySetInnerHTML` があるが（`node_modules` の grep）、lint は `apps/web/src` だけが対象なので関係しない。確かめていないこと: shadcn の全コンポーネント（`chart` など）が通るか。

### Knip（ADR 0017）

確かめた事実（Knip 6.42.1、設定は `treatConfigHintsAsErrors` だけ）:

- `card.tsx` と `lib/utils.ts` を「Unused files」、`buttonVariants`、`DialogClose`、`DialogDescription`、`DialogFooter`、`DialogHeader`、`DialogOverlay`、`DialogPortal` を「Unused exports」と報告した。`button.tsx` は story から使われるので未使用に数えられなかった。
- Knip の plugin は、`apps/web` で Node.js、Oxlint、pnpm、Vite、vite-plus、Vitest が有効になった。Storybook の plugin は有効にならなかった（`knip --debug` の `Enabled plugins`）。story からの参照は、静的な import として追われた。
- shadcn は「使うものだけを入れる」運用で防げる。全部入れる運用（`shadcn add --all`）では、未使用の export が大量に出る。ADR 0017 は「`@public` を付けて理由を書く」と「例外を 1 つずつ書く」を決めているので、取り込んだ UI の export に `@public` を付けるか、`knip.jsonc` に `ignore` を足すかが論点になる（ADR 0017 は一括の `ignore` を避ける方針）。

### jscpd（ADR 0014）

確かめた事実（`jscpd` 5.4.2、`apps/web/src` だけ、`--threshold 0`、`routeTree.gen.ts` を除外。ADR 0014 の設定そのものではない）: shadcn の `button`、`card`、`dialog`、`dropdown-menu`、`popover`、`select`（9 ファイル、881 行、TSX）に重複は 0 件。生成された `index.css` の `:root` と `.dark` のテーマ変数が 1 件（7 行、5.38%）。リポジトリの `.jscpd.json` は `css` を対象にし、閾値が 0 なので、このままだと止まる見込み。確かめていないこと: 本物の設定での実行。

## 更新の追い方

確かめた事実:

- npm の依存（`@base-ui/react`、`react-aria-components`、`tailwindcss`、`storybook` など）は、catalog に入るので、ADR 0018 の Renovate が追える。
- shadcn が取り込んだコードの本体（`button.tsx` など）は npm の依存ではない。更新の確認は `shadcn add <name> --diff` を手で（または agent が）実行する。Renovate が追う仕組みは見つからなかった。確かめていないこと: Renovate に shadcn の registry を追う manager があるか。
- Base UI の API の変更は npm の更新として届く。`asChild` → `render` のような変更は取り込んだコードを直す必要がある（shadcn の skill が扱う）。

## 標準の慣行、その出典、アンチパターン

- 標準か（判断）: 2026-10 時点の React + Vite + Tailwind v4 の project で、shadcn/ui は広く使われる方式だが、「標準」と断言できる出典は見つからなかった。公式の位置づけとして確かめられたのは、shadcn の `init --template vite` が Vite を公式の template にしていること（[CLI v4](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4)）、Base UI が既定になったこと（[告知](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)）。npm の週次ダウンロード数は取っていない。
- Storybook の位置づけ（判断）: Storybook の Vitest addon が公式の推奨（[Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon)）で、Vitest 自身の docs も browser mode の component test を提供する。どちらが「デファクト」かを裏づける、2026 年の使用率の一次情報は取れなかった。
- Tailwind v4 の前提: Chrome 111、Safari 16.4、Firefox 128 以上（[Compatibility](https://tailwindcss.com/docs/compatibility)）。`docs/web-frontend/target-browsers.md` は「最新とその 1 つ前」のため、範囲内。
- アンチパターン（出典つき）:
  - 描画が環境で変わる視覚の回帰テストを、固定していない環境で流す（[Vitest](https://vitest.dev/guide/browser/visual-regression-testing)）。
  - 視覚のテストだけで振る舞いを確かめる（同じ docs）。
  - 静的配信の SPA で、MUI などの実行時の `<style>` 生成に `'unsafe-inline'` を許す（[MUI](https://mui.com/material-ui/guides/content-security-policy/)、[Base UI](https://base-ui.com/react/utils/csp-provider) は選択肢を示す）。
  - Radix に固定したまま、告知を見ずに `init` を CI で流す（[告知](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default) が `-b radix` を勧める）。
  - 取り込んだコードを `--overwrite` で上書きして、手元の変更を失う（shadcn の CLI は `--diff` を用意している）。

## docs との食い違い

- `docs/web-frontend/component-design.md` は React Aria、Radix UI、Headless UI を「ヘッドレスの例」に挙げる。shadcn/ui の位置づけ（コードを取り込む方式）と、Base UI が既定になったこと（2026-07）は書かれていない。
- `docs/web-frontend/testing.md` は「ユニットは vitest、コンポーネントは Testing Library、E2E は Playwright」と書くが、#120 と #30 の決定は Vitest の browser mode。VRT の節は「（作成予定）」。
- `docs/web-frontend/i18n.md` は `react-intl` と `react-i18next` を挙げる。React Aria Components は組み込みの文字列と `I18nProvider` を持つので、i18n の方式（#146）と両方を持つときの役割分担を決める必要がある。

## 比較表

| 観点                        | shadcn/ui（Base UI）                                | shadcn/ui（React Aria）   | React Aria Components 単体                                                                                   | Material UI                    | 自作             |
| --------------------------- | --------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------ | ---------------- |
| コードの置き場              | 自分のリポジトリ                                    | 自分のリポジトリ          | npm                                                                                                          | npm                            | 自分のリポジトリ |
| Tailwind v4                 | 標準                                                | 標準                      | data 属性か plugin                                                                                           | 標準では Emotion（CSS-in-JS）  | 自由             |
| CSP                         | 一部で nonce か `disableStyleElements`              | 未確認                    | `react-aria-components` 本体の dist に `<style>` の生成は見つからなかった（依存の `@react-aria/*` は未確認） | 静的配信では `'unsafe-inline'` | 自由             |
| i18n                        | 文字列は自前                                        | 組み込み（30 以上の言語） | 組み込み（30 以上の言語）                                                                                    | 未確認                         | 自前             |
| 更新の追い方                | npm は Renovate、取り込んだコードは `--diff` を手で | 同じ                      | npm は Renovate                                                                                              | npm は Renovate                | なし             |
| Knip                        | 未使用の export が出る                              | 同じ                      | 出ない                                                                                                       | 出ない                         | 出る             |
| bundle（Dialog 1 つ、実測） | route に +93.5 kB（gzip 33.9）                      | 未計測                    | route に +80.8 kB（gzip 26.2）                                                                               | 未計測                         | 未計測           |
| agent の書きやすさ          | MCP、skill、`shadcn docs`                           | 同じ                      | `llms.txt` と docs の md                                                                                     | 未確認                         | 低い（判断）     |

| 観点                    | Storybook 10.6                                                                                         | Ladle 5.1                              | React Cosmos 7.4              | Vitest browser mode だけ                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------- | ------------------------------------------- |
| 最新の版（日付）        | 10.6.4（2026-10-26）                                                                                   | 5.1.1（2025-11-04）                    | 7.4.1（2026-08-31）           | Vitest 5.0.5（Vite+ が固定）                |
| Vite 8 と React 19      | peer で宣言。実際に動いた                                                                              | peer は React 18 以上、dev は Vite 8.1 | 未確認                        | 動く（#120）                                |
| Vite+ の `vp`           | 動いた（公式の保証はない）                                                                             | 未確認                                 | 未確認                        | 公式（`vite-plus/test/browser-playwright`） |
| story をテストに        | Vitest addon（動いた）                                                                                 | 見つからない                           | 見つからない                  | テストが story                              |
| a11y（axe）             | addon（公式）                                                                                          | 見つからない                           | 見つからない                  | 自前で axe を呼ぶ                           |
| 視覚の回帰              | Chromatic（cloud service）か Vitest の `toMatchScreenshot`                                             | 自前                                   | 自前                          | `toMatchScreenshot`                         |
| 追加の依存と設定        | `storybook`、`@storybook/react-vite`、`@storybook/addon-vitest`、`.storybook/`、`allowBuilds: esbuild` | `@ladle/react`                         | `react-cosmos` と Vite plugin | #141 で入る依存だけ                         |
| カタログ（人が見る UI） | あり                                                                                                   | あり                                   | あり                          | なし                                        |

## 決めるべき論点

1. UI コンポーネントの方式: shadcn/ui（Base UI、Radix、React Aria のどれか）、React Aria Components 単体、完成品、自作のどれか。
2. shadcn を選ぶなら、base をどれにするか。Base UI は既定だが、CSP の `<style>`/`<script>` の扱い（nonce を使うか、`disableStyleElements` で `<style>` を止めるか）を web の配信方式（静的配信かどうか）と合わせて決める必要がある。
3. 取り込んだコードの扱い: どこに置くか（`apps/web/src/components/ui` か、`packages/ui`）、Knip の未使用の export（`@public` か、使うものだけを入れる運用か）、jscpd の CSS の重複、oxfmt での整形、`--diff` による更新の確認を誰がいつやるか。ADR 0017 と 0014 の例外の書き方に合わせる。
4. i18n（#146）との分担: React Aria の組み込みの文字列と `I18nProvider` を使うか、自前の仕組みに統一するか。
5. カタログを持つか。持つなら Storybook か、Ladle か、Cosmos か。持たないなら、Vitest の browser mode だけにして、人が見る UI は持たない。
6. 持つなら、story を Vitest で流すか（`@storybook/addon-vitest`）。流すなら、#141 の component test との役割分担（同じ確認を 2 か所に書かない）を決める。
7. 視覚の回帰テストを持つか。持つなら Chromatic か `toMatchScreenshot` か。後者なら、基準画像の OS（CI の `ubuntu-24.04` か Docker か）、`*.vrt.test.tsx` の分離、基準画像の commit の規則を決める。
8. a11y の自動検査: Storybook の a11y addon か、Vitest の中で axe を呼ぶか。`docs/web-frontend/testing.md` の「axe-core 等」「100% は目指さない」と合わせる。
9. Storybook を入れる場合の ADR 0002 との関係: Nx の target としてどう定義するか（`storybook build`、`storybook dev`、`vp test` の `storybook` project）、Vite+ の公式 docs に記述がない組み合わせを許すか。
10. #141 を先に入れるか、Storybook を先に決めるか。#141 の仕様を書くときに決める `projects` の分け方は、どちらの場合も先に必要。

## 未確認のこと

- Storybook と shadcn を、この複製ではなく、本物の `apps/web`（Nx、`vp check` の CI、ルートの `knip.jsonc`、本物の `.jscpd.json`）に入れたときの動作。複製は pnpm 11.21.0（リポジトリは 12.15.0）、`tools/` と `packages/` を持たないので、Nx の依存関係と cache への影響は見ていない。
- `storybook build` を Nx の cache に載せる入力（`.storybook/`、story、`vite.config.ts`）。
- 本物の CI（GitHub Actions）での Storybook の Vitest addon の実行時間、共有 runner での「Failed to fetch dynamically imported module」の頻度。
- shadcn の全コンポーネントが ADR 0019 の lint と ADR 0020 の型検査に通るか。2 つの状態（light/dark）の theme の CSS が jscpd の閾値を満たすか。
- shadcn の `--base aria` の実際の出力と、CSP の挙動。`@react-aria/*` の依存が `<style>`/`<script>` を出さないこと。
- Material UI、Ladle、React Cosmos の実際の動作（Vite+ の alias、React 19、bundle の大きさ）。
- web の本番の CSP の値と配信方式（`connect-src 'self'` の出どころ）。`docs/web-frontend/hosting.md` と ADR 0013 は読んでいない。
- Renovate で shadcn の取り込んだコードの更新を追う方法。
- Storybook の最新の版が今日公開され（10.6.4）、`minimumReleaseAge` より新しいので、導入するなら 10.6.3 になる。
- 各ツールの使用率（2026 年の「デファクト」の数字）。npm の週次ダウンロード数は取っていない。

## 出典

- shadcn/ui: [Introduction](https://ui.shadcn.com/docs)、[CLI](https://ui.shadcn.com/docs/cli)、[MCP Server](https://ui.shadcn.com/docs/mcp)、[Registry](https://ui.shadcn.com/docs/registry)、[Skills](https://ui.shadcn.com/docs/skills)、[Vite](https://ui.shadcn.com/docs/installation/vite)、changelog の [Base UI as the Default](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)、[React Aria](https://ui.shadcn.com/docs/changelog/2026-07-react-aria)、[cn](https://ui.shadcn.com/docs/changelog/2026-09-cn)、[shadcn eject](https://ui.shadcn.com/docs/changelog/2026-05-shadcn-eject)、[CLI v4](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4)。ソースは [shadcn-ui/ui](https://github.com/shadcn-ui/ui/tree/8f04138777c1b6996e709993362a7b0a12888ecf)（`apps/v4/content/docs`、`packages/shadcn/src/mcp/index.ts`）。
- Base UI: [CSP Provider](https://base-ui.com/react/utils/csp-provider)、[`@base-ui/react`](https://www.npmjs.com/package/@base-ui/react)。
- React Aria: [Styling](https://react-aria.adobe.com/styling)、[Quality](https://react-aria.adobe.com/quality)、[I18nProvider](https://react-aria.adobe.com/I18nProvider)、[Testing](https://react-aria.adobe.com/testing)、[llms.txt](https://react-aria.adobe.com/llms.txt)、[`react-aria-components`](https://www.npmjs.com/package/react-aria-components)。
- Material UI: [Content Security Policy](https://mui.com/material-ui/guides/content-security-policy/)、[`@mui/material`](https://www.npmjs.com/package/@mui/material)。
- Tailwind CSS: [Compatibility](https://tailwindcss.com/docs/compatibility)、[`tailwindcss`](https://www.npmjs.com/package/tailwindcss)。
- Storybook: [Install](https://storybook.js.org/docs/get-started/install)、[Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon)、[Accessibility testing](https://storybook.js.org/docs/writing-tests/accessibility-testing)、[Visual tests](https://storybook.js.org/docs/writing-tests/visual-testing)、[storybookjs/storybook](https://github.com/storybookjs/storybook)（`eeeb753`）、[`storybook`](https://www.npmjs.com/package/storybook)、[`@storybook/react-vite`](https://www.npmjs.com/package/@storybook/react-vite)、[`@storybook/addon-vitest`](https://www.npmjs.com/package/@storybook/addon-vitest)。
- Ladle と Cosmos: [tajo/ladle](https://github.com/tajo/ladle)、[`@ladle/react`](https://www.npmjs.com/package/@ladle/react)、[react-cosmos/react-cosmos](https://github.com/react-cosmos/react-cosmos)、[`react-cosmos`](https://www.npmjs.com/package/react-cosmos)。
- Vitest と Vite+: [Visual Regression Testing](https://vitest.dev/guide/browser/visual-regression-testing)、Vite+ の [Test](https://github.com/voidzero-dev/vite-plus/blob/main/docs/guide/test.md)、[Migrate](https://github.com/voidzero-dev/vite-plus/blob/main/docs/guide/migrate.md)。
- このリポジトリ: ADR 0002、0014、0017、0018、0019、0020、`docs/web-frontend/component-design.md`、`testing.md`、`i18n.md`、`target-browsers.md`、`docs/web-api/security.md`、Issue [#120](https://github.com/yokozi-jp/agent-software-factory/issues/120)、[#141](https://github.com/yokozi-jp/agent-software-factory/issues/141)、[#146](https://github.com/yokozi-jp/agent-software-factory/issues/146)、[#226](https://github.com/yokozi-jp/agent-software-factory/issues/226)。
