---
type: Convention
title: "Webフロントエンドの静的解析"
description: "静的解析の目的、種類、取り組み方、導入時の考慮事項と、このリポジトリで XSS の入口になる書き方を lint で禁止する一覧、React と JSX のアクセシビリティの検査を定める文書。型チェック・Linter・フォーマッターを導入・運用するとき、lint で止まった書き方を直すとき、禁止を外す理由を書くときに読む。"
tags: [web-frontend, convention, static-analysis, lint]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forWebFrontend/web_frontend_guidelines.html
    title: Webフロントエンド設計ガイドライン
    author: フューチャー株式会社
---

# Webフロントエンドの静的解析

静的解析は品質・均質化・方針の明文化のために行い、人の運用ではなく仕組みで担保する。
環境はプロジェクト初期に構築し、Linter ルールは段階的に導入・見直す。導入時は開発体験と合意形成に配慮する。
出典は [Webフロントエンド設計ガイドライン](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

静的解析とは、プログラムの実行を伴わずにソースコードを解析し、潜在的な問題や構文・スタイルの不備を検出する手法である。主に以下のようなツールが該当する。

- 型チェック（Webフロントエンド開発においては TypeScript など）
- Linter（コードスタイルや構文エラーの検出）
- フォーマッター（コード整形）

## なぜ静的解析を行うのか

静的解析を導入する目的は、主に以下の3点である。

- 品質の担保
- コードの均質化
- 開発・構成方針の明文化

ルールに依存した運用では、周知不足やミスにより、ルールの守られないケースが発生しやすい。このようなヒューマンエラーを防ぐには、ルールではなく仕組みによって担保することが効果的である。

静的解析を活用すれば、コードのチェックや適用を自動化できるため、属人性を排除し、安定した開発プロセスを実現できる。例えば、import の順序やパスの書き方といったコード構成のルールも、静的解析を通じて明文化が可能となる。さらにCI（継続的インテグレーション）と連携し、Pull Request 作成時に静的解析を GitHub Actions などで自動実行して、問題が検出された場合はマージをブロックする運用も可能である。

このように、人の運用に頼るのではなく仕組みによって品質と一貫性を維持する体制を構築することは、長期的に見て保守性の高いコードベースの実現や、技術的負債の蓄積の抑制につながる。

## Webフロントエンドにおける静的解析の種類

Webフロントエンド開発における静的解析の主な手法や技術要素は以下のとおりである。

- **型チェック**
  - 型に起因するエラーを未然に防ぐ
  - 例
    - TypeScript による型安全の担保。このリポジトリでは `vp check` が tsgolint で型チェックも行う
- **Linter**
  - コード規約に基づいたチェックを行い、一貫性のあるコードを保つ
  - 例
    - JavaScript/TypeScript: Vite+ の `vp lint` (Oxlint)。ルールはルートの `vite.config.ts` の `lint` に書く
    - CSS: `Stylelint` など
    - その他、JSON・YAML・Markdown 等の周辺ファイルにも各種 Linter が存在 (このリポジトリの Markdown は `markdownlint-cli2`)
- **フォーマッター**
  - コードスタイルを自動整形し、見た目の統一と差分の削減を図る
  - 例
    - Vite+ の `vp fmt` (Oxfmt) による自動整形。`vp check` が整形、lint、型チェックをまとめて実行する
- **補助的ツール**
  - 静的解析を補完し、コードの変更時に自動でチェックを行う仕組みや、プロジェクトの構成・依存関係の健全性を維持する仕組みを提供する
  - 例
    - コミットフックによる自動実行: `lefthook` で、コミット時にステージしたファイルへ `vp check --fix` を実行する ([Git hook](../tooling/git-hooks.md))
    - 依存パッケージの健全性チェック: `knip` `depcheck` などを用いた、未使用or未インストールの依存パッケージの検出
    - 依存関係の可視化: `madge` などを用いた、ファイル間の依存関係の視覚的な表示

## XSS の入口になる書き方の禁止

このリポジトリの `apps/web/src` では、XSS の入口になる書き方を Linter で禁止している。`vp check` (pre-commit と CI) で止まる。
Oxlint の組み込みの `no-eval`、`no-new-func`、`no-script-url` などは、メッセージを指定できず、「代わりに何を書くか」を載せられない。そのため、規則は `tools/lint-plugins/src/xss-plugin.ts` の自作の plugin に置き、ルートの `vite.config.ts` の `lint.overrides` で有効にしている。

| 規則                                | 禁止する書き方                                                                                                                                           | 理由                                                                            | 代わりの書き方                                                                                     |
| :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------- |
| `web-xss/no-html-injection`         | `dangerouslySetInnerHTML` (JSX の属性と、`createElement` に渡すオブジェクト)、`innerHTML` / `outerHTML` への代入、`insertAdjacentHTML`、`document.write` | 渡した文字列を HTML として解釈するため、利用者の入力が混ざるとスクリプトが動く  | React の要素で描画する。`textContent` を使う。制御できない HTML を出すなら、サニタイズしてから渡す |
| `web-xss/no-javascript-url`         | `javascript:` で始まる文字列 (前の空白と大文字小文字は無視する)                                                                                          | リンクを辿ったときにコードが動く。React 19 は `javascript:` の URL を禁じている | 操作は `onClick` に書く。移動は実際の URL にする                                                   |
| `web-xss/no-dynamic-code`           | `eval`、`new Function`、`Function()` (`window.eval` や `(0, eval)()` を含む)、文字列を渡した `setTimeout` / `setInterval`                                | 文字列をコードとして実行するため、利用者の入力が混ざるとスクリプトが動く        | 関数を直接呼ぶ。データは `JSON.parse` で読む                                                       |
| `web-xss/require-disable-reason`    | 理由のない disable コメント (`// oxlint-disable-next-line <規則名>` だけ)                                                                                | 検出を隠しても、なぜ安全かが残らない                                            | `--` に続けて理由を足す                                                                            |
| `unicorn/no-abusive-eslint-disable` | 規則名のない disable コメント (`/* oxlint-disable */`)                                                                                                   | 対象の規則だけでなく、そのファイルの検出を一括で隠してしまう                    | 規則名を書く                                                                                       |

どの規則も、リンタが静的に分かる範囲だけを見る。次は見つけられない。

- 変数に入れた文字列 (`const code = "..."; setTimeout(code)`) と、`${}` を含むテンプレートリテラルや `+` で組んだ `javascript:` の URL
- `el[name] = html` のように名前が動的な代入と、`Object.assign(el, { innerHTML })`、`el.setHTMLUnsafe()`
- 別名や型の変換を通した `eval` と `Function` (`const e = eval; e()`、`(window as any).eval()`)
- HTML の文字参照で書いた `javascript:` (`&#106;avascript:`)
- `document` 以外の名前を付けた変数への `write` (`d.write(html)`)

また、`web-xss/require-disable-reason` を同じファイルの disable コメントで止められる。レビューで disable コメントの差分を見る。
サニタイズや CSP の代わりにはならず、入口の書き方を減らす補助である。web の CSP はこの規則の対象に入れていない。

禁止を外すときは、その行に規則名と理由を書く。理由がないと `web-xss/require-disable-reason` が止める (理由の中身までは見ない)。禁止の規則を外すときは、組み込みの `no-eval` ではなく `web-xss/` の規則名を書く。

```ts
// oxlint-disable-next-line web-xss/no-html-injection -- 管理者が書いた HTML を DOMPurify で処理した結果
const view = <div dangerouslySetInnerHTML={{ __html: sanitized }} />;
```

規則の動きは `tools/lint-plugins/src/xss-plugin.test.ts` が、禁止の書き方と通す書き方の例で確かめる。`vp test` (Nx の `lint-plugins:test`) で動く。

> [!NOTE]
> **参考**
>
> - [React: dangerouslySetInnerHTML](https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html)
> - [React 19 Upgrade Guide: `javascript:` URL の廃止](https://react.dev/blog/2024/04/25/react-19-upgrade-guide#other-breaking-changes)
> - [Writing JS plugins | Oxlint](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html)
> - [Vite+ Lint: Writing Your Own Rules](https://github.com/voidzero-dev/vite-plus/blob/main/docs/guide/lint.md)

## React と JSX のアクセシビリティの検査

`apps/web/src` では、Oxlint の `react` と `jsx-a11y` の plugin を有効にしている。ルートの `vite.config.ts` の `lint.overrides` に `plugins: ["react", "jsx-a11y"]` を置くだけで、plugin の既定の規則が動く。`vp check` (pre-commit と CI) で止まる。Oxlint の既定ではどちらも無効なので、plugin を足さない限り、次のような書き方は検出されない。

- `alt` のない `img` (`jsx-a11y/alt-text`)
- 無効な `href` の `a` (`jsx-a11y/anchor-is-valid`)
- キーボードの操作を持たないクリック (`jsx-a11y/click-events-have-key-events`)
- role のない要素へのイベント (`jsx-a11y/no-static-element-interactions`)
- 依存配列のない `useEffect` (`react-hooks/exhaustive-deps`)

既定の規則に次を足している。

- 配列の添字を key にする `key={index}` (`react/no-array-index-key`)。既定では無効なので、`error` にしている
- 要らない effect。[`eslint-plugin-react-you-might-not-need-an-effect`](https://github.com/nickjvandyke/eslint-plugin-react-you-might-not-need-an-effect) 1.0.2 を `jsPlugins` に `react-effect` の名前で読み込み、9 つの規則 (`react-effect/no-derived-state`、`no-chain-state-updates`、`no-event-handler`、`no-adjust-state-on-prop-change`、`no-reset-all-state-on-prop-change`、`no-pass-live-state-to-parent`、`no-pass-data-to-parent`、`no-external-store-subscription`、`no-initialize-state`) を `error` にしている。props から導出できる値を effect で state に入れる書き方は `react-effect/no-derived-state` が止め、render の中で計算するよう伝える。版は `pnpm-workspace.yaml` の catalog で固定している
- `react/set-state-in-effect` は `off` にしている ([Issue #261](https://github.com/yokozi-jp/agent-software-factory/issues/261))。`react-effect/no-derived-state` と同じ行を報告し、二重になるため。内蔵の規則は、effect の中で同期して呼ぶ `setState` をすべて報告し、help に一般的な直し方を書くが、「導出できる値」とは言わない。外したので、上の規則のどれにも当たらない形の `setState` (例: `setCount(count + 1)`) は止まらなくなった

見つけられるのは、コードに書かれた形から静的に分かる範囲だけである。次の書き方は止まらない。effect の中の `fetch`、event handler でしか使わない state、`setCount(count + 1)`。調査 ([Issue #253](https://github.com/yokozi-jp/agent-software-factory/issues/253)) で、これらを止める既製の ESLint plugin は見つからなかった。対応は決めておらず、画面ができて実害が出てから決める ([Issue #261](https://github.com/yokozi-jp/agent-software-factory/issues/261) の範囲外)。色のコントラスト、フォーカスの順序、読み上げの実際の挙動も見つからない。それらは axe-core を使うコンポーネントテストと E2E で確かめる ([テスト](testing.md))。

禁止を外すときは、その行に規則名と理由を書く (`oxlint-disable-next-line <plugin>/<規則名> -- <理由>`)。
規則が外れていないことは `apps/web/src/__fixtures__/react.tsx` が確かめる。規則ごとに、違反の行へ理由つきの disable コメントを付けてあり、規則が外れるとコメントが使われなくなり、`vp check` が失敗する。

## 取り組み方

静的解析の環境は、なるべくプロジェクトの初期段階で構築すべきである。後から導入する場合、既存のコード全体に多数のエラーが検出され、導入のハードルが高くなるため。

ただし、すでに運用中のプロジェクトであっても、対象範囲を限定しながら部分的に適用し、徐々に広げていく段階的な導入で着実に改善できる。

また、Linter や フォーマッター の設定は最初に一度決めて終わりではない。プロジェクトの成長や技術スタックの変化に応じて、ルールを定期的に見直し、最適化していくことが重要である。

> [!WARNING]
> **Linterの漸進的導入への注意**
>
> コードベースとしてあるべきだからといって、Linterのルールをどんどん追加すると、アプリケーションを開発するメンバーが困ってしまうことも多い。コードベースを健全に保ち、保守運用性を高めるためには必要な措置だが、闇雲に導入すると 「作業予定に見込んでいなかった」　「Linter対応工数はどこ？」などという反応をされ、下手をすると関係が険悪になるし、コメントでLinter検出を無視するような運用がなされてしまっても本末転倒である。そのため、途中でLinterルールを変更・追加する場合は以下のような戦略を考えておくとよい。
>
> - fixable なものはアーキチーム側で一括適用する
> - fixable でなくても、コード品質が向上し、レビュー負荷が軽減するのであれば導入するが、そうでないものは必ずしも追加しない
> - 既存の検知項目が多く、対応が難しい場合は、いったん disabled で無視し、新規分のみに適用する
> - アーキチーム側で修正できるものは修正する（Linter設定を変更しておしまいではなく、責任を共有する）
>   - ただし、最低限の動作確認は必要であるため、アプリチーム側と協力体制を組む
> - アドホックにLinterを追加すると、作業計画・要員計画が難しくなるため、定期的にLinter設定を見直すような予定を、PJ計画に組み込んでおく
>   - 例えば、四半期に1回ペースで見直しや、先行開発の前後・PG開始前・JT開始前など
>   - 同時に、基本的にアーキチーム側で自動テストまでは修正するが、最終的な動作確認などはアプリチーム側と相談の上実施するといったルールを明文化しておく
>
> なお、開発規模が小さく "アーキチーム" といった役割分担が無い場合はここまで深く考える必要は無い。

## 導入時の考慮事項と注意点

静的解析を導入する際には、利便性と影響の両面から慎重に検討する必要がある。以下の観点を踏まえ、チームの合意形成と運用設計を行うことが望ましい。

- **開発体験への影響:** 実行速度が遅かったり、実装スタイルに合わないルールがあると、開発効率の低下を招く可能性がある。エディタ上でリアルタイムにフィードバックが得られるかどうかも重要な要素である
- **ルール設計と合意形成:** チームのスキルセットや開発方針に合わないルールを定めてしまうと、かえって開発効率を損なう可能性がある。考え方の違いが出やすい領域であるため、目的とルールを共有し、チーム全体で納得してから運用することが重要である
- **設定の分かりやすさと運用のしやすさ:** 設定が複雑になると属人化しやすく、メンテナンスが困難になる。なるべくシンプルで納得しやすい設定にすることが望ましい。ツール推奨のルールセットや世の中で広く使われているルールセットを利用することを基本とし、その上で必要に応じて微調整する形で進める
