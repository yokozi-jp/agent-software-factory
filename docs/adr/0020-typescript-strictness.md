---
type: ADR
title: "ADR 0020: TypeScript の型検査は vp check だけを正とし、tsconfig はルートに置いて noUncheckedIndexedAccess と exactOptionalPropertyTypes まで厳しくする"
description: 型検査の正を vp check の typeCheck (tsgolint) だけにし、共通の厳しさをルートの tsconfig.json に置く決定。strict に加えて noUncheckedIndexedAccess と exactOptionalPropertyTypes などを有効にし、Oxlint は警告でも失敗させて、型エラーを黙らせる any、非 null 表明、絞り込みの as、ts-ignore を止める。tsconfig のフラグや Oxlint の型情報を使う規則を足す、外すとき、型の規則で止まったとき、tsc --noEmit を足したくなったときに読む。
tags: [adr, tooling, typescript, oxlint, tsgolint, quality]
---

# ADR 0020: TypeScript の型検査は vp check だけを正とし、tsconfig はルートに置いて noUncheckedIndexedAccess と exactOptionalPropertyTypes まで厳しくする

型検査の厳しさは、各 app の tsconfig に書いた `strict` だけでした。Oxlint の型情報を使う規則は既定の `correctness` だけで、これは警告です。`vp check` は警告だけなら終了コード 0 なので、`no-floating-promises` が出ても CI は通っていました。エージェントが書くコードは、型エラーを `any`、`!`、`as`、`@ts-ignore` で黙らせやすいので、その抜け道を検査で止めます。決めた経緯は [Issue #45](https://github.com/yokozi-jp/agent-software-factory/issues/45) にあります。

- **型検査の正**: `vp check` (Oxlint の `typeAware` と `typeCheck`、tsgolint) だけです。`tsc --noEmit` は足しません。tsgolint は tsconfig のオプションを読み、違反を `TS2322` や `TS2375` として報告します。2026-10-24 に、違反を入れた一時ファイルで `vp check` を実行して確かめました。Oxlint の docs も、`typeCheck` は `tsc --noEmit` の代わりになると説明しています ([Type-Aware Linting](https://oxc.rs/docs/guide/usage/linter/type-aware.html))。
- **tsconfig の置き場**: 型の厳しさはルートの `tsconfig.json` に置きます。各 app の tsconfig には、実行環境の設定 (`target`、`lib`、`types`、`jsx`、`module`) だけを残します。プロジェクトが増えても、厳しさが 1 か所で決まります。`strict` は TypeScript 6.0 から既定で true ですが ([TypeScript 6.0 のリリースノート](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html))、明示して残します。
- **有効にするフラグ**: `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`、`noImplicitReturns`、`noFallthroughCasesInSwitch`、`allowUnreachableCode: false`、`allowUnusedLabels: false`、`erasableSyntaxOnly`、`verbatimModuleSyntax`、`skipLibCheck` です。`erasableSyntaxOnly` は、実行時の意味を持つ構文 (`enum`、実行時のコードを持つ `namespace`、constructor の parameter property など) を禁止し、型を消すだけで Node.js の型除去 (type stripping) が動く形を保ちます ([TSConfig Reference](https://www.typescriptlang.org/tsconfig/)、[Node.js の TypeScript](https://nodejs.org/api/typescript.html))。
- **有効にしないフラグ**: `noUnusedLocals` と `noUnusedParameters` は、Oxlint の `no-unused-vars` と重複するので有効にしません。`noPropertyAccessFromIndexSignature` は、`process.env.PORT` のような書き方まで `["PORT"]` に変えさせる割に、`noUncheckedIndexedAccess` で未定義の扱いが守られるので得るものが小さく、有効にしません (判断)。
- **Oxlint の警告**: `lint.options` に `denyWarnings: true` と `reportUnusedDisableDirectives: "error"` を置きます。警告も失敗にし、不要になった disable コメントも失敗にします (`--deny-warnings` と同じ意味です。[Oxlint の CLI](https://oxc.rs/docs/guide/usage/linter/cli.html))。呼び出し側 (package の script、lefthook、CI) ごとに `--deny-warnings` を付けるより、`vite.config.ts` の 1 か所で済みます。
- **型情報を使う規則**: typescript-eslint の `recommended-type-checked` ([設定の一覧](https://typescript-eslint.io/users/configs/)、[規則の定義](https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/eslint-plugin/src/configs/flat/recommended-type-checked.ts)) のうち Oxlint の既定にないものを `error` にし (`vite.config.ts` の `typedRules` に一覧があります)、`strict-type-checked` のうち次の 3 つを足します。
  - `switch-exhaustiveness-check`: 状態遷移の分岐漏れを防ぎます。
  - `no-non-null-assertion`: `!` を禁止します。
  - `no-unsafe-type-assertion`: 絞り込みの `as` を禁止し、境界では検証して型を得る形に寄せます。

  `ban-ts-comment` は `@ts-ignore` を禁止し、`@ts-expect-error` は説明を付けたものだけ許します。型注釈も型情報もない JavaScript (`scripts/*.mjs`) には、これらの規則を適用しません。`no-explicit-any` と `ban-ts-comment` は JavaScript では何も報告せず、`no-unsafe-*` は import の型が解決できないので、導入時に `scripts/*.mjs` の3ファイルだけで約240件の報告が出ました。

- **抜け道**: テストにも本体と同じ規則をかけます。緩和は、摩擦が実際に出てから足します。`oxlint-disable` は許します。理由の記述は、`apps/web/src` では自作の `web-xss/require-disable-reason` ([ADR 0019](0019-custom-oxlint-plugin-for-xss.md)) が止めますが、それ以外には機械で止める規則がなく、レビューで見ます。

## Considered Options

- **`exactOptionalPropertyTypes` を有効にしない**: 最初はこちらを選びました。`string | undefined` を任意の props や `RequestInit` に渡す書き方が通らなくなり、エージェントが条件付きスプレッドや `as` で逃げると考えたためです。`as`、`!`、`@ts-ignore` は上の規則で止まり、条件付きスプレッドはこの設定での正しい書き方なので、外す理由がなくなりました。有効にする利点は、`{ ...defaults, ...options }` で明示的な `undefined` が既定値を上書きするバグを型で止められることです。後から有効にするほうが、最初から有効にするより費用が大きい点も判断に入れました (判断)。
- **`strict-type-checked` を基準にする**: typescript-eslint は、TypeScript に習熟した開発者が多いプロジェクトだけに勧め、規則の追加や変更が semver の対象でないと説明しています ([設定の一覧](https://typescript-eslint.io/users/configs/))。基準は `recommended-type-checked` にし、必要な 3 つだけを足しました。
- **`tsc --noEmit` も併用する**: 検査が二重になります。ただし Oxlint の設定スキーマ (oxlint パッケージの `configuration_schema.json` の `OxlintOptions.typeCheck`) は `typeCheck` を experimental と書いています。tsgolint が不安定になったら、併用を見直します。
- **`categories: { correctness: "error" }` にする**: `correctness` の規則だけが失敗になり、あとから警告で足す規則を扱えません。`denyWarnings` なら、警告にした規則もすべて失敗です。
- **`@tsconfig/strictest` を丸ごと使う**: `noUnusedLocals`、`noUnusedParameters` が Oxlint と重複し、`noPropertyAccessFromIndexSignature` は `process.env.PORT` のような書き方まで `["PORT"]` に変えさせます。得るものに比べて費用が大きいので、フラグを個別に選びました。これは判断です。

## Consequences

- 標準との関係: [`@tsconfig/strictest`](https://github.com/tsconfig/bases/blob/main/bases/strictest.json) は、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`、`noImplicitReturns`、`noFallthroughCasesInSwitch`、`allowUnreachableCode: false`、`allowUnusedLabels: false` を入れています。`erasableSyntaxOnly` と `verbatimModuleSyntax` は入れていません。`noUnused*` と `noPropertyAccessFromIndexSignature` は入れていますが、このリポジトリでは採りません。[create-vite の React テンプレート](https://github.com/vitejs/vite/blob/main/packages/create-vite/template-react-ts/tsconfig.app.json)が入れるのは `noUnusedLocals`、`noUnusedParameters`、`erasableSyntaxOnly`、`noFallthroughCasesInSwitch` です。この組み合わせは標準そのものではなく、判断を含みます。
- 導入時に、`apps/web/lint/xss-plugin.ts` の `any` を Oxlint の plugin API の型 (`ESTree`) に直し、テストの `plugin.rules[...]` に未定義の確認を足し、`commitlint.config.ts` の不要な `async` を外しました。
- 警告が失敗になるので、警告のまま残す規則は作れません。外したい規則は、規則ごとに `off` にします。
- 規則を足す、外すときは、`vite.config.ts` の `typedRules` を直します。tsconfig のフラグは、ルートの `tsconfig.json` を直します。どちらも Nx の cache の入力です (`nx.json` の `sharedGlobals`)。
- `oxlint-disable` の理由を `apps/web/src` の外でも機械で止めたくなったら、`web-xss/require-disable-reason` を `apps/web` の外にも広げるか、同じ形の plugin を足します。
