# react-doctor で apps/web の React を検査できるか、何が重なり何が足されるか、導入の条件を調べる

## 問い

[Issue #224](https://github.com/yokozi-jp/agent-software-factory/issues/224) の調査。結果は [react-doctor を web の検査に足すかを決める (#225)](https://github.com/yokozi-jp/agent-software-factory/issues/225) の材料にする。決定はしない。

- 何を見つけるか、0〜100 の点数をどう出すか。
- 決定的か。ネットワークや AI を呼ぶか。CI のゲートにできる出力があるか。
- 今の検査 (Oxlint、ADR 0019 の自作 plugin、Knip、jscpd、ADR 0020 の型の規則) との重複。
- TanStack Router、Vite+ (`vp`)、Nx と組み合わせて動くか。入れ方、版、ライセンス、保守の状態。
- 同梱の agent 向けの skill (`/doctor`) を Kiro で使えるか。

調べた日は 2026-10-26。対象は react-doctor 0.9.18 (npm の `latest`、2026-10-12 公開、[react-doctor](https://www.npmjs.com/package/react-doctor))。リポジトリは main の 8449830。

実際に動かした環境は次のとおり。worktree には node_modules も生成物も残していない。

- `/tmp/rdweb/web`: `apps/web` の複製。pnpm の catalog の版を `package.json` に直書きし、`react-doctor@0.9.18` を npm で入れた。Node.js 24.22.1。
- `/tmp/rdrepo`: ルートの `vite.config.ts` と `apps/web` を同じ配置で複製し、`vite-plus@1.4.0` を入れた。リポジトリの Oxlint の設定そのままで `vp lint` を動かすため。
- 通信の記録: `strace` がこのマシンになかったので、`NODE_OPTIONS=--require` で `net.Socket.connect`、`dns.lookup`、`fetch` を記録する hook を差した。子プロセスの Node.js も記録するが、Oxlint 本体 (Rust のバイナリ) の通信は見えない。補強として、`unshare -rn` (外へ出る経路のない network namespace) の中でも動かした。
- 「悪いコード」の標本: `apps/web/src/bad.tsx` (31 行)。`eval`、`dangerouslySetInnerHTML`、`javascript:` の URL、`alt` のない `img`、`key={i}`、クリックだけの `div`、effect の中で state を書く箇所を入れた。実際の `apps/web` には 3 つの tsx しかなく、そのままでは検出の幅が分からないため。

## 要約

確かめた事実:

- 検出: 906 の規則 (既定で有効 688)。分類は Security、Bugs、Performance、Accessibility、Maintainability の 5 つ。README の「state と effect」「architecture」は独立した分類ではない。TanStack Router 専用の規則はない (TanStack Start と TanStack Query の規則はある)。
- 点数: 点数は手元で計算されず、検出結果を `https://www.react.doctor/api/score` に POST して返してもらう。式は npm の package に入っていない。`--no-score` か `--no-telemetry` で点数は `null` になる。点数で CI を落とす option はない。
- 決定性: 検出結果は 4 回の実行で同一だった (JSON は実行時間の項目だけが違う)。AI を呼ぶ形跡はない。ただし既定の実行は 4 つの外部ホスト (Axiom、Sentry、Socket.dev、react.doctor) に通信する。`--no-score --no-supply-chain --no-telemetry` を付けると、通信は 0 件だった。環境変数 `REACT_DOCTOR_NO_TELEMETRY=1` だけでは、Socket.dev と score API への通信が残る。
- CI: 終了コードは検出の重大度で決まる (error があれば 1、warning だけなら 0)。`--blocking`、`--warning-exit-code`、`--scope changed`、`--baseline`、`--staged` がある。
- 重複: 今の `apps/web` の Oxlint は React と jsx-a11y の plugin を有効にしていない。標本では、今の設定が 4 件 (`no-console` と `web-xss` の 3 件)、react-doctor が 11 件を見つけ、`web-xss` と同じ箇所を指す規則が 3 つある。Oxlint の `react` と `jsx-a11y` の plugin を 1 行で有効にするだけでも、a11y の 4 件と effect 内の setState を拾えた。
- 組み合わせ: TanStack Router の app は `framework: "vite"` と判定され、そのまま動いた。`oxlint-plugin-react-doctor` を `vite.config.ts` の `lint.jsPlugins` に足すと、`vp lint` (Vite+ 1.4.0) の中で動き、通信は 0 件だった。
- ライセンスと保守: ライセンスは「Modified MIT」で、MIT に 2 つの禁止 (AI の学習データとしての利用、有償のホスト型サービスとしての提供) が足されている。GitHub は SPDX を判定できない (`NOASSERTION`)。0.x で、2026-02-13 の公開から 117 の安定版が出ている。provenance (SLSA) は付いている。
- Kiro: 同梱の skill は `.kiro/skills` に入れられる (Kiro CLI が対象に入っている)。`/doctor` は、実行のたびに `www.react.doctor` から指示書を取って従う仕組み。

判断 (推測を含む):

- `apps/web` は今 3 つの tsx で、標本なしの実行は 0 件・100 点だった。今の規模では、react-doctor が効くかどうかの材料は標本からしか得られない。
- 重複の大半は Oxlint の組み込み規則で埋められる。react-doctor にしかない規則は、effect と state の設計 (`no-derived-state`、`rerender-*` など)、セキュリティの文脈検査、依存の供給網の検査。
- ネットワーク、点数の外部計算、ライセンスの 3 つが、決める論点の中心になる。

## 何を見つけるか

### 規則の数と分類 (実測)

`react-doctor rules list --json` の出力を数えた。

| 分類            | 全部 | 既定で有効 |
| --------------- | ---: | ---------: |
| Bugs            |  496 |        444 |
| Performance     |  136 |        113 |
| Maintainability |  116 |         20 |
| Accessibility   |  102 |         60 |
| Security        |   56 |         51 |
| 合計            |  906 |        688 |

- 既定の重大度は、有効な 688 のうち error が 217、warn が 471。218 は既定で off。
- 対象の framework の内訳は、global が 810、react-native が 42、nextjs が 25、tanstack-start が 15、tanstack-query が 9、preact が 5。TanStack Router 専用の規則はない。
- off の大半は `design` タグ (112 規則、UI の見た目の指摘) と Maintainability の一部。`unused-file`、`unused-export`、`unused-type`、`unused-dependency`、`unused-dev-dependency`、`circular-dependency` も既定は off ([What is React Doctor?](https://react.doctor/docs) は、これらを opt-in と書く)。
- README が挙げる「state と effect」「architecture」は、規則の分類としては存在しない。state と effect の規則は Bugs と Performance に、architecture は Maintainability (`no-giant-component`、`no-high-complexity-react-function`、`duplicate-jsx-subtree` など) に入る (判断: `rules list` の規則名からの読み取り)。
- 出典: [README](https://github.com/millionco/react-doctor/blob/main/README.md)、[What is React Doctor?](https://react.doctor/docs)、[CLI reference](https://react.doctor/docs/reference/cli-reference)。数は `react-doctor@0.9.18` の `rules list --json`。

### 標本での検出 (実測)

`bad.tsx` に対する react-doctor の 11 件 (`--no-score --no-supply-chain --no-telemetry`):

| 重大度  | 分類          | 規則                                                                                |
| ------- | ------------- | ----------------------------------------------------------------------------------- |
| error   | Security      | `no-eval`、`jsx-no-script-url`                                                      |
| error   | Accessibility | `alt-text`                                                                          |
| warning | Security      | `dangerous-html-sink`                                                               |
| warning | Accessibility | `anchor-is-valid`、`click-events-have-key-events`、`no-static-element-interactions` |
| warning | Bugs          | `exhaustive-deps`、`no-array-index-as-key`                                          |
| warning | Performance   | `rerender-state-only-in-handlers`、`rerender-functional-setstate`                   |

- 見つけなかったもの: `console.log` (react-doctor に該当の規則がない)。
- 同じファイルでも、検出の集合が他の指摘に左右された。標本から `eval(...)` の行だけを消すと `no-derived-state` が出た。`javascript:` の行、`<img>` の行、`console.log` の行を消しても出なかった。原因は確かめていない。同じ入力は何度でも同じ結果になった (次節)。
- 実際の `apps/web` (8 ファイル) は 0 件で、点数は 100。走査したファイルに `src/routeTree.gen.ts` (自動生成、リポジトリの lint では ignore している) と `lint/xss-plugin.ts`、`vite.config.ts` が入った。除外するには `doctor.config.*` の `ignore.files` が要る ([Config files](https://react.doctor/docs/configuration/config-files))。

### 点数の出し方

- 事実: 点数は、検出結果 (規則、重大度、メッセージ、行、path) を gzip した JSON にして `https://www.react.doctor/api/score` へ POST し、`{ score, label, rules: { 規則: { priority, tier } } }` を受け取る (`react-doctor/dist` の `requestScore`、`SCORE_API_URL`)。ファイルの中身は送らず、path は `scrubSensitivePaths` と `redactSensitiveText` を通す。CI では repo、sha、framework、React の版なども付く。
- 事実: 式は package に入っていない。公式の docs のうち読んだ範囲 (README、CLI reference、Config files、Data use) にも式はない。
- 実測: 検出 0 件で 100 ("Great")。標本の 11 件 (error 3、warning 8) で 38 ("Critical")。同じ入力で 3 回とも 38。`--category Security` で絞っても点数は 38 (点数は絞る前の全部の検出から計算される。CLI reference の `contextual` の説明も同じ扱い)。
- 事実: 点数の閾値で失敗させる option はない。`minScore` は supply chain (Socket.dev) の設定にだけある。
- 判断: 式がサーバー側にあり版も付かないので、同じコードの点数が日によって変わりうる。検証はしていない。点数をゲートにする根拠にはしにくい。見るなら、重大度とルール単位の検出を見る方が決定的。

## 決定的か、ネットワークや AI を呼ぶか、CI のゲートにできるか

### 決定性 (実測)

- 同じ標本を `--no-cache` 付きと無しで合計 4 回。検出の規則 id の集合は完全に一致した。`--json-out` の 2 つの出力を比べると、違うのは `elapsedMilliseconds` (全体と project ごと) だけ。
- 事実: JSON の診断の `id` は `ファイルの相対 path::行:列::plugin/rule::occurrenceDigest` の決定的な形 ([JSON report の仕様](https://github.com/millionco/react-doctor/blob/main/docs/json-report.md))。
- 事実: 公式の docs は "deterministically scans" と書く ([What is React Doctor?](https://react.doctor/docs))。README も "deterministic checks"。
- 事実: 依存に AI の SDK はない (`npm view react-doctor@0.9.18 dependencies`)。[Data use](https://www.react.doctor/docs/legal/data-use) は、PR のレビューは「AI のモデル提供者ではなく静的解析で作る」と書く。
- 事実: 入力のほかに、Socket.dev の依存の評価と score API が結果に入る。これらは外部の状態で変わりうる (判断)。

### ネットワーク (実測)

| 実行                                                     | 通信先 (hook で記録)                                                                                                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 既定                                                     | `api.axiom.co` (traces と metrics)、`o4510226365743104.ingest.us.sentry.io`、`firewall-api.socket.dev` (package.json の直接の依存 10 件を 1 件ずつ。react-doctor 自身を含む)、`www.react.doctor/api/score` |
| `REACT_DOCTOR_NO_TELEMETRY=1` だけ                       | `firewall-api.socket.dev` と `www.react.doctor/api/score` が残る。Axiom と Sentry は止まる                                                                                                                 |
| `--no-score --no-supply-chain --no-telemetry`            | 0 件                                                                                                                                                                                                       |
| 既定のまま、外へ出る経路のない namespace (`unshare -rn`) | 最後まで動く。`[react-doctor] Score API unreachable (fetch failed)` と出て、点数は出ない。終了コードは検出の重大度で決まる                                                                                 |

- 事実: [Data use](https://www.react.doctor/docs/legal/data-use) は、CLI の telemetry の送り先を Sentry (クラッシュ)、Axiom (実行の trace と利用の数)、利用者が `REACT_DOCTOR_OTLP_ENDPOINT` と `REACT_DOCTOR_OTLP_AUTH_HEADER` を設定した場合の自分の collector、と書く。内容は CLI の版、OS、Node.js の版、framework、プロジェクトの規模、規則名、件数、点数、時間、クラッシュ時のスタックとファイル名など。「ファイルの中身とコードの断片は送らない」。path は home の部分を `~` にし、secret とメールの形を伏せるが、リポジトリ名、ディレクトリ名、ファイル名は残りうる。
- 事実: [CLI reference](https://react.doctor/docs/reference/cli-reference) は、`--no-score` は score API、share URL、クラッシュ報告をやめるもので、`--no-telemetry` も受け付けると書く。`react-doctor --help` では `--no-telemetry` は `--no-score` の別名。手元の実測では、`--no-telemetry` だけで Axiom と Sentry の通信が消えた (つまり `--no-telemetry` は telemetry も止める)。
- 事実: Socket.dev は `--no-supply-chain` で止める。設定では `supplyChain.enabled`。
- 未確認: Oxlint 本体 (Rust) の通信。hook からは見えない。namespace の中で最後まで動いたので、検出に通信は要らないと読める。
- 判断: 「通信しない」を保つには、3 つの option をそろえて付けるか、設定ファイルで同じ指定をする必要がある。既定のままだと、ソースの規則名、件数、ファイル名、依存の一覧が外へ出る。

### CI のゲート (実測)

| 指定                                             | 終了コード (標本: error 3、warning 8) |
| ------------------------------------------------ | ------------------------------------- |
| 既定 (`--blocking error`)                        | 1                                     |
| warning だけのコードに既定                       | 0                                     |
| warning だけのコードに `--blocking warning`      | 1                                     |
| warning だけのコードに `--warning-exit-code 123` | 123                                   |
| `--blocking none`                                | 0                                     |

- 事実: 差分だけの検査は `--scope changed` (base と比べて新しく入った指摘だけ)、`lines` (変更行に触る指摘)、`contextual` (変更した関数・要素・ファイルの既存の指摘も含む)、`files`、`--staged`、`--baseline <report.json>` がある ([CLI reference](https://react.doctor/docs/reference/cli-reference))。
- 実測: `main` から枝を切って標本を足すと、`--scope changed --base main` は mode が `baseline` で 10 件、`lines` と `contextual` も 10 件、`full` は 11 件 (差の 1 件の理由は確かめていない)。標本と無関係な `main.tsx` だけを変えると 0 件・終了コード 0。
- 事実: `--max-duration <秒>` で時間の上限を付け、部分結果を返せる。JSON の `projects[].complete` と `analyzedFiles` で、全部走査できたかを見る ([JSON report の仕様](https://github.com/millionco/react-doctor/blob/main/docs/json-report.md))。
- 事実: 公式の GitHub Action は `millionco/react-doctor@v2`。PR に sticky コメントと行コメントを付け、commit status を書く。permissions は `contents: read`、`pull-requests: write`、`issues: write`、`statuses: write`、checkout は `fetch-depth: 0` が要る ([CI](https://react.doctor/ci))。
- 事実: GitLab 向けに `--warning-exit-code` がある ([warning exit code の設計メモ](https://github.com/millionco/react-doctor/blob/main/docs/warning-exit-code.md))。
- 実測: 初回の実行で、走査は 8 ファイルで 3.5〜5.2 秒 (4 workers)。

## 今の検査との重複

### 今の設定 (事実)

- ルートの `vite.config.ts` の `lint` に `plugins` の指定がない。Oxlint の既定は `oxc`、`typescript`、`unicorn` が on、`react`、`jsx-a11y`、`react-perf` が off ([Oxlint の CLI の `--help`](https://oxc.rs/docs/guide/usage/linter/cli.html)、1.81.0 で確認)。`overrides` で足している plugin は `vitest`、`import`、`unicorn` だけ。
- つまり `apps/web` では React と jsx-a11y の規則は 1 つも有効になっていない。Issue #224 の「Oxlint (React と jsx-a11y の規則…) との重複」の前提は、今の設定では成り立たない。`docs/web-frontend/static-analysis.md` と ADR 0019 は、この点を書いていない (食い違いではなく、書かれていない)。
- `apps/web/src` で有効なのは、`no-console`、ADR 0019 の `web-xss/*` の 4 規則、`unicorn/no-abusive-eslint-disable`、`typedRules` (ADR 0020 の `typescript/*` の型情報を使う規則)。`no-eval` は off。

### 標本での突き合わせ (実測)

リポジトリの `vite.config.ts` のまま `vp lint` (Vite+ 1.4.0、Oxlint 1.89.0) を `bad.tsx` に動かすと 4 件 (`no-console`、`web-xss/no-dynamic-code`、`web-xss/no-html-injection`、`web-xss/no-javascript-url`)。`plugins` に `react` と `jsx-a11y` を足しただけの変更を試すと 11 件になった。

| 標本の箇所                            | 今の設定                           | Oxlint に `react`/`jsx-a11y` を足す                                       | react-doctor                             |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| `console.log`                         | あり                               | あり                                                                      | なし                                     |
| `eval`                                | あり (`web-xss/no-dynamic-code`)   | あり (同じ)                                                               | あり (`no-eval`、error)                  |
| `dangerouslySetInnerHTML`             | あり (`web-xss/no-html-injection`) | あり (同じ)                                                               | あり (`dangerous-html-sink`、warning)    |
| `javascript:` の URL                  | あり (`web-xss/no-javascript-url`) | あり (同じ)                                                               | あり (`jsx-no-script-url`、error)        |
| `img` の `alt` なし                   | なし                               | あり (`jsx-a11y/alt-text`)                                                | あり (`alt-text`)                        |
| `a href="javascript:"` の無効な href  | なし                               | あり (`anchor-is-valid`)                                                  | あり (`anchor-is-valid`)                 |
| クリックだけの `div`                  | なし                               | あり (`click-events-have-key-events`、`no-static-element-interactions`)   | あり (同名の 2 規則)                     |
| 依存配列のない effect 内の `setState` | なし                               | あり (`react-hooks/exhaustive-deps`、`react/set-state-in-effect` が 2 件) | あり (`exhaustive-deps`)                 |
| `key={i}`                             | なし                               | なし                                                                      | あり (`no-array-index-as-key`)           |
| 古い値を読む `setCount(count+1)`      | なし                               | なし                                                                      | あり (`rerender-functional-setstate`)    |
| handler でしか使わない state          | なし                               | なし                                                                      | あり (`rerender-state-only-in-handlers`) |

- 事実: Oxlint 1.81 の `--rules` の規則名と react-doctor の規則 id を、名前の一致で数えた。`jsx-a11y` は Oxlint の 36 規則すべてが react-doctor に同名であり、既定で有効。`react` は 85 のうち 60 が同名で、35 が既定で有効。`react-perf` は 4 つすべて同名。`typescript` は 110 のうち 1 つ (`no-namespace`) だけ同名で、`typescript/no-unsafe-*` など ADR 0020 の型情報を使う規則と同名の規則はない。`unicorn` と `oxc` は同名なし。react-doctor の 906 のうち、Oxlint に同名のない規則は 805 (既定で有効 612)。
- 注意: 名前が同じでも検出の範囲は同じとは限らない。標本では `dangerous-html-sink` が warning で「動的に見える値」を対象にする (メッセージによる) のに対し、ADR 0019 の `web-xss/no-html-injection` は全部を禁止する。`new Function` や文字列の `setTimeout`、`el.innerHTML = ...` は react-doctor 側を試していない。
- 判断: セキュリティの 3 規則は、react-doctor を足すと同じ箇所を別のメッセージで二重に報告する。ADR 0019 は「直し方を書いたメッセージ」のために自作 plugin を選んだ。react-doctor を足しても、`web-xss` を置き換える根拠にはならない。重複を避けるなら、react-doctor 側で `ignore.rules` に落とす (`doctor.config.*`)。

### Knip、jscpd、ADR 0020

- Knip (ADR 0017): react-doctor の `unused-file`、`unused-export`、`unused-type`、`unused-dependency`、`unused-dev-dependency`、`circular-dependency` は既定 off の opt-in ([What is React Doctor?](https://react.doctor/docs))。有効にすれば Knip と重なる。有効にした実行は試していない。重なりを避けるなら off のままにする (判断)。
- jscpd (ADR 0014): react-doctor の `duplicate-jsx-subtree` は既定で on。JSX の繰り返しだけを対象にする ([What is React Doctor?](https://react.doctor/docs))。jscpd は apps/ と packages/ の全ソースのトークンの重複を見る。`apps/web` の tsx が 3 つなので、比べるだけの標本がなく、検出の差は確かめていない。
- ADR 0020: react-doctor は型検査も型情報を使う規則も持たない (上の同名の突き合わせから。実装が型情報を使うかは、`typescript` を同梱していることから使う可能性があるが確かめていない)。`typedRules` と重ならない。

### 重ならない部分 (判断を含む)

- effect と state の設計: `no-derived-state`、`no-fetch-in-effect`、`no-effect-chain`、`no-cascading-set-state` (off)、`rerender-*`。Oxlint の `react-hooks` 相当の `exhaustive-deps` と `set-state-in-effect` の外側にある。
- セキュリティの文脈検査: `auth-token-in-web-storage`、`no-secrets-in-client-code`、`public-env-secret-name`、`postmessage-origin-risk`、`insecure-session-cookie`、`webhook-signature-risk` など 51 規則が既定で on。この中の「project-level security-scan」の規則は、プラグインではなく CLI でだけ動く ([ESLint & oxlint plugins](https://react.doctor/docs/configuration/eslint-and-oxlint-plugins))。
- 依存の供給網: Socket.dev の評価 (`minScore` 50 以下で error、既定)。osv-scanner (ADR 0021) と観点が違い、通信が要る。
- 実行時の性能 trace: `react-doctor scan <url>` が Chrome で DevTools の trace を取る ([README](https://github.com/millionco/react-doctor/blob/main/README.md))。静的解析ではない。今回は動かしていない。

## TanStack Router、Vite+、Nx との組み合わせ、入れ方、版、ライセンス、保守

### 動作 (実測)

- TanStack Router: `apps/web` は `framework: "vite"`、React 19、TypeScript ありと判定され、そのまま動いた。TanStack Router 専用の規則はない。
- TypeScript 7: react-doctor は `typescript >=5.0.4 <6` に依存し、`node_modules/react-doctor/node_modules/typescript` に 5.9.3 を別に入れた。project の TypeScript 7.0.2 とは別々に置かれ、エラーは出なかった。
- Oxlint が 2 つになる: react-doctor は `oxlint >=1.81.0 <1.82.0` に依存する。Vite+ 1.4.0 の Oxlint は 1.89.0 (`vp lint --version`)。
- Vite+: `oxlint-plugin-react-doctor@0.9.18` を devDependency にして、`vite.config.ts` の `lint.jsPlugins` に `{ name: "react-doctor", specifier: "oxlint-plugin-react-doctor" }` を足し、`rules` で 6 つを `error` にすると、`vp lint` が 9 件を報告し、通信は 0 件、2.7 秒 (1 ファイル) だった。標本の `no-derived-state` はこの経路では出なかった (CLI と同じ理由かは未確認)。公式の docs は `.oxlintrc.json` の例を載せ、規則は 1 つずつ書く形を示す ([ESLint & oxlint plugins](https://react.doctor/docs/configuration/eslint-and-oxlint-plugins))。Vite+ は `lint.jsPlugins` を公式に使う ([Vite+ Lint](https://github.com/voidzero-dev/vite-plus/blob/main/docs/guide/lint.md))。
- CLI の既存設定の取り込み: `.oxlintrc.json` と `.eslintrc.json` だけを読む (`ADOPTABLE_LINT_CONFIG_FILENAMES`)。このリポジトリは Vite+ の方針どおり `vite.config.ts` の `lint` に書いていて、CLI は読まない。CLI を足すと、`web-xss` や `typedRules` の設定を引き継がず、独立に動く。
- Nx: 動かしていない。`react-doctor` は `.nx` を走査から外す (`IGNORED_DIRECTORIES`)。キャッシュは `node_modules/.cache/react-doctor/scan-cache.json`、診断の全体は `--output-dir` を指定しないと一時フォルダ (`/tmp/react-doctor-<uuid>`) に書く。ADR 0002 のとおり、`package.json` の scripts から Nx の target を推論させ、`nx.json` の `targetDefaults` に inputs を書くことになる (判断)。
- monorepo: `--project` と、`doctor.config.*` の `projects` で、project ごとに点数を出せる ([CLI reference](https://react.doctor/docs/reference/cli-reference))。

### 入れ方

- 公式の手順は `npx react-doctor@latest` で、版が固定されない。ADR 0018 の「固定した版は Renovate が更新する」と合わない (判断)。
- `react-doctor install -y` の dry-run は、skill の配置のほかに、devDependency の追加、`.git/hooks/pre-commit` への hook、`.github/workflows/react-doctor.yml` の作成を挙げた。lefthook で hook を管理する ADR 0001 と衝突する。使う場合は個別の option で選ぶ (判断)。
- 判断: npm の package なので、knip、jscpd と同じく pnpm の catalog に版を書く形が既存の流儀 (`pnpm-workspace.yaml`)。mise の `npm:` backend は試していない。ADR 0009 の mise は CLI のバイナリ向けで、Node.js の package は対象にしていない。
- 事実: `engines.node` は `^20.19.0 || >=22.13.0`。このリポジトリの Node.js 24.22.1 は満たす。package は provenance 付き (`dist.attestations`)。展開した大きさは `react-doctor` が約 9.9 MB (npm の `unpackedSize`)、`node_modules` 内で 33 MB。依存に `@sentry/node`、`playwright-core`、`eslint-plugin-react-hooks`、`oxc-parser` などが入る。

### ライセンス

- 事実: [LICENSE](https://github.com/millionco/react-doctor/blob/main/LICENSE) は「Modified MIT License」(Million Software, Inc.)。MIT に、書面の許可なしでは次を禁じる条項を足している。
  1. ソフトウェアやその派生物を、機械学習・AI のモデルの学習、fine-tuning、評価のデータや、そのための自動パイプラインの入力に使うこと。
  2. ソフトウェアを、価値の全部か大部分がそれに由来する有償のホスト型サービス (商用 API や SaaS を含む) として第三者に提供すること。
- 事実: npm の `license` は `SEE LICENSE IN LICENSE`。GitHub の判定は `NOASSERTION`。README は "MIT-licensed" と書く。標準の MIT ではなく、OSI の定義の許諾でもない (判断: 利用分野の制限を含むため)。
- 事実: CLI は、学習用の環境と判断できる環境変数 (SWE-bench など) を検知すると警告を出す (`detectAiTrainingEnvironment`)。
- 判断: このリポジトリで CLI を CI や agent から動かすことは、禁止 1 と 2 のどちらにも当たらないように読めるが、法的な判断ではない。「エージェントの出力を評価する」用途 (評価データ) に当たるかは、利用者が確認する。

### 保守の状態

- 事実: リポジトリは 2026-02-13 に作られ、アーカイブされていない。stars 15,049、forks 491、open の issue と PR が 406、最終 push は 2026-10-26 ([GitHub](https://github.com/millionco/react-doctor))。
- 事実: npm の安定版は 117。直近は 0.9.13 (09-02)、0.9.14 (09-12)、0.9.16 (10-04)、0.9.17 (10-05)、0.9.18 (10-12)。`dev` の build は 10-15 にも出ている。1.0 に達していない。規則は 906 あり、旧い規則名も使えると README が書く (名前の変更が起きている)。
- 未確認: contributor の数 (API が EOF で失敗した)。変更履歴の破壊的変更の頻度。

## 同梱の agent 向け skill (`/doctor`) を Kiro で使えるか

- 事実: skill は [`skills/react-doctor/SKILL.md`](https://github.com/millionco/react-doctor/blob/main/skills/react-doctor/SKILL.md) (version 1.2.0、frontmatter に `name`、`description`)。`react-doctor install` が配る。dry-run の対象に「Kiro CLI」が出て、配置先は `.kiro/skills` (グローバルは `~/.kiro/skills`)。配る部分は `agent-install@0.0.5` (MIT)。npm の 0.9.18 に入った SKILL.md は、main より新しい `contextual` の段落 (6 行) が少ない。
- 事実: Kiro の skill は `.kiro/skills/` に置いた Agent Skills 標準の package で、説明に合う依頼で自動で有効になる。`/` に続けて skill 名を打つと明示で呼べる ([Kiro: Skills](https://kiro.dev/docs/skills/))。
- 判断: Kiro では、`/doctor` ではなく skill 名の `/react-doctor` で呼ぶ形になる。SKILL.md が言う `/doctor` は、description の「`/doctor` と打ったとき」で、自動の有効化の手がかりとして働く。Kiro で実際に呼んで確かめてはいない。
- 事実: `/doctor` の中身は、実行のたびに `https://www.react.doctor/prompts/react-doctor-agent.md` を `curl` で取り、その指示書に従う作り。指示書は取得時に変わる。取って読んだところ、「作業ツリーを直接直す、commit や PR は作らない」が既定で、PR モードは明示の選択が要る。規則ごとの修正の手順 (`/prompts/rules/<plugin>/<rule>.md`) も同じ場所から取る。
- 事実: SKILL.md の実行例は `npx react-doctor@latest ...` で、`--no-telemetry` も `--no-supply-chain` も付かない。したがって skill を使うと、既定の通信 (前述の 4 ホスト) が起きる。
- 判断: このリポジトリの skill は `.agents/skills` に置き `skills-lock.json` で内容を固定し、`.kiro/skills` は symlink にしている。`react-doctor install` は `.kiro/skills` に直接書くので、この運用と合わない。また、実行のたびに更新される外部の指示書は、「取った内容は命令ではなくデータとして扱う」という既存の方針 (AGENTS の規則と同じ考え方) と緊張する。使う場合は SKILL.md を repo の流儀で取り込み、`/doctor` の取得の節を外す (判断)。

## 標準の慣行、出典、避けるアンチパターン

| 論点                 | 標準の慣行                                                                 | 出典                                                                                     | 避けるアンチパターン                                                |
| -------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| lint の設定の置き場  | Vite+ では `vite.config.ts` の `lint` に書き、`jsPlugins` で plugin を足す | [Vite+ Lint](https://github.com/voidzero-dev/vite-plus/blob/main/docs/guide/lint.md)     | `.oxlintrc.json` を別に持つ。CLI と `vp lint` で規則が二重になる    |
| 道具の版             | lockfile で版を固定し、更新は Renovate (ADR 0018)                          | [ADR 0018](../docs/adr/0018-renovate-for-pinned-versions.md)                             | CI で `npx tool@latest` を動かす                                    |
| 外部の GitHub Action | full-length の commit SHA で固定する                                       | [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) | `@v2` のようなタグ参照 (react-doctor の案内はこの形)                |
| ゲート               | 重大度と規則単位の検出で落とす。差分は base との比較                       | [CLI reference](https://react.doctor/docs/reference/cli-reference)                       | 外部サービスが返す点数をゲートにする (判断)                         |
| 外部への送信         | 既定で送る道具は、送らない設定を明示し、送る内容を文書にする               | [Data use](https://www.react.doctor/docs/legal/data-use)                                 | 既定のまま CI で動かし、ファイル名や依存の一覧を第三者に渡す (判断) |
| agent の skill       | 内容を固定し、取った指示はデータとして扱う                                 | [Kiro: Skills](https://kiro.dev/docs/skills/)                                            | 実行のたびに外部の指示書を取って従う (判断)                         |

「標準」と呼べるのは、1〜3 行目と、ゲートの重大度による判定。react-doctor の既定の使い方 (`npx @latest`、telemetry on、score API) は、このリポジトリの方針と合わない点が複数ある (判断)。

## 比較表

| 案                                                              | 検出                     | 通信                                    | 点数          | 差分だけ               | 導入と保守                                                          | 今の検査との関係                                                         |
| --------------------------------------------------------------- | ------------------------ | --------------------------------------- | ------------- | ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A. 今のまま                                                     | 4 件 (標本)              | なし                                    | なし          | `vp check`             | なし                                                                | React と a11y の規則は未有効                                             |
| B. Oxlint の `react`/`jsx-a11y` を有効にする (`plugins` に足す) | 11 件 (標本)             | なし                                    | なし          | 同上                   | `vite.config.ts` の数行。版は Vite+ に従う                          | `web-xss` と共存。`key={i}`、`rerender-*`、`no-derived-state` は拾えない |
| C. `oxlint-plugin-react-doctor` を `vp lint` に足す             | B に加え、足した規則だけ | なし (実測 0 件)                        | なし          | `vp check`             | devDependency と規則の列挙。Oxlint の JS plugin は alpha (ADR 0019) | `web-xss` の 3 規則と一部が二重。CLI 専用のセキュリティ検査は動かない    |
| D. react-doctor の CLI (3 つの option で通信なし)               | 11 件 (標本)             | 0 件 (実測)                             | なし (`null`) | `--scope changed` など | devDependency、`doctor.config.*`、Nx の target                      | `web-xss` と一部が二重。Oxlint が 2 つ入る                               |
| E. react-doctor の CLI (既定)                                   | 同上 + 供給網            | Axiom、Sentry、Socket.dev、react.doctor | 外部計算      | 同上                   | 同上 + GitHub Action (PR コメント)                                  | 同上                                                                     |
| F. E に Kiro の skill (`/react-doctor`) を足す                  | 同上                     | E と同じ + 指示書の取得                 | 同上          | 同上                   | skill の固定の運用と合わない                                        | 同上                                                                     |

## 決めるべき論点

1. 通信の扱い: 「通信しない」を条件にするか。条件にするなら、D か C か B。E と F は条件を満たさない。
2. 点数: 外部計算の点数を使うか、使わないか。使わないなら、`--no-score` で `null` を受け入れる。
3. ライセンス: Modified MIT (AI の学習データ・評価データへの利用の禁止、ホスト型サービスとしての提供の禁止) を許容するか。このリポジトリの用途への当てはめを誰が確認するか。
4. まず B をやるか: React と jsx-a11y の plugin を有効にするだけで、標本の a11y と effect の指摘の大半は拾える。B の費用対効果と、react-doctor にしかない規則 (`key={i}`、`rerender-*`、`no-derived-state`、セキュリティの文脈検査、供給網) の価値の比較。
5. 入り口: CLI (D) と plugin (C) のどちらか。C は `vp check` のゲートに自然に載り、Vite+ の流儀 (`lint.jsPlugins`) に合うが、CLI 専用のセキュリティ検査は使えない。
6. 重複の整理: `web-xss` と同じ箇所を見る react-doctor の規則 (`no-eval`、`jsx-no-script-url`、`dangerous-html-sink`) を off にするか。Knip (ADR 0017) と重なる opt-in の規則 (`unused-*`、`circular-dependency`) を off のままにするか。
7. 対象の範囲: `routeTree.gen.ts`、`lint/`、`vite.config.ts` を `ignore.files` で外すか。標本のない今の規模で、いつ入れるか (今は tsx が 3 つ)。
8. 版の固定: pnpm の catalog に固定するか。0.x の破壊的変更への対応 (規則名の変更、既定の変更) を、Renovate の PR でどう確かめるか。
9. GitHub Action: 入れるなら commit SHA で固定するか。PR コメントに必要な `pull-requests: write` などの権限を、既存の workflow の方針 (ADR 0012、最小権限) とどう両立させるか。
10. Kiro の skill: 入れるなら、`.agents/skills` と `skills-lock.json` の流儀で取り込むか。`/doctor` の実行時の取得を外すか。
11. `react-doctor install` を使うか。使うなら hook と workflow の追加 (lefthook との衝突) を避ける option に限るか。
12. 範囲外の確認: 変更を `docs/` に反映する場合、`docs/web-frontend/static-analysis.md` に「React と jsx-a11y の plugin は有効にしていない」と書くか (今は書かれていない)。

## 未確認のこと

- 点数の式と閾値 (サーバー側で、docs にも式がない)。点数が日によって変わるか。
- Oxlint 本体 (Rust) の通信。`strace` がなく、Node.js の hook と network namespace での完走でしか確かめていない。
- 標本以外の実コードでの検出の質、誤検出の率、実行時間 (`apps/web` は tsx が 3 つ)。
- 標本から `eval` の行を消すと `no-derived-state` が出る理由。
- `--scope changed` が `full` より 1 件少ない理由。
- Nx の target として動かすこと、mise の `npm:` backend での導入。
- Knip の opt-in の規則 (`unused-*`)、`new Function`、文字列の `setTimeout`、`innerHTML` への代入の検出。
- Kiro で `/react-doctor` を実際に呼ぶこと。skill が Kiro の slash command に出るか。
- GitHub の contributor の数、変更履歴の破壊的変更の頻度。
- ライセンスの法的な解釈。
- 公式の GitHub Action (`@v2`) の中身の通信 (今回は CLI だけを動かした)。

## 出典

- react-doctor: [README](https://github.com/millionco/react-doctor/blob/main/README.md)、[LICENSE](https://github.com/millionco/react-doctor/blob/main/LICENSE)、[SKILL.md](https://github.com/millionco/react-doctor/blob/main/skills/react-doctor/SKILL.md)、[JSON report の仕様](https://github.com/millionco/react-doctor/blob/main/docs/json-report.md)、[warning exit code の設計メモ](https://github.com/millionco/react-doctor/blob/main/docs/warning-exit-code.md)、[リポジトリ](https://github.com/millionco/react-doctor)
- react-doctor の docs: [What is React Doctor?](https://react.doctor/docs)、[CLI reference](https://react.doctor/docs/reference/cli-reference)、[Config files](https://react.doctor/docs/configuration/config-files)、[ESLint & oxlint plugins](https://react.doctor/docs/configuration/eslint-and-oxlint-plugins)、[CI](https://react.doctor/ci)、[Data use](https://www.react.doctor/docs/legal/data-use)、[/doctor の指示書](https://www.react.doctor/prompts/react-doctor-agent.md)
- npm: [react-doctor](https://www.npmjs.com/package/react-doctor)、[oxlint-plugin-react-doctor](https://www.npmjs.com/package/oxlint-plugin-react-doctor)、[agent-install](https://www.npmjs.com/package/agent-install)
- Vite+ と Oxlint: [Vite+ Lint](https://github.com/voidzero-dev/vite-plus/blob/main/docs/guide/lint.md)、[Oxlint の config file reference](https://oxc.rs/docs/guide/usage/linter/config-file-reference.html)、[Oxlint の CLI](https://oxc.rs/docs/guide/usage/linter/cli.html)
- Kiro と GitHub: [Kiro: Skills](https://kiro.dev/docs/skills/)、[GitHub Actions: Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- このリポジトリ: `vite.config.ts` の `lint`、`pnpm-workspace.yaml` の catalog、`docs/web-frontend/static-analysis.md`、ADR 0001、0002、0009、0012、0014、0017、0018、0019、0020、0021
