# AI の E2E テスト framework e2e（TesterArmy）を、Playwright だけで書く E2E と比べる

## 問い

[Issue #222](https://github.com/yokozi-jp/agent-software-factory/issues/222) の調査。AI で E2E テストを書いて流す framework の e2e（[e2e.tester.army](https://e2e.tester.army/)）を、Playwright だけで書く E2E と比べる。調べること:

1. 仕組み（`agent.act` と `agent.assert`、決定的な locator との混在、記録と再生、engine の下）。
2. 決定性（再生が外れたときの挙動、flaky、CI、ゲート）。
3. 費用と運用（モデルの呼び出し先、token、CI の秘密、ローカル）。
4. 成熟度（ライセンス、版、公開日、組織、事例）。
5. このリポジトリとの合い方（検証環境の smoke、Vitest の browser mode、Better Auth の Cookie、i18n、axe-core）。
6. ほかの AI の E2E の道具（Playwright の MCP と test agents、Stagehand）との比較。

調べた日は 2026-10-26。決定は下さない（決定は [#223](https://github.com/yokozi-jp/agent-software-factory/issues/223) の仕事）。

読んだ版: npm `e2e` 0.21.3、`@e2e-dev/web` 0.15.3（どちらも `latest`）。GitHub は `tester-army/e2e` の `main`（commit `ec94174`、2026-10-26）。文書は同じ commit の `docs/*.mdx` で、公開先の `https://e2e.tester.army/docs/<名前>` と同じ内容。

## 要約

- 確かめた: e2e は TypeScript の test runner。`agent.act`（自然言語の操作）、`agent.assert`（自然言語の判定）と、決定的な `screen.getByRole(...)` と `expect(...)` を 1 つのテストに混ぜる。web の engine（`@e2e-dev/web`）は Playwright（`playwright-core` 1.64.1 に固定）で Chromium、Firefox、WebKit を動かす。
- 確かめた: `act` の操作は、後の検証（locator の assertion など）が通ると JSON で記録され、次の実行でモデルを呼ばずに再生される。`assert`、`waitFor`、`extract` は常にモデルを呼ぶ。
- 実測（/tmp、偽のモデルサーバ）: 記録した `act` は、モデルのサーバを止めても CI で再生して通った。UI が変わって再生が外れると、既定ではモデルに引き継ぎ（モデルがなければ `MODEL_PROVIDER_FAILED`、exit 3）、`--strict-cache` ではモデルを呼ばずに `REPLAY_STALE`（exit 2）で落ちた。
- 確かめた: Apache-2.0。TesterArmy, Inc. が保守する。リポジトリは 2026-07-22 作成で、約 3 か月。`e2e` の最新は 0.21.3（1.0 未満）。star は 11,920。成熟度は若く、API が変わる前提で見る（判断）。
- 判断: モデルを呼ぶ `act` と `assert` は、同じ入力でも結果が揺れる。ゲートにするなら、決定的な部分（locator と `expect`）と、`--strict-cache` で固定した再生を主にする形になる。記録の初回と、外れたときの再記録に、モデルの費用と人の確認が要る。
- 判断: このリポジトリの Playwright の E2E を置き換える根拠はまだ薄い。足す場合も、使い道を限る（例: 探索、記録の再生を strict で流す smoke）のが筋。決めるのは #223。

## 1. 仕組み

### API

- テストは `*.e2e.ts` に書き、`test`、`expect` を `e2e` から import する。fixture は `app`、`agent`、`screen`、`browser` など。`agent.act(...)`、`agent.assert(...)`、`agent.waitFor(...)`、`agent.extract(...)` が AI の 4 つの呼び出し（[How agent steps work](https://e2e.tester.army/docs/agent-steps)）。
- 決定的な部分は `screen.getByRole('status')` のような locator と、`expect(locator).toHaveText(...)`、`expect(browser).toHaveURL(...)`。同じテストに混ぜられる（[README](https://github.com/tester-army/e2e/blob/main/README.md)、[Caching](https://e2e.tester.army/docs/cache)）。
- locator と assertion は e2e 自身の API で、Playwright の `page` をそのまま渡すのではない。`frameLocator` など一部は Playwright の到達範囲を持つ、と書かれている（[Web engine reference](https://e2e.tester.army/docs/reference/web)）。既存の Playwright のテストをそのまま流せるわけではない（確かめた範囲では、取り込む手順は `docs/migrate/` にある。中身は読んでいない）。

### モデルが見るもの、できること

- モデルには、指示、params、完了した step、画面の text snapshot（role、name、text、状態の木）が渡る。生の HTML、Cookie、header、環境変数は渡らない。password の欄はマスクされ、設定した秘密の値は `<secret:name>` になる（[How agent steps work](https://e2e.tester.army/docs/agent-steps)）。
- `vision: true` で、マスクした screenshot を足せる（同）。
- 道具は `tap`、`type`、`press`、`select`、`scroll`、`navigate` など。モデルの呼び出しの `tools` を実際に見ると、`observe`、`tap`、`double_tap`、`hover`、`type`、`press`、`select`、`check`、`drag`、`upload`、`scroll`、`navigate`、`back`、`screenshot`、`*_at`（座標）、`complete_step` があった（実測、後述）。
- step には期限とモデル呼び出しの上限がある。25 回のモデル呼び出しで `complete_step` が来ないと `STEP_NO_CONCLUSION` で落ちる（実測）。

### 記録と再生

出典は [Caching](https://e2e.tester.army/docs/cache)。

- 記録の条件: `act` の後に検証（locator の matcher、engine の assertion、`locator.waitFor()`、`agent.assert`、`agent.waitFor`）が通ったとき、その attempt の終わりに保存する。`expect(value).toBe(...)`、`expect.poll`、`locator.textContent()`、`agent.extract`、次の `act`、「テストが通ったこと」は検証に数えない。検証がない `act` は `unconfirmed` で保存されず、毎回モデルが動く。
- 再生の条件（キー）: テスト名（`describe` を含む）、target、指示の文面、params、agent、プロジェクト ID、アプリの identity が同じ。テスト名の変更、ファイルの移動、指示の言い換えは miss になる。モデルを変えても、engine の版を上げても miss にならない（ただし新しい版が node を違うように解決すると再生時に miss）。`unique()` で包んだ値は再生時に現在の値に差し替わる。
- 再生の手順: 開始時の route が同じか確かめる。記録した control を role、name、test id、周囲の文脈で探して操作を繰り返す。終わりの route と、記録した変化（現れた control、消えた control）を確かめる。ここまでモデルを呼ばない。外れたら、モデルが現在の画面から引き継ぐ。
- 保存先: `.e2e/cache/<hash>.json`。操作、対象の説明、入力した値、step の要約、終了時の確認が入る。prompt、会話、screenshot、観測した木、秘密の値は入らない。ただし秘密でない入力値はそのまま保存される（同、[Security rules](https://e2e.tester.army/docs/reference/security)）。署名はない。
- モード: `read-write`（ローカルの既定）、`read-only`（CI で未設定のときの既定）、`off`（`--no-cache`）。
- 実測した記録の中身: 1 step の `tap button "Add item"` で、`recordedFor`（テスト、指示の digest）、`recordedBy`（provider と model）、`endAnchors`（`status "1 item"`）、`goneAnchors`（`status "0 items"`）などが入った JSON が 1 つできた。

### web の engine の下

- `@e2e-dev/web` の依存は `playwright-core` 1.64.1 だけ（`npm view @e2e-dev/web dependencies`）。文書も「Chromium、Firefox、WebKit を Playwright で動かす」と書く（[Working with the browser](https://e2e.tester.army/docs/browser)）。ブラウザは `npx @e2e-dev/web install <browser> --with-deps` か `e2e-web install` で入れる（同）。
- 別の engine: mobile（iOS、Android。agent-device 経由）、hosted browser（Kernel など）、自作の engine（[Writing an engine](https://e2e.tester.army/docs/writing-an-engine)）。
- 実測: 必要な共有ライブラリ（`libnspr4` など）が OS になければ、Playwright と同じく `ENGINE_FAILURE: browser launch failed ... libnspr4.so` で落ちる。root なしの手順は [#124](https://github.com/yokozi-jp/agent-software-factory/issues/124) の範囲で、今回は `apt-get download` した deb を `/tmp` に展開して `LD_LIBRARY_PATH` で通した。

## 2. 決定性

- 記録の再生はモデルを呼ばない。同じ記録と同じ画面なら、同じ操作を繰り返す（確かめた。実測の節）。
- `agent.assert`、`agent.waitFor`、`agent.extract` は常に、`act` が記録に外れたとき、記録のないときもモデルを呼ぶ（[Caching](https://e2e.tester.army/docs/cache)、[Continuous integration](https://e2e.tester.army/docs/ci)）。これらの判定は、同じ画面でもモデルの出力で揺れうる（判断。揺れの大きさは測っていない）。
- `waitFor` は画面が変わらない間モデルを呼ばない（[How agent steps work](https://e2e.tester.army/docs/agent-steps)）。
- 再生が外れたときの既定: 引き継ぎ（hand-off）か、最初からモデルが実行（miss）。実行ごとにモデルの費用がかかり続け、誰かが記録し直すまで続く。文書も、この点を `--strict-cache` の動機として書く（[Caching](https://e2e.tester.army/docs/cache#fail-on-a-stale-recording)）。
- `--strict-cache`（または `cache.strict`）: 記録が再生できなければ `REPLAY_STALE`（exit 2、再試行しない）で落ち、モデルを呼ばない。strict の実行は記録を書かず消さない。未記録の step（新規、指示の変更）は live で動く。
- exit code: `REPLAY_STALE` と環境、認証の問題は 2、環境の停止は 3、予算と期限は 1（[How agent steps work](https://e2e.tester.army/docs/agent-steps)、[Caching](https://e2e.tester.army/docs/cache)）。
- flaky: CI の既定は `retries: 1`、`workers: 1`。retry は再生せず、すべての goal を live で動かす（`--strict-cache` か `cache.strict` のときを除く）。CI の retry だけで通ったテストは report に flaky と記録される（[Continuous integration](https://e2e.tester.army/docs/ci)）。
- ゲート: 文書は、e2e の job を required check にし、`agent.act` を 1 つの goal にして検証を付け、記録を commit し、`--max-failures` と `--max-duration` で費用を抑えるよう勧める（[Continuous integration](https://e2e.tester.army/docs/ci#gate-pull-requests)）。非ゼロの exit が job を落とす。

### 実測（/tmp、モデルは偽のサーバ）

偽の OpenAI 互換サーバ（`@ai-sdk/openai-compatible` の向き先、自作）で、`add one item to the cart` を 1 回 `tap` して `complete_step` する応答を返させた。アプリは `Add item` ボタンと `status` を持つ 1 ページ。実装は本物のモデルではないので、「モデルの判断の質」は測れていない。測れたのは、記録と再生の機構と、外れたときの挙動。

| 実行 | 条件                                                                      | 結果                                                                                                   |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1    | ローカル（`read-write`）、記録なし、モデルあり                            | 通った。2 回のモデル呼び出し。`Cache: 1 missed`。`.e2e/cache/<hash>.json` が 1 つできた                |
| 2    | `CI=1`（`read-only`）、記録あり、モデルのサーバあり                       | 通った。`Cache: 1 replayed`。モデルの呼び出しは増えなかった（サーバのログで確認）                      |
| 3    | `CI=1`、記録あり、モデルのサーバを停止                                    | 通った。`1 replayed`                                                                                   |
| 4    | ボタンの名前を `Add product` に変え、`--strict-cache`、モデルのサーバ停止 | 落ちた。`REPLAY_STALE ... (target-not-found)`、exit 2                                                  |
| 5    | 同じ変更、strict なし、モデルのサーバ停止                                 | 落ちた。引き継ぎ先のモデルに届かず `MODEL_PROVIDER_FAILED`、exit 3                                     |
| 6    | 指示を `put an item in the cart` に変え、モデルのサーバ停止               | 落ちた。`MODEL_PROVIDER_FAILED`、exit 3（`--strict-cache` ありでも、未記録の step は live で動くため） |
| 7    | `agent` を使わない決定的なテストだけ、モデルなし                          | 通った。`model` の設定があっても呼ばれない                                                             |

- モデルを設定しない `agent` は `MODEL_UNAVAILABLE` になる（文書の記述。今回は実行していない）。
- 偽のモデルが何も操作せず `ok` とだけ返したとき、25 回の呼び出しで `STEP_NO_CONCLUSION` になった（実測）。

## 3. 費用と運用

- モデルの呼び出し先: AI SDK（`ai` パッケージ、peer dependency は `ai ^7`）の provider。Vercel AI Gateway（`gateway('openai/...')`、`AI_GATEWAY_API_KEY` か Vercel の OIDC token）、OpenRouter、各社の直接の API key、OpenAI 互換のローカル、サブスクリプション（ChatGPT、GitHub Copilot、OpenCode Console、SuperGrok、Claude Max か Team の API credit）。既定のモデルはなく、設定が必須（[Models](https://e2e.tester.army/docs/models)、[Subscriptions](https://e2e.tester.army/docs/subscriptions)）。モデルは tool call と画像に対応している必要がある（同）。
- token の費用: モデルと呼び出し回数で決まる。この調査では本物のモデルを呼んでいないので、金額は測っていない。実行の終わりに `AI  <tokens> · <n> model calls · <model>` と `Cache  <n> replayed · <n> handed off · <n> missed` が出る（[Caching](https://e2e.tester.army/docs/cache)）。公式サイトの推薦の投稿に「`npx e2e` で 0.60 ドル」という利用者の発言があるが、条件が不明な宣伝上の引用で、事実としては扱わない。
- CI の秘密: モデルの key を job の環境変数で渡す。文書の警告: key を持つ job は、テスト、config、依存のコードにそれを渡す。信頼できるブランチの build だけに渡し、信頼できない PR のコードは秘密も書き込み token もなしで動かす。GitHub は fork の PR に secrets を渡さない（[Continuous integration](https://e2e.tester.army/docs/ci)）。key には spending limit を付けるよう勧める（同）。
- 秘密の扱い: `Secret` はハンドルで、モデルは名前と目的だけを見る。runner が欄を確かめてから値を入力する。秘密を入力した後は、その attempt でモデルに screenshot を渡さない。video は何もマスクしない（[Security](https://e2e.tester.army/docs/security)）。
- 注意: モデルは origin の許可リストなしで、アプリから別のサイトに移れる。その step の秘密を使える（[Security](https://e2e.tester.army/docs/security)）。
- テレメトリ: 既定で on。`eu.i.posthog.com` に匿名の使用状況を送る。`E2E_TELEMETRY_DISABLED=1` か `DO_NOT_TRACK=1` で止める（[Telemetry](https://e2e.tester.army/docs/telemetry)）。また、端末で CLI を実行すると `registry.npmjs.org` に 1 日に 1 回まで新しい版を確かめに行く（[Security](https://e2e.tester.army/docs/security)）。
- ローカル: `npx e2e init`、`npx e2e run`。`app.command` でアプリの dev server を起動し、応答を待って、終わりに止める。`.e2e/` に report、junit.xml、trace、screenshot が出る（[Web](https://e2e.tester.army/docs/web)、[Continuous integration](https://e2e.tester.army/docs/ci)）。CI は Node 24.8 以上（22 系は 22.22.3 以上）が要る。このリポジトリの `.node-version` は 24.22.1 で満たす。
- 実行の道具: shard（`--shard i/n`、report の統合は未対応）、`--last-failed`、`--changed-since`（test filter）、`--max-failures`、`--max-duration`、GitHub の PR コメント用 reporter（`@e2e-dev/github`）（[Continuous integration](https://e2e.tester.army/docs/ci)）。

## 4. 成熟度

| 項目               | 事実                                                                                                                                                                                                | 出典                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ライセンス         | Apache-2.0（`LICENSE`、npm の `license`）。`NOTICE` は「Copyright 2026 TesterArmy, Inc.」                                                                                                           | [LICENSE](https://github.com/tester-army/e2e/blob/main/LICENSE)、[NOTICE](https://github.com/tester-army/e2e/blob/main/NOTICE)                                          |
| リポジトリ         | `tester-army/e2e`。作成 2026-07-22。最終 push 2026-10-26。star 11,920、fork 625、open issue 99。archive ではない                                                                                    | [GitHub API](https://api.github.com/repos/tester-army/e2e)                                                                                                              |
| 保守する組織       | TesterArmy, Inc.（README の「Made by TesterArmy」、NOTICE）。npm の maintainer は 2 人（okwasniewski、szymonrybczak）。組織の API 情報は取得に失敗した（EOF）ので、会社の規模や資金は未確認         | [README](https://github.com/tester-army/e2e#readme)、[npm: e2e](https://www.npmjs.com/package/e2e)                                                                      |
| 版                 | `e2e` 0.21.3（`latest`、リリース 2026-10-23）。nightly は 0.21.4 で毎日出る。`@e2e-dev/web` 0.15.3。1.0 未満                                                                                        | [npm: e2e](https://www.npmjs.com/package/e2e)、[npm: @e2e-dev/web](https://www.npmjs.com/package/@e2e-dev/web)、[Releases](https://github.com/tester-army/e2e/releases) |
| 公開日             | `@e2e-dev/web` の npm 公開は 2026-09-28。`e2e` の npm 名は 2014-12-16 から（前の持ち主の旧パッケージの名前を引き継いだ可能性。未確認）。リポジトリの shallow clone では 2026-10-26 の commit が最新 | `npm view e2e time.created`、`npm view @e2e-dev/web time.created`                                                                                                       |
| 依存               | `e2e`: `zod`、`commander`、`oxc-parser`、`@vitest/expect`、`@ai-sdk/provider`、`@modelcontextprotocol/server` など。peer: `ai ^7` と各 `@ai-sdk/*`                                                  | `npm view e2e dependencies peerDependencies`                                                                                                                            |
| 構成               | 同じ monorepo から `e2e`、`@e2e-dev/web`、`mobile`、`github`、`kernel`、`smol`、`testmu` などを出す                                                                                                 | [README](https://github.com/tester-army/e2e#readme)、[Releases](https://github.com/tester-army/e2e/releases)                                                            |
| 利用の事例         | 公式サイトの推薦の投稿は宣伝。第三者の本番での採用の事例は確かめられなかった。リポジトリの `examples/` に Vite、Next.js、Astro、Angular、Expo、SwiftUI、Compose、Flutter、MAUI などの例がある       | [e2e.tester.army](https://e2e.tester.army/)、[examples](https://github.com/tester-army/e2e/tree/main/examples)                                                          |
| セキュリティの窓口 | GitHub の security advisory と `security@tester.army`                                                                                                                                               | [SECURITY.md](https://github.com/tester-army/e2e/blob/main/SECURITY.md)                                                                                                 |

判断: 3 か月で star が約 1.2 万と、注目は大きい。一方で、1.0 前の版を毎日出している。API、記録の形式、キーの作り方が版で変わる前提で見るべき。文書も「`e2e` の更新が記録のキーを変えると、次の実行ですべて記録し直しになる」と書く（[Caching](https://e2e.tester.army/docs/cache#commit-the-replay-cache)）。

## 5. このリポジトリとの合い方

前提（このリポジトリ側の事実）: `docs/web-frontend/testing.md` は E2E に Playwright、component に Testing Library、A11y に axe-core を使うとする（取り込んだ規約）。ADR 0013 は、検証環境を常には置かず、ときどき作って E2E を流して消すとする。ADR 0022 は Better Auth の Cookie の BFF とし、「ブラウザ（Playwright）を通した E2E」はまだ確かめていないとする。

### 検証環境で流す E2E の smoke（#88）

- 合う点: URL を設定すれば既存のデプロイ先に向けられる（`app.url`）。プレビューが毎回変わる URL なら `app.identity` で記録の identity を固定できる。保護された環境には `headers` と `basicAuth` がある（[Web](https://e2e.tester.army/docs/web)）。JUnit と `.e2e/` を CI に上げられる。
- 懸念（判断）: smoke は短く、決定的で、費用が一定であるべき。e2e でも、`agent` を使わず locator と `expect` だけで書けば Playwright とほぼ同じ立場になる（実測 7）。`agent` を入れるなら、記録を commit して `--strict-cache` で流すのが、検証環境で費用を一定にする形。記録は検証環境でなくローカルで作る必要があり、記録を作る人とモデルの費用が別に要る。
- 検証環境のアドレスは毎回変わる。記録のキーはアプリの identity とテスト名で、port やホストでは変わらない（[Caching](https://e2e.tester.army/docs/cache)）。ただし、route に入る生成物（ID、timestamp）は placeholder として扱われ、それ以外のクエリは route の一部（同）。

### Vitest の browser mode の component test

- 関係は薄い。e2e は「起動済みのアプリ」を外から動かす E2E の道具で、component 単位のテストの代わりではない。`@vitest/expect` を assertion に使っているだけで、Vitest の runner ではない（`npm view e2e dependencies`）。テストトロフィーの方針（E2E は少量）にも沿う（`docs/web-frontend/testing.md`）。

### Better Auth の Cookie のログイン

- `test.setup` で 1 回ログインして `session.save('admin')` で名前付きの session（Cookie、local storage、IndexedDB）を保存し、他のテストは `{ session: 'admin' }` で復元する。session は 1 回の実行で有効で、runner がメモリ上の鍵で暗号化して後で消す（[Signing in](https://e2e.tester.army/docs/authentication)）。Playwright の `storageState` に近い形（判断）。
- `browser.setCookies([...])` でも Cookie を直接入れられる（[Working with the browser](https://e2e.tester.army/docs/browser)）。ただし ADR 0022 の `__Secure-` や `Domain` の違い、CSRF の確認が通るかは、今回は未確認（Better Auth を動かしていない）。
- 秘密（パスワード）は `credentials` と `Secret` で渡し、モデルには見せない。`session.save()` はログインの成否を確かめないので、保存前に assertion が要る（同）。

### i18n

- `web({ locale: 'de-DE', timezoneId: ... })` で locale と timezone を target ごとに指定でき、target を増やせば各 locale で全テストが動く（[Web engine reference](https://e2e.tester.army/docs/reference/web)、[Web](https://e2e.tester.army/docs/web)）。
- 懸念（判断）: `agent.act('...')` の指示は自然言語で、記録のキーは指示の文面。画面の文言が言語で変わると、モデルが見る text snapshot も変わる。日本語と英語の両方で `act` を書くなら、locale ごとに記録が別に要りそう。locator は role と name が言語で変わる。この点は今回は動かしていない。

### axe-core の検査

- 文書内に axe-core、a11y の検査の機能は見つからなかった（`grep` で `axe`、`a11y`、`accessib` を探して、mobile の locator と engine の記述だけ）。`browser.evaluate(...)` でページ内のコードを実行できるので、axe を注入する道はありそうだが、確かめていない。Playwright には `@axe-core/playwright` という標準的な手があり、そちらは `page` を直接使う（`docs/web-frontend/testing.md` の方針との整合も、Playwright のほうが取りやすい）。
- e2e は Playwright の `page` を公開していないので、`@axe-core/playwright` をそのままは使えない（文書の記述からの判断。`browser.evaluate` の制約は未確認）。

## 6. ほかの AI の E2E の道具との比較

| 観点           | Playwright だけ                                 | Playwright の test agents                                        | Playwright MCP                                                                                            | Stagehand                                                                                                                      | e2e（TesterArmy）                                  |
| -------------- | ----------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 何か           | 決定的な E2E の framework                       | planner、generator、healer の 3 つの agent。AI がテストを書く側  | MCP サーバ。AI が操作する                                                                                 | AI でブラウザを動かす SDK（`act`、`agent`、`extract`）                                                                         | AI の step と決定的な step を混ぜて流す runner     |
| テストの実体   | TypeScript のコード                             | 生成された Playwright のテストコード（実行時にモデルは要らない） | 実行ごとの会話（コードではない）                                                                          | スクリプトの中の `act` などの呼び出し                                                                                          | `*.e2e.ts` と `.e2e/cache` の記録                  |
| 実行時のモデル | 不要                                            | 不要（生成と修復のときだけ）                                     | 必要                                                                                                      | 必要（cache が当たれば不要）                                                                                                   | 記録が当たれば不要、`assert` は必要                |
| 再生の仕組み   | なし（コードが再生そのもの）                    | なし（コードが再生そのもの）                                     | なし                                                                                                      | local cache と Browserbase の server cache                                                                                     | 検証付きの記録の再生と、外れたときの引き継ぎ       |
| 外れたとき     | 落ちる                                          | healer が直す案を出す（実行時ではない）                          | —                                                                                                         | cache が外れるとモデルが呼ばれる                                                                                               | 既定は引き継ぎ、`--strict-cache` は `REPLAY_STALE` |
| 版（調べた日） | `playwright` 1.64.1、Apache-2.0                 | Playwright に同梱                                                | `@playwright/mcp` 0.0.83、Apache-2.0、star 38,644                                                         | `@browserbasehq/stagehand` 4.3.0、MIT、star 25,821                                                                             | `e2e` 0.21.3、Apache-2.0、star 11,920              |
| 保守           | Microsoft                                       | Microsoft                                                        | Microsoft                                                                                                 | Browserbase                                                                                                                    | TesterArmy, Inc.                                   |
| 出典           | [npm](https://www.npmjs.com/package/playwright) | [Playwright: Agents](https://playwright.dev/docs/test-agents)    | [npm](https://www.npmjs.com/package/@playwright/mcp)、[repo](https://github.com/microsoft/playwright-mcp) | [Caching](https://docs.stagehand.dev/v3/best-practices/caching)、[npm](https://www.npmjs.com/package/@browserbasehq/stagehand) | 前の節                                             |

- Playwright の test agents は、AI を「テストコードを作る時」に使い、流す時には使わない。決定性は Playwright のまま。healer は失敗したテストを読んで locator などの修正案を出す（[Playwright: Agents](https://playwright.dev/docs/test-agents)）。
- Stagehand の cache は 2 種類: Browserbase の server cache（`env: "BROWSERBASE"` のとき自動）と、`cacheDir` を指す local cache。local cache は commit して CI で共有できる、と書く。キーは指示、開始 URL、設定など（[Caching](https://docs.stagehand.dev/v3/best-practices/caching)）。e2e との違いは、e2e は「検証が通った step だけ」を記録し、`--strict-cache` で外れたら落とせる点（Stagehand の strict 相当の有無は今回確かめていない）。
- Playwright の MCP は、AI が対話的にブラウザを動かす道具で、テストを固定する仕組みではない（判断。README の全体は読んでいない）。

## 標準の慣行、出典、避けるアンチパターン

- 標準の慣行（判断を含む）: E2E は少数の重要な user journey に絞り、決定的な locator と assertion で書く（このリポジトリの取り込んだ規約 `docs/web-frontend/testing.md`、およびその元の [Webフロントエンド設計ガイドライン](https://future-architect.github.io/arch-guidelines/documents/forWebFrontend/web_frontend_guidelines.html)）。AI でテストを書く場合の公式の形は、Playwright の test agents のように「AI がコードを作り、流すのは決定的なコード」（[Playwright: Agents](https://playwright.dev/docs/test-agents)）。AI が毎回実行時に判断する形が標準だと示す一次情報は、確かめた範囲では見つからなかった。
- e2e 自身の推奨: `act` は 1 つの goal にし、直後に locator の assertion か `agent.assert` で検証する。記録を commit して review する。CI では `--strict-cache` を勧める。信頼できない PR に key を渡さない（[Continuous integration](https://e2e.tester.army/docs/ci)、[Caching](https://e2e.tester.army/docs/cache)）。
- 避けるアンチパターン（出典付き）:
  - 検証のない `act`: 記録されず、毎回モデルが動く（[Caching](https://e2e.tester.army/docs/cache)）。
  - 記録を commit せず、CI を `read-only` のまま空の cache で流す: 毎回すべてモデルを呼ぶ（同、[Continuous integration](https://e2e.tester.army/docs/ci)）。
  - 記録が外れても落とさない運用: 引き継ぎで通り続け、費用だけが毎回かかる（[Caching](https://e2e.tester.army/docs/cache#fail-on-a-stale-recording)）。
  - 信頼できない PR のコードがモデルの key に触れる設定（[Continuous integration](https://e2e.tester.army/docs/ci)）。
  - 秘密を `Secret` でなく普通の文字列で渡す: モデルへの screenshot が止まらず、redaction の対象にもならない（[Security](https://e2e.tester.army/docs/security)）。
  - 記録を見ずに共有する: 秘密でない入力値がそのまま入り、署名もない（[Security rules](https://e2e.tester.army/docs/reference/security)）。
  - 宣伝の引用（推薦の投稿、利用者の費用の発言）を根拠にする（判断）。

## docs/ との食い違い

- `docs/web-frontend/testing.md` は「E2E は Playwright」と書く。e2e も下では Playwright だが、API は別（`screen.getByRole`、`app.open`）。食い違いではなく、規約が AI の E2E の道具を想定していない。#223 で規約を直すか判断する。
- ADR 0022 の「Playwright を通した E2E は未確認」の項目は、この調査では解決していない。

## 決めるべき論点（#223 への入力）

1. 範囲: E2E の本体を e2e にするのか、Playwright を残して一部（探索、smoke、テストの下書き）にだけ使うのか。
2. AI を実行時に使うか、作る時だけに使うか。後者なら Playwright の test agents で足りるか。
3. ゲートにする条件: 決定的な部分だけをゲートにし、`agent.assert` は参考の結果にするか。`--strict-cache` を必須にするか。
4. 記録の運用: 誰が、いつ、どのモデルで記録し、commit する前に何を review するか。記録が外れたときの更新の流れ（PR でレビューするか）。
5. 費用の上限: 記録、`assert`、探索のモデルの費用の見積もり（この調査では未測定）と、key の置き場所、spending limit、CI の job の分け方。
6. モデルの呼び出し先: AI Gateway か直接か。データの扱い（画面の木、URL、画像がモデルの提供元に出る）が、案件の SI の要件と合うか。
7. 成熟度のリスク: 1.0 前で毎日 nightly が出る。版の固定、更新の頻度、記録の形式が変わったときの再記録の負担、供給元が止まったときの退路。
8. このリポジトリの検証環境の smoke（#88）との接続: 記録はどこで作り、検証環境ではどの mode で流すか。
9. Better Auth の Cookie、i18n、axe-core: `session` と `setCookies` で足りるか。axe は `browser.evaluate` で足りるか、Playwright 側に残すか。
10. 規約: `docs/web-frontend/testing.md` の E2E の項を変えるか。変えるなら取り込んだ規約の「原文からの変更点」に書く。
11. テレメトリと CLI の外部通信（PostHog、npm registry）を、このリポジトリの方針でどう扱うか。

## 比較表（まとめ）

| 観点                         | Playwright だけ               | e2e（TesterArmy）                                                                     |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| テストの書き方               | locator と assertion のコード | 自然言語の `act` と `assert`、locator と `expect` の混在                              |
| 実行時のモデル               | 不要                          | `act` が記録に当たれば不要。`assert`、`waitFor`、`extract` と、記録が外れたときは必要 |
| 決定性                       | コードのとおり                | 記録の再生は決定的。モデルの判定は揺れうる（判断）                                    |
| 外れたとき                   | 落ちる                        | 既定は引き継ぎ。`--strict-cache` は `REPLAY_STALE`（exit 2）                          |
| CI の費用                    | 実行時間のみ                  | 実行時間とモデルの費用（記録と `assert` の分）                                        |
| CI の秘密                    | 不要（アプリの秘密だけ）      | モデルの key が要る                                                                   |
| 保守の負担                   | locator の修正                | 記録の更新と review、指示の言い換えで miss                                            |
| ブラウザ                     | Chromium、Firefox、WebKit     | 同じ（Playwright を内部で使う）                                                       |
| 成熟度                       | 1.64.1、Microsoft、広い採用   | 0.21.3、TesterArmy, Inc.、2026-07 から                                                |
| Better Auth の Cookie        | `storageState` など           | `test.setup` と `session`、`setCookies`                                               |
| axe-core                     | `@axe-core/playwright`        | 文書に機能なし（未確認）                                                              |
| このリポジトリの規約との関係 | 規約どおり                    | 規約の変更が要る                                                                      |

## 未確認のこと

- 本物のモデルでの動作。API key がないので、`act` の成功率、`assert` の揺れ、1 回あたりの token と費用、引き継ぎの品質は測っていない。実測は偽のモデルサーバで、機構（記録、再生、外れたときの挙動）だけ。
- 本物のアプリ（このリポジトリの web、Better Auth、i18n）に対する動作。`session` と `setCookies` が Better Auth の Cookie（`__Secure-` の接頭辞、CSRF）で通るか。
- axe-core を `browser.evaluate` で注入できるか。
- 既存の Playwright のテストを移す手順（`docs/migrate/`）の中身。
- 組織としての TesterArmy, Inc.（規模、資金、料金の計画）。GitHub の組織の API が EOF で失敗した。公式サイトの `tester.army` は本文を取得できなかった。
- 第三者の本番での採用の事例。
- Stagehand の cache に strict 相当があるか。Playwright MCP の README の詳細。
- Windows、macOS での動作。
- `npm view e2e time.created` が 2014 年なのは、npm 上の名前の履歴。前の持ち主のパッケージだったかは確かめていない。

## 出典

- e2e: [公式サイト](https://e2e.tester.army/)、[Caching](https://e2e.tester.army/docs/cache)、[How agent steps work](https://e2e.tester.army/docs/agent-steps)、[Continuous integration](https://e2e.tester.army/docs/ci)、[Models](https://e2e.tester.army/docs/models)、[Subscriptions](https://e2e.tester.army/docs/subscriptions)、[Security](https://e2e.tester.army/docs/security)、[Security rules](https://e2e.tester.army/docs/reference/security)、[Signing in](https://e2e.tester.army/docs/authentication)、[Telemetry](https://e2e.tester.army/docs/telemetry)
- e2e のリポジトリ: [tester-army/e2e](https://github.com/tester-army/e2e)（commit `ec94174`）、[README](https://github.com/tester-army/e2e#readme)、[LICENSE](https://github.com/tester-army/e2e/blob/main/LICENSE)、[NOTICE](https://github.com/tester-army/e2e/blob/main/NOTICE)、[SECURITY.md](https://github.com/tester-army/e2e/blob/main/SECURITY.md)、[Web](https://e2e.tester.army/docs/web)、[Working with the browser](https://e2e.tester.army/docs/browser)、[Web engine reference](https://e2e.tester.army/docs/reference/web)、[Writing an engine](https://e2e.tester.army/docs/writing-an-engine)、[Releases](https://github.com/tester-army/e2e/releases)
- npm: [e2e](https://www.npmjs.com/package/e2e)、[@e2e-dev/web](https://www.npmjs.com/package/@e2e-dev/web)、[playwright](https://www.npmjs.com/package/playwright)、[@playwright/mcp](https://www.npmjs.com/package/@playwright/mcp)、[@browserbasehq/stagehand](https://www.npmjs.com/package/@browserbasehq/stagehand)
- 比較: [Playwright: Agents](https://playwright.dev/docs/test-agents)、[microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)、[Stagehand: Caching Actions](https://docs.stagehand.dev/v3/best-practices/caching)、[browserbase/stagehand](https://github.com/browserbase/stagehand)
- このリポジトリ: `docs/web-frontend/testing.md`、ADR 0013、ADR 0022、[#88](https://github.com/yokozi-jp/agent-software-factory/issues/88)、[#124](https://github.com/yokozi-jp/agent-software-factory/issues/124)、[#223](https://github.com/yokozi-jp/agent-software-factory/issues/223)
- 実測の作業場所: `/tmp/e2eprobe`（リポジトリの外。`node_modules` は増やしていない）
