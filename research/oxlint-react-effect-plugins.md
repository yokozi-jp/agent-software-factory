# state と effect の癖を止める既製の ESLint plugin が Oxlint の jsPlugins で動くかを調べる

## 問い

[Issue #253](https://github.com/yokozi-jp/agent-software-factory/issues/253) の調査。結果は [react-doctor を web の検査に足すかを決める (#225)](https://github.com/yokozi-jp/agent-software-factory/issues/225) の材料にする。決定はしない。

- `eslint-plugin-react-you-might-not-need-an-effect` (以下 YMNNE) の規則と、次の 4 つの癖のどれを止めるか。
  1. 導出できる値を state に置く (props から `useEffect` + `setState`)。
  2. effect 内の `fetch`。
  3. 古い値を読む `setState` (`setCount(count + 1)`)。
  4. handler でしか使わない state。
- 同じ目的の plugin (`eslint-plugin-react-hooks` の React Compiler 規則、`@eslint-react/eslint-plugin`) を同じ表に並べる。
- Oxlint の `jsPlugins` で動くか。動かないなら理由。
- ライセンス、保守の状態、版の固定、通信の有無。
- 今の Oxlint の `react` と `jsx-a11y` ([#239](https://github.com/yokozi-jp/agent-software-factory/issues/239))、ADR 0019 の `web-xss`、ADR 0020 の型の規則との重複、メッセージが直し方を書けるか。
- 標本での検出数と誤検出。

調べた日は 2026-10-28。対象の版は次のとおり (すべて npm の `latest`)。

| 対象                                                                      | 版     | 公開日     |
| ------------------------------------------------------------------------- | ------ | ---------- |
| `eslint-plugin-react-you-might-not-need-an-effect`                        | 1.0.2  | 2026-08-20 |
| `eslint-plugin-react-hooks`                                               | 7.1.1  | 2026-04-17 |
| `@eslint-react/eslint-plugin` (と `eslint-plugin-react-x` / `-react-dom`) | 5.28.8 | 2026-10-27 |

比較の参考に、react-doctor の調査 (ブランチ `research/react-doctor` の `research/react-doctor.md`) で使った `oxlint-plugin-react-doctor@0.9.18` も同じ標本に当てた。

実際に動かした環境は次のとおり。worktree には node_modules も生成物も残していない。

- `/tmp/oxp`: リポジトリのルートの `vite.config.ts` (main の 9a736b0) と `apps/web/lint` を複製し、`vite-plus@1.4.0` と上の 3 つの plugin を npm で入れた。TypeScript は pnpm の catalog と同じ `7.0.2`。Node.js 24.22.1。`vp lint` 1.4.0 が同梱する Oxlint は 1.89.0 (`oxlint --version`)。
- `/tmp/oxp2`: `@eslint-react` 系だけを試すための別の環境。TypeScript を `5.9.3` にした (理由は後述)。Oxlint は `oxlint@1.89.0`。
- 標本: `sample.tsx` (7 つの component、下の表)、`legit.tsx` (React の docs が「effect でよい」とする書き方と、正当な書き方を並べたもの)。どちらも `/tmp` に書いた。`apps/web/src` の既存の tsx にも当てた。
- 通信の記録: `unshare -rn` (外へ出る経路のない network namespace) の中で動かし、さらに `NODE_OPTIONS=--require` で `net.Socket.connect`、`dns.lookup`、`fetch`、`http(s).request` を記録する hook を差した。

## 要約

確かめた事実:

- YMNNE は 9 つの規則を持ち、4 つの癖のうち 1 だけを止める。`sample.tsx` の導出 state を `no-derived-state` が見つけ、メッセージは直し方 (「render の中で計算する」) を書く。2、3、4 は止めない。
- 4 つの癖すべてを止めた plugin は、比較した中では `oxlint-plugin-react-doctor` だけ (`no-fetch-in-effect`、`rerender-functional-setstate`、`rerender-state-only-in-handlers`)。ただし `setCount(count + 1)` は effect の中でだけ見つかり、handler の中の同じ書き方は見つからなかった。
- Oxlint の `jsPlugins` で動いた: YMNNE 1.0.2 (Oxlint 1.89.0 の単体と、`vp lint` 1.4.0 のどちらも)、`eslint-plugin-react-hooks` 7.1.1 (単体)。
- 動かなかった: `eslint-plugin-react-x` 5.28.8 (`@eslint-react/eslint-plugin` の本体)。このリポジトリの TypeScript 7.0.2 では、読み込みの時点で `TypeError: Cannot read properties of undefined (reading 'Intrinsic')` になる。原因は依存の `ts-api-utils` が JS の TypeScript API (`ts.TypeFlags`) を使うこと。TypeScript 7 の package は JS の API を出さない。TypeScript 5.9.3 に替えると動く。
- 通信: 4 つの plugin とも、`unshare -rn` の中で完走した。hook は Oxlint が起こす Node.js の子プロセスに読み込まれたが、通信の記録は 0 件。
- 誤検出: `legit.tsx` の 6 つの書き方に対し、YMNNE は 1 件 (子から親へ state を effect で渡す `Child`)。`apps/web/src` の既存の tsx は 0 件。
- 重複: 今の `apps/web/src` は Oxlint の `react` と `jsx-a11y` を有効にしており、`react/set-state-in-effect` と `react-hooks/exhaustive-deps` が `sample.tsx` で動く。YMNNE の `no-derived-state` は、`react/set-state-in-effect` と同じ箇所を指す。`web-xss` と重なる YMNNE の規則はない。

判断 (推測を含む):

- YMNNE は「導出 state」の指摘を、直し方つきのメッセージにする点でだけ、今の検査に足される。指摘の位置は今の `react/set-state-in-effect` と同じ行になるため、同じ書き方が 2 回報告される。
- 4 つの癖を既製の ESLint plugin だけで埋めることはできない。2 と 4 を止める既製品は react-doctor の規則のほかに見つからなかった。
- `@eslint-react` は TypeScript 7 の環境では使えない。TypeScript の版を変えるか、このリポジトリの方針 (ADR 0020 は tsgolint を正とする) と合わせる判断が要る。

## 1. 規則の一覧と、4 つの癖への対応

### YMNNE の規則 (事実)

`eslint-plugin-react-you-might-not-need-an-effect@1.0.2` の `rules` を列挙した (9 つ)。説明は規則の `meta.docs.description`、README の見出し。

| 規則                                | 止めるもの                                           | 4 つの癖        |
| ----------------------------------- | ---------------------------------------------------- | --------------- |
| `no-derived-state`                  | effect で導出できる値を state に入れる               | 1               |
| `no-chain-state-updates`            | effect で state を連鎖して更新する                   | (1 に近い)      |
| `no-event-handler`                  | state と effect を event handler の代わりに使う      | なし            |
| `no-adjust-state-on-prop-change`    | prop が変わったとき effect で state を調整する       | (1 に近い)      |
| `no-reset-all-state-on-prop-change` | prop が変わったとき effect で全 state をリセットする | なし            |
| `no-pass-live-state-to-parent`      | effect で live な state を親へ渡す                   | なし            |
| `no-pass-data-to-parent`            | effect で取得したデータを親へ渡す                    | 2 の一部 (後述) |
| `no-external-store-subscription`    | effect で外部 store を購読する                       | なし            |
| `no-initialize-state`               | effect で state を初期化する                         | なし            |

- 「effect 内の `fetch`」を直接止める規則はない。`no-pass-data-to-parent` は、取得したデータを親の callback へ渡す形だけを見る。`sample.tsx` の `B` (`fetch` して自分の state に入れる) は見つからなかった。
- 「古い値を読む `setState`」(3) と「handler でしか使わない state」(4) を止める規則はない。
- README は `eslint-plugin-react-hooks/exhaustive-deps` と `typescript-eslint/no-floating-promises` を併用すると解析が正確になると書く。このリポジトリは両方とも有効にしている (`react-hooks/exhaustive-deps` は `react` plugin の既定、`typescript/no-floating-promises` は ADR 0020 の型の規則)。
- 出典: [README](https://github.com/nickjvandyke/eslint-plugin-react-you-might-not-need-an-effect/blob/main/README.md)、npm の package の `dist/index.mjs`。

### ほかの plugin の関連する規則 (事実)

規則の数と名前は、入れた package の `rules` を列挙した。

- `eslint-plugin-react-hooks@7.1.1`: 29 の規則 (React Compiler の検査を含む)。関連するのは `set-state-in-effect`、`no-deriving-state-in-effects`、`exhaustive-deps`、`set-state-in-render`、`purity`、`refs`、`immutability`。
- `eslint-plugin-react-x@5.28.8`: 53 の規則。関連するのは `set-state-in-effect`、`no-array-index-key`、`exhaustive-deps`、`use-state`、`no-missing-key`、`no-unstable-default-props`。`no-unused-state` と `no-access-state-in-setstate` は名前のとおり class component 用。「導出 state」「fetch」「handler でしか使わない state」の名前の規則はない。
- `eslint-plugin-react-dom@5.28.8`: 16 の規則。`no-dangerously-set-innerhtml`、`no-script-url` など。`web-xss` と同じ領域。
- `oxlint-plugin-react-doctor@0.9.18` (参考): `no-derived-state`、`no-fetch-in-effect`、`rerender-functional-setstate`、`rerender-state-only-in-handlers`、`no-array-index-as-key` ほか。

### 標本での検出 (実測)

標本 `sample.tsx` の 7 つの component に対する検出 (Oxlint 1.89.0)。「✓」は見つかった、「—」は見つからなかった、括弧は規則名。

| 癖 (標本)                                     | Oxlint の `react` (今の設定)     | `react-hooks` 7.1.1                                       | YMNNE 1.0.2            | `react-x` 5.28.8 (TS 5.9) | react-doctor 0.9.18 (参考)            |
| --------------------------------------------- | -------------------------------- | --------------------------------------------------------- | ---------------------- | ------------------------- | ------------------------------------- |
| 1. 導出 state (`A`)                           | ✓ (`set-state-in-effect`)        | ✓ (`set-state-in-effect`、`no-deriving-state-in-effects`) | ✓ (`no-derived-state`) | ✓ (`set-state-in-effect`) | ✓ (`no-derived-state`)                |
| 2. effect 内の `fetch` (`B`)                  | —                                | —                                                         | —                      | —                         | ✓ (`no-fetch-in-effect`)              |
| 3. `setCount(count + 1)` を handler で (`C`)  | —                                | —                                                         | —                      | —                         | —                                     |
| 3'. `setCount(count + 1)` を effect で (`C2`) | ✓ (`exhaustive-deps` の依存漏れ) | ✓ (`exhaustive-deps`)                                     | —                      | ✓ (`exhaustive-deps`)     | ✓ (`rerender-functional-setstate`)    |
| 4. handler でしか使わない state (`D`)         | —                                | —                                                         | —                      | —                         | ✓ (`rerender-state-only-in-handlers`) |
| `key={i}` (`E`)                               | — (既定の規則に入っていない)     | —                                                         | —                      | ✓ (`no-array-index-key`)  | ✓ (`no-array-index-as-key`)           |
| 対照 (`F`、問題なし)                          | —                                | —                                                         | —                      | —                         | —                                     |

- 「Oxlint の `react` (今の設定)」は、`vp lint` 1.4.0 とこのリポジトリの `vite.config.ts` (`plugins: ["react", "jsx-a11y"]`) で、標本の `A` と `C2` に出た指摘。`react/no-array-index-key` は既定の規則に入っておらず、`vp lint` では出ない。単体の Oxlint で明示的に `warn` にすれば `E` を見つける。
- `react-hooks` の規則名は、Oxlint の config で `{ name: "react-hooks-js", specifier: "eslint-plugin-react-hooks" }` と別名を付けて呼んだ。`react-hooks` の名前は Oxlint の組み込みと衝突するため。
- `exhaustive-deps` の依存漏れは、`C2` の `setCount(count + 1)` を依存配列 `[]` の effect の中に書いたから出る。`C` のように handler の中に書いた `setCount(count + 1)` はどの plugin も見つけなかった (この書き方は多くの場合、問題にならない)。
- 3 と 4 の癖を既製の ESLint plugin で止めるものは見つからなかった (判断: 調べた範囲)。

## 2. Oxlint の jsPlugins で動くか

### Oxlint の公式の説明 (事実)

[JS Plugins | Oxlint](https://oxc.rs/docs/guide/usage/linter/js-plugins.html) は、次のように書く。

- JS plugin は alpha。API は ESLint v9+ と互換で、大半の ESLint plugin はそのまま動く。
- 指定は `jsPlugins` に、パスか npm の package 名を書く。組み込みの plugin と名前が衝突するときは `{ name, specifier }` で別名を付ける。
- 動作を確かめた plugin として `eslint-plugin-react-hooks` を挙げる。「一部の規則は Oxlint が組み込みで持つので、そちらを使うほうがよい」と注記する。YMNNE と `@eslint-react` は一覧に載っていない。
- まだ未対応のもの: 独自のファイル形式と parser、TypeScript の型情報に頼る規則。

### 実測

| plugin                            | 単体の Oxlint 1.89.0             | `vp lint` 1.4.0 (TS 7.0.2)     | 備考                                                                                                  |
| --------------------------------- | -------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| YMNNE 1.0.2                       | 動く                             | 動く                           | `jsPlugins: ["eslint-plugin-react-you-might-not-need-an-effect"]`。`eslint` を入れなくても動く (下記) |
| `eslint-plugin-react-hooks` 7.1.1 | 動く                             | 未実施                         | 別名 `react-hooks-js`。React Compiler の規則 (`set-state-in-effect` ほか) も動いた                    |
| `eslint-plugin-react-x` 5.28.8    | TS 7.0.2 で失敗、TS 5.9.3 で動く | 未実施 (TS 7 では失敗するため) | 下記                                                                                                  |
| react-doctor (参考)               | 動く                             | 動く (前の調査)                |                                                                                                       |

- YMNNE の `package.json` は `exports` に `import` と `require` の両方を持つ。依存は `globals` の 1 つで、`eslint` は peerDependency (`>=8.40.0`)。`--legacy-peer-deps` で `oxlint` と YMNNE だけ (4 package) を入れた環境でも、`eslint` なしで `no-derived-state` が動いた。
- YMNNE の README は、Oxlint の設定に `"env": { "browser": true }` を書くよう示す。`vp lint` の実験では `env` を書かなかったが、標本の結果は単体の実行と同じだった (browser の global を見る規則を踏む標本がなかったため。`env` の有無で検出が変わるかは未確認)。
- `eslint-plugin-react-x` が TS 7.0.2 で動かない理由:
  - Oxlint は `jsPlugins` の指定を `import` で読む。`eslint-plugin-react-x` は ESM のみ (`exports` が `import` だけ)。その依存の `ts-api-utils` の `lib/index.js:781` が `ts.TypeFlags.Intrinsic` を読み、TypeScript 7.0.2 の JS の export (`version`、`versionMajorMinor` の 2 つだけ) には `TypeFlags` がなく、`TypeError` になった。
  - `peerDependencies` は `typescript: "*"` なので、npm は 7.0.2 を許す。実行時に初めて分かる。
  - TypeScript 5.9.3 を同居させると、`react-x` の 53 の規則が Oxlint に読み込めた。
  - Oxlint の公式の説明のとおり、型情報に頼る規則は未対応。`react-x` のうち、どの規則が型情報を必要とするかは今回は調べていない (未確認)。

## 3. ライセンス、保守の状態、版の固定、通信

### ライセンス (事実)

| plugin                      | ライセンス (npm の `license` と GitHub の SPDX) |
| --------------------------- | ----------------------------------------------- |
| YMNNE                       | MIT                                             |
| `eslint-plugin-react-hooks` | MIT                                             |
| `@eslint-react` 系          | MIT                                             |

### 保守の状態 (事実)

| 項目                          | YMNNE                                                 | `eslint-plugin-react-hooks`                                                    | `@eslint-react` 系                                                                           |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 最新の版と公開日              | 1.0.2、2026-08-20                                     | 7.1.1、2026-04-17                                                              | 5.28.8、2026-10-27                                                                           |
| 最初の公開                    | 2025 年 (リポジトリの作成は 2025-04-25)               | React 本体のリポジトリ (`facebook/react`)                                      | 2024-02-16 (`eslint-plugin-react-x` の 0.0.0)                                                |
| 1.0 / 安定版                  | 1.0.0 は 2026-05-31。その前に 0.x を 89 回 (全 92 版) | 7.x                                                                            | 5.x (5.0.0 の前に 2026-04-04 から next / beta)                                               |
| 直近の push                   | 2026-09-24                                            | (React 本体は未確認)                                                           | 2026-10-27                                                                                   |
| GitHub の star                | 1923                                                  | 未確認                                                                         | 594                                                                                          |
| open の Issue + PR            | 0 (GitHub の `open_issues_count`)                     | 未確認                                                                         | 29                                                                                           |
| open / closed の Issue        | 0 / 56                                                | 未確認                                                                         | 23 / 343                                                                                     |
| contributor (先頭 100 件の数) | 4                                                     | 未確認                                                                         | 54                                                                                           |
| 実行時の依存                  | `globals` のみ                                        | `@babel/core`、`@babel/parser`、`hermes-parser`、`zod`、`zod-validation-error` | `@typescript-eslint/*`、`ts-api-utils`、`ts-pattern`、`string-ts` ほか。peer に `typescript` |
| 展開後の大きさ                | 217,690 bytes                                         | 4,095,735 bytes                                                                | `react-x` が 302,940 bytes (ほかに同じ版の 6 package)                                        |
| npm の provenance             | なし (npm の registry の `dist.attestations` が空)    | なし (同じ)                                                                    | あり (`eslint-plugin-react-x` で確認)                                                        |

- YMNNE は 1 人の maintainer (npm の `maintainers` は 1 人) が主に保つ。1.0.0 の changelog に「安定性への自信」とある。
- `react-hooks` は npm の `maintainers` が `react-bot <react-core@meta.com>`。
- 出典: npm の registry (`npm view`)、GitHub API (`gh api repos/...`)、各 package の `CHANGELOG.md`。

### 版の固定 (事実)

- 3 つとも通常の npm package なので、pnpm の catalog に完全な版 (例 `1.0.2`) を書いて固定できる。Renovate も同じ扱いにできる。このリポジトリの既存の流儀 (`pnpm-workspace.yaml` の catalog) と同じ。
- YMNNE は規則の追加や既定の変更を 0.x の間に頻繁に行った (`0.11.0` に `BREAKING CHANGES`、新しい規則が recommended に入った)。1.0 以降の破壊的変更の方針は確かめていない。

### 通信 (実測)

- `unshare -rn` の中で、YMNNE、`react-hooks`、`react-x`、`vp lint` 全体 (YMNNE 入り) が完走した。
- `NODE_OPTIONS=--require` の hook は、Oxlint が起こす Node.js のプロセスに読み込まれた (起動時に記録)。hook の外で `fetch` すると記録に残ることも確かめた。plugin の実行中の記録は 0 件。
- ソースの検索でも、YMNNE の `dist` と `react-hooks` の `cjs` に `fetch(` や `http` / `net` / `dns` の読み込みはなかった。`react-x` の `dist/index.js` で当たったのは、global の名前の一覧にある `"XMLHttpRequest"` の文字列だけ。
- Oxlint 本体 (Rust) の通信は、この方法では見えない。ただし `unshare -rn` で完走しているので、通信が必須ではない。

## 4. 今の検査との重複と、メッセージ

### 今の設定 (事実)

- `vite.config.ts` の `apps/web/src/**` には、`plugins: ["react", "jsx-a11y"]` ([#239](https://github.com/yokozi-jp/agent-software-factory/issues/239))、`web-xss` の自作 plugin (ADR 0019)、`no-console` がある。型の規則 (ADR 0020、`typeAware`、`typeCheck`、`denyWarnings: true`) はルートの設定。
- [`docs/web-frontend/static-analysis.md`](../docs/web-frontend/static-analysis.md) は、`react/set-state-in-effect` と `react-hooks/exhaustive-deps` で止まること、`key={index}` (`react/no-array-index-key`) は既定の規則に入っておらず見つからないことを書く。

### 重複 (実測)

`vp lint` 1.4.0 に、リポジトリの設定と YMNNE の 9 つの規則 (error) を入れて `sample.tsx` と `legit.tsx` に当てた結果:

- `sample.tsx` の行 7 (`A` の `setFull(...)`): `react(set-state-in-effect)` と `ymnne(no-derived-state)` が同じ位置を指す。YMNNE を足すと、同じ書き方が 2 回報告される。
- `sample.tsx` の行 35: `react-hooks(exhaustive-deps)` のみ。
- `legit.tsx` の行 52: `ymnne(no-pass-live-state-to-parent)` のみ。
- `web-xss` の規則と重なる YMNNE の規則はない。`eslint-plugin-react-dom` の `no-dangerously-set-innerhtml` と `no-script-url` は、`web-xss/no-html-injection` と `no-javascript-url` と同じ領域 (判断: 規則名と説明からの読み取り。同じ標本には当てていない)。
- ADR 0020 の型の規則との重複はない。YMNNE は `no-floating-promises` を併用すると正確になるとあり、既に有効 (`sample.tsx` 行 16 で `no-floating-promises` が出た)。

### メッセージが直し方を書けるか (実測)

| plugin / 規則                       | メッセージ (要旨)                                                                                                                                                | 直し方            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| YMNNE `no-derived-state`            | "Avoid storing derived state. Instead, compute "full" directly during render."                                                                                   | 書く (変数名入り) |
| YMNNE 他の規則                      | `dist/index.mjs` の `messages` を読むと、多くの規則が `Instead, ...` の形で直し方を書く (`no-chain-state-updates` は "When possible, update ... simultaneously") | 書く              |
| Oxlint `react/set-state-in-effect`  | help に「render の中で導出する、state を直接初期化する、event で更新する」と書く                                                                                 | 書く              |
| `react-hooks` `set-state-in-effect` | 長い説明と react.dev の URL。直し方は一般論                                                                                                                      | 一般論            |
| `react-x` `set-state-in-effect`     | "Do not call the 'set' function 'setFull' ... synchronously in an effect."                                                                                       | 書かない          |
| `react-x` `no-array-index-key`      | "Do not use item index in the array as its key."                                                                                                                 | 書かない          |

- YMNNE の `no-derived-state` などは、`suggest` や自動修正を持つかを確かめていない (メッセージの文言だけを確認した)。
- メッセージの言語は英語。ADR 0019 の `web-xss` は、理由と代わりに書く書き方を載せたメッセージを自作 plugin から出す (`apps/web/lint/xss-plugin.ts` の冒頭のコメント)。

## 5. 標本での検出数と誤検出

### 検出数 (実測)

| 標本                        | YMNNE 1.0.2                                   | `react-hooks` 7.1.1 (6 規則を warn)                                          | `react-x` 5.28.8 (TS 5.9)                                          | 備考                                            |
| --------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| `sample.tsx`                | 1 (`A` の `no-derived-state`)                 | 3 (`set-state-in-effect`、`no-deriving-state-in-effects`、`exhaustive-deps`) | 3 (`set-state-in-effect`、`no-array-index-key`、`exhaustive-deps`) | `react-hooks` の 3 件のうち 2 件は `A` の同じ行 |
| `legit.tsx`                 | 1 (`Child` の `no-pass-live-state-to-parent`) | 0                                                                            | (未実施)                                                           | 他の 5 つの書き方は 0 件                        |
| `apps/web/src` の既存の tsx | 0                                             | (未実施)                                                                     | (未実施)                                                           | `vp lint` で確認                                |

### 誤検出の様子 (実測と判断)

- `legit.tsx` の 6 つのうち、YMNNE が指摘したのは `Child` (`useEffect(() => { onChange(v); }, [v, onChange])`)。これは規則の意図 (親へ state を effect で渡さず、親に持ち上げる) どおりの検出で、誤検出ではなく設計の指摘と読める (判断)。
- 次の 5 つは 0 件: window の resize 購読、`document.title` の同期、cleanup つき `fetch`、ref の `focus()`、`key={x.id}`。
- 標本は小さい (計 13 つの component)。誤検出の率は測れていない (未確認)。

## 標準の慣行、出典、避けるアンチパターン

- 標準 (事実): ESLint plugin を Oxlint で使う標準の方法は、公式の [JS Plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html) にある `jsPlugins` への指定。YMNNE の README もこの形を勧める。このリポジトリは Vite+ の `lint.jsPlugins` (`vite.config.ts`) に同じ形で書いてあり、`web-xss` が先例。
- 避けるアンチパターン (公式の記述): 組み込みの plugin と名前が衝突する plugin に別名を付けない (`react-hooks` は組み込みと衝突するため別名が要る)。Oxlint が組み込みで持つ規則を JS plugin で二重に有効にしない (公式が `react-hooks` の注記で勧めない)。
- 判断: 組み込みの `react/set-state-in-effect` と YMNNE の `no-derived-state` の二重の報告は、どちらかを off にするのが標準的な整理になる。

## 比較表

| 案                                                               | 止める癖               | 通信                 | TS 7 で動くか              | 費用 / 備考                                                                |
| ---------------------------------------------------------------- | ---------------------- | -------------------- | -------------------------- | -------------------------------------------------------------------------- |
| A. 今のまま (Oxlint の `react` + `jsx-a11y`)                     | 1 (粗く)               | なし                 | 動く                       | `key={i}` と癖 2、3、4 は止めない                                          |
| B. A に `react/no-array-index-key` を足す                        | 1、`key={i}`           | なし                 | 動く                       | 1 行。既定の規則に入っていないだけ                                         |
| C. B に YMNNE を足す                                             | 1 (直し方つき)         | なし                 | 動く                       | 依存は `globals` のみ。1 の指摘が `react/set-state-in-effect` と二重になる |
| D. B に `eslint-plugin-react-hooks` の React Compiler 規則を足す | 1                      | なし                 | 動く                       | 依存が重い (Babel、hermes-parser、zod)。組み込みと名前が衝突し、別名が要る |
| E. B に `eslint-plugin-react-x` を足す                           | `key={i}` ほか         | なし                 | 動かない (TS 5.9 なら動く) | TS 7 と両立しない。型の規則は Oxlint の JS plugin では未対応               |
| F. react-doctor の `oxlint-plugin-react-doctor` を足す (参考)    | 1、2、3'、4、`key={i}` | なし (plugin として) | 動く                       | 前の調査のとおり。ライセンスは Modified MIT                                |
| G. 自作の規則 (癖 2、3、4)                                       | 2、3、4                | なし                 | 動く                       | 既製品が止めない癖を埋める。ADR 0019 の流儀                                |

## 決めるべき論点

1. `react/no-array-index-key` を有効にするか (B)。`docs/web-frontend/static-analysis.md` の「見つからない」の記述を直す必要が出る。
2. YMNNE を足すか (C)。足すなら、`react/set-state-in-effect` との二重の報告をどう整理するか (どちらかを off にする、`no-derived-state` だけにするなど)。
3. YMNNE の 9 つの規則のうち、どれを有効にするか。`legit.tsx` の `Child` のような設計の指摘 (`no-pass-live-state-to-parent`) を許すか。
4. 癖 2 (effect 内の `fetch`)、3 (古い値の `setState`)、4 (handler でしか使わない state) を止めるのに、react-doctor の plugin (F)、自作の規則 (G)、止めない (割り切る) のどれを選ぶか。#225 の決定に直結する。
5. `@eslint-react` を使いたい場合に、TypeScript の JS API を持つ版 (5.x) を併存させる条件を許すか。許さないなら E は外す。
6. 版の固定のしかた (catalog に完全な版)、Renovate での更新の確かめかた (規則名の変更、既定の変更)。
7. 規則の重大度 (warn / error) の扱い。`denyWarnings: true` のため、warn も `vp check` を止める。
8. 誤検出が出たときの扱い。ADR 0019 の `web-xss` は無効化に理由を要求するが、同じ流儀を React の規則にも広げるか。

## 未確認のこと

- 規則の誤検出の率。標本は 13 つの component と、`apps/web/src` の 3 つの tsx だけ。
- YMNNE の `env.browser` 設定の有無が、検出に影響するか。
- YMNNE の規則が `suggest` や自動修正を持つか。
- `eslint-plugin-react-x` の規則のうち、型情報を必要とするもの。TS 5.9 の環境でその規則が動くか。
- `eslint-plugin-react-hooks` 7.1.1 を `vp lint` 1.4.0 の中で動かすこと (単体の Oxlint 1.89.0 でのみ確認)。
- `eslint-plugin-react-x` 以外の `@eslint-react` 系 (`react-dom` 以外) を Oxlint で動かすこと。`react-dom` は読み込めたが、標本の検出は確かめていない。
- `vp lint` を TypeScript 7 のまま `@eslint-react` に近い検出で埋める方法。
- `react-hooks` 7.1.1 の GitHub 側の指標 (star、Issue、contributor)。React 本体のリポジトリに含まれるため集計していない。
- YMNNE の 1.0 以降の破壊的変更の方針。
- Oxlint 本体 (Rust) が通信するか。`strace` はなく、`unshare -rn` での完走でのみ確かめた。
- Oxlint の将来の版 (1.89.0 より新しい版) で、同じ plugin が動くか。`vite-plus@1.4.0` は `oxlint@=1.89.0` に固定している。
- Kiro、CI (Nx の target) での実行。

## 出典

- Oxlint: [JS Plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html)
- YMNNE: [リポジトリ](https://github.com/nickjvandyke/eslint-plugin-react-you-might-not-need-an-effect)、[README](https://github.com/nickjvandyke/eslint-plugin-react-you-might-not-need-an-effect/blob/main/README.md)、[npm](https://www.npmjs.com/package/eslint-plugin-react-you-might-not-need-an-effect)
- `eslint-plugin-react-hooks`: [npm](https://www.npmjs.com/package/eslint-plugin-react-hooks)、[React docs: set-state-in-effect](https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect)
- `@eslint-react`: [リポジトリ](https://github.com/Rel1cx/eslint-react)、[`@eslint-react/eslint-plugin`](https://www.npmjs.com/package/@eslint-react/eslint-plugin)、[`eslint-plugin-react-x`](https://www.npmjs.com/package/eslint-plugin-react-x)
- React: [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- このリポジトリ: `vite.config.ts` の `lint`、`pnpm-workspace.yaml` の catalog、`docs/web-frontend/static-analysis.md`、ADR 0019、0020、react-doctor の調査 (`research/react-doctor.md`)
