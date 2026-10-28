# e2e の create 系 skill と、AI が実アプリを動かして確かめる使い方

## 問い

[Issue #304](https://github.com/yokozi-jp/agent-software-factory/issues/304) の調査。[E2E テストの道具を決める (#223)](https://github.com/yokozi-jp/agent-software-factory/issues/223) の利用者が、e2e（TesterArmy）を「CI で回す E2E」ではなく、「AI が開発した後、E2E を書く前に、実際にアプリを動かして確かめる」用途で採りたいと言った。この用途で何が使えるかを調べる。決定は下さない（決定は #223）。

調べた日は 2026-10-28。読んだ版は `tester-army/e2e` の `main`（commit `d2ffb31`、2026-10-28）、`packages/e2e` 0.21.3、Apache-2.0。文書は同じ commit の `docs/*.mdx`。Playwright の文書は <https://playwright.dev/docs/test-agents>。e2e 自体は実行していない（モデルの API key がない）。

## 要約

- 確かめた: 利用者が言った「create-なんちゃら」は `create-verification-skill`。e2e のリポジトリの `skills/` にある 3 つの skill（`e2e`、`create-verification-skill`、`migrate-to-e2e`）の 1 つで、アプリごとの `verify-<app>` skill を生成する。Cursor の poteto（pstack）の同名の skill を元にしている（`docs/coding-agents.mdx`）。
- 確かめた: 「形式的検証」ではない。数学的な証明ではなく、「コーディングエージェントが、変更をユーザーが見るとおりに実アプリで示す」手順を skill にしたもの（`create-verification-skill/SKILL.md` の冒頭）。e2e のサイトの言葉は「verification-engineering」（推薦コメントの引用）。
- 確かめた: 生きたアプリを操作するのは `e2e mcp`（MCP サーバ）。**サーバにモデルは要らない**（`docs/mcp-server.mdx`）。Kiro などのエージェント自身が操作を決める。`e2e explore` と、録画のない `agent.act` だけがモデル（AI Gateway などの key）を要る。
- 確かめた: MCP は Claude Code、Codex、Cursor の設定例がある。Kiro の記載はない。MCP の標準（stdio）なので Kiro の `mcp.json` に書けるはずだが、動かしていない（判断）。
- 確かめた: 実アプリで確かめた操作は、そのまま決定的な `screen.getByRole(...)` のテストの行になって返る。locator は画面で 1 つに絞れたものだけ。これは「確認してから E2E を書く」用途に合う。ただし、書き出されるのは e2e の API（`*.e2e.ts`）で、Playwright の `.spec.ts` ではない。
- 確かめた: 同じ用途の Playwright 公式の道具（test agents の planner と generator、Playwright MCP）がある。出力は Playwright の `.spec.ts`。
- 判断: 開発中の確認の用途なら、e2e の弱点（CI のゲートにする場合の `assert` のモデル呼び出し、`page` の非公開）は効かない。ただし最終的な E2E のコードの書式が e2e の API になるか Playwright になるかが、#223 の残りの論点。

## 1. 付属の skill

| skill                       | 何をするか                                                                                                                                                                                                               | 出典                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `e2e`                       | e2e のテストを書く、流す、直す。生きたアプリを MCP で操作する。bug bash（`e2e explore` を並列に流し、見つけた bug を失敗するテストで証明する）                                                                           | `skills/e2e/SKILL.md`                       |
| `create-verification-skill` | プロジェクトに `.agents/skills/verify-<app>/` を生成する。起動と確認のコマンド（Launch、Doctor）、操作の 2 つの道（MCP、テスト）、証拠の残し方、機能の地図（機能ごとの explore の charter）。生成後に 1 回通して証明する | `skills/create-verification-skill/SKILL.md` |
| `migrate-to-e2e`            | Playwright、Cypress、Selenium、Detox、Maestro の既存の suite を、1 回に 1 つの slice ずつ e2e に移す                                                                                                                     | `skills/migrate-to-e2e/SKILL.md`            |

入れ方（`docs/coding-agents.mdx`）:

- `npx e2e init` が、`.agents/skills/e2e/`（Claude Code 用に `.claude/skills/e2e/` の symlink）と MCP の設定（`.mcp.json`、`.cursor/mcp.json`）を書く。
- `npx skills add tester-army/e2e --skill create-verification-skill` で個別に入れる。入れた後、エージェントに `/create-verification-skill` を頼む。
- Claude Code と Codex には plugin marketplace がある（`claude plugin marketplace add tester-army/e2e`）。Kiro 用の入れ方は書かれていない。`.agents/skills` を読む実行環境では `skills add` で足りる可能性があるが、Kiro が読む場所（`.kiro/skills`）に置けるかは確かめていない。

### `create-verification-skill` が生成する物

`SKILL.md` の手順（要約）:

1. リポジトリを調べる（ユーザーに聞くのは観察できないことだけ）。対象の面（Web UI、モバイル、API）、起動のコマンド、e2e の設定の有無、副作用が残る場所、分離（port 0 で実行ごとに別のアプリ）、名前。
2. `verify-<app>/SKILL.md` を書く。節は Read first、Launch、Doctor、Drive、Evidence、Bug bash、Cleanup、Helpers。
3. `features/` に機能の地図を作る。機能ごとに、経路、駆動のしかた、期待する終状態（Proof）、charter、Gotchas。
4. 生成した skill を 1 回通して証明する（Doctor、1 つの機能、1 つの charter の bug bash、Cleanup）。通っていない skill は「下書き」として扱う。
5. 引き渡し。コミットはしない。作った物を列挙する。

Proof の基準（`SKILL.md`）: 内部の setter やテスト専用の endpoint を使わず実際のユーザーの経路で操作する。操作と結果の状態の両方を残す。副作用（ファイル、DB の行、送られたメッセージ）は保存先で確かめる。外部システムは、本番の境界で分離されている場所だけモックする。

CLI や library、バッチなど操作できる面がないプロジェクトでは、何も生成せずに止まる。

### 実行時に使う道具

- `e2e mcp`（`docs/mcp-server.mdx`）: `open_session`、`observe`、`locate`、`run_code`、`test_lines` など。操作ごとに「その操作を繰り返すテストの行」が返り、`test_lines` で下書きのテスト本文が得られる。assertion は `run_code` でセッション内で試し、通った行が下書きに入る。録画（video）と screenshot も取れる。
- `e2e explore '<目的>'`（`docs/explore.mdx`）: テストファイルなしで、目的を渡すとエージェントが計画して操作し、findings と評価を出す。`agent.act()` と同じモデルと道具を使う。モデルが要る。
- bug bash（`docs/bug-bash.mdx`）: 複数の explore を並列に流し、コーディングエージェントが findings ごとに失敗するテストを書く。失敗した場合だけ bug として報告する。アプリが複数の explorer を同時に受けられること（port 0 か `reuseExisting`）が前提。各 explore はモデルの呼び出しを使い、実行の最後に token、費用、時間が出る。**公開中のサイトでデータを変えない**注意がある。

## 2. 認証、秘密、テレメトリ

- 認証（`docs/authentication.mdx`）: 設定用のテスト（`test.setup`）でログインして名前付きのセッションを保存し、ほかのテストが復元する。パスワードなどの秘密は `credentials.user('admin')` のハンドルで、モデルへの入力と報告には `<secret:name>` と出る（限界は `reference/security` の「Where redaction stops」）。Better Auth の Cookie（ADR 0022）のログインに合うかは確かめていない（画面のフォームでログインする形なら動くはず。判断）。
- テレメトリ（`docs/telemetry.mdx`）: 既定で有効。コマンド、engine、機能の使用と失敗の場所を送る。テストの内容、アプリの内容、認証情報は送らないと明記。`E2E_TELEMETRY_DISABLED=1`、`DO_NOT_TRACK=1`、`e2e telemetry disable` のどれかで止まる。送る内容は `E2E_TELEMETRY_DEBUG=1 npx e2e run` で見られる。`e2e feedback` は `telemetry disable` では止まらず、`E2E_TELEMETRY_DISABLED=1` か `DO_NOT_TRACK=1` で止まる（`reference/cli.mdx`）。
- モデル: `e2e mcp` だけなら不要。`explore`、bug bash、録画のない `agent.act` に要る。既定の設定は Vercel AI Gateway（`e2e init` が書く）。ほかに、サブスクリプションのログイン（`docs/subscriptions.mdx`、中身は未読）がある。

## 3. Playwright 公式の同じ用途の道具

出典: <https://playwright.dev/docs/test-agents>。

- `npx playwright init-agents --loop=vscode`（ほかに Claude Code、Codex、OpenCode）で、planner、generator、healer の定義を入れる。Kiro は選択肢にない。
- planner がアプリを探索して Markdown の計画（`specs/`）を出し、generator が計画を `.spec.ts` にして画面で locator と assertion を確かめながら書き、healer が失敗したテストを直す。
- 出力は通常の Playwright のテストで、実行時にモデルは要らない。計画の Markdown も残る。
- e2e の `create-verification-skill` との違い: Playwright の側は「テストを書く」までの道具。e2e の側は、確認の手順そのものを skill として残し、bug bash と証拠の保存まで含む。

## 4. 比較（この用途に限る）

| 観点                      | e2e（`e2e mcp`、`create-verification-skill`）  | Playwright の test agents / MCP                                 |
| ------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| 出力するテスト            | e2e の API（`*.e2e.ts`）                       | Playwright（`.spec.ts`）。`docs/web-frontend/testing.md` と一致 |
| 確認の手順を skill に残す | する（`verify-<app>`、機能の地図、charter）    | しない（計画は `specs/` の Markdown）                           |
| bug bash（並列の探索）    | ある。失敗するテストで証明する                 | ない（確かめた範囲）                                            |
| 実行時のモデル            | MCP は不要。explore は必要                     | 生成時のみ                                                      |
| 成熟度                    | 0.21.3、約 3 か月                              | Playwright 本体の機能（Microsoft）                              |
| Kiro から                 | MCP の設定を手で書く。skill の置き場所は未確認 | `init-agents` に Kiro はない。MCP は Playwright MCP を手で登録  |
| テレメトリ                | 既定で送る（止められる）                       | 本調査では未確認                                                |

## 5. アンチパターンと注意

出典は skill 自身の注意と、先の調査 [#222](https://github.com/yokozi-jp/agent-software-factory/issues/222) の結果。

- 確認の結果を「通った」とだけ報告し、証拠（trace、video、副作用の保存先）を残さない。skill は Evidence の節で証拠を残すことを求める。
- 生成した skill を一度も通さずに渡す。skill 自身が「下書き」と呼ぶ。
- 公開中のサイトや共有の DB に対して bug bash を流す。
- モデルの判定（`agent.assert`）だけをゲートにする。この用途の外だが、確認用の道具を CI にそのまま持ち込む誘惑がある。
- 0.x の API に依存して、生成した skill やテストが版で壊れる。`e2e upgrade` があるが、互換の保証は 1.0 未満では読み取れない。

## 6. 確かめられなかったこと

- e2e の実際の動作（API key がなく、`init` も `explore` も実行していない）。MCP の応答、生成される skill の質、費用。
- Kiro で skill と MCP が動くか（`.kiro/skills` に置けるか、`mcp.json` の書式）。
- Better Auth の Cookie のログイン、このリポジトリの web、i18n、axe-core での動作。
- Playwright MCP と test agents の実際の質、Stagehand など他の道具、テレメトリ。
- `docs/migrate/`、`docs/subscriptions.mdx`、`reference/security` の中身。

## 7. 決めるべき論点（#223 へ）

1. 開発中の確認（E2E を書く前）に使う道具を、e2e の `e2e mcp` + `create-verification-skill` にするか、Playwright の test agents / MCP にするか、併用するか。
2. 確認の後に残るテストのコードを、e2e の API にするか Playwright にするか。CI のゲートの E2E は Playwright と先に決めたので、e2e で確かめた内容を Playwright に写すなら、確認の用途だけ e2e を使う形になる。
3. Kiro で動かせるかを、採る前に小さく確かめる必要がある（実施の最初の作業）。
4. テレメトリを止める設定を、採る場合の標準にするか。
