---
type: Reference
title: Kiro CLI を GitHub Actions から動かせるか調べる
description: Kiro CLI を非対話で GitHub Actions から動かすための認証、費用、権限、出力を、インストール済みの CLI とエンジンのコード、代替ツールの公式資料で確かめた調査。
tags: [research, kiro-cli, github-actions, ci, code-review, claude-code-action, codex]
---

# Kiro CLI を GitHub Actions から動かせるか調べる

## 問い

[Issue #34](https://github.com/yokozi-jp/hono-nx-vite-plus/issues/34)：Kiro CLI を非対話で GitHub Actions から動かし、PR の AI レビュー、定期のドリフト検査と掃除の PR、docs の手入れに使えるか。観点は認証、費用、必要な権限、出力の形。代替（GitHub Copilot code review、Claude Code の GitHub Action、Codex など）も同じ観点で比べる。

## 要約

- Kiro CLI（インストール版 2.33.1）には非対話の実行経路がある。`kiro-cli chat --no-interactive` に、`--trust-all-tools` または `--trust-tools`、`--output-format stream-json`、`--agent`、`--model` を組み合わせられる。CLI の `--help` 出力が根拠。
- CI 向けの認証経路はエンジンのコードに実在する。環境変数 `KIRO_API_KEY`（`EnvAuthProvider`）、プレーンテキストのトークンファイル（`FileAuthProvider` の `machine_token`）、ACP 経由のトークン委譲（`AcpCallbackAuthProvider`、`--auth=acp-callback`）の 3 系統。`KIRO_API_KEY` はディスクに残らず、キー自体がリージョンを持たない。
- 対して `kiro-cli login` は OAuth（Builder ID、Identity Center、Google、GitHub のソーシャル、デバイスフロー）だけで、CI では非対話に完結しにくい。CI では API キーかマシントークンを使う前提になる。
- ただし「Kiro CLI を GitHub Actions で動かす公式の手順・GitHub Action・課金体系」を書いた一次資料は、今回アクセスできた範囲では確認できなかった（`kiro.dev` は TLS 検証に失敗し読めない）。費用と、API キーの発行手段は未確認。
- 代替のうち `anthropics/claude-code-action` と `openai/codex-action` は、公式リポジトリの README に GitHub Actions 向けの明確な手順、API キー認証、権限の最小化、`final-message` などの出力があり、Actions で動かす設計が公式に用意されている。
- GitHub Copilot code review は「CLI を Actions で動かす」ものではなく、GitHub.com 側のマネージドな PR レビュー機能。1 レビューあたり AI クレジット約 0.05〜5 USD の見積りが docs に明記され、エージェント機能は裏で GitHub Actions ランナーを使う。
- 判断に効く差：Kiro は Actions 用の公式 Action/手順が未確認なので自前で組む前提。Claude/Codex は公式 Action があり出力と権限が設計済み。Copilot code review は PR レビューだけなら設定が最も軽いがモデル選択や自前プロンプトは効かない。

## 比較

| 観点                         | Kiro CLI                                                                            | anthropics/claude-code-action                    | openai/codex-action                                      | GitHub Copilot code review                                            |
| ---------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Actions 用の公式 Action/手順 | 未確認（CLI 自体は非対話で動く）                                                    | あり（README に手順、`/install-github-app`）     | あり（README に PR ボット例）                            | Actions で CLI を動かすものではない（GitHub.com のマネージド機能）    |
| 非対話の起動                 | `chat --no-interactive --trust-all-tools --output-format stream-json`               | Action が内部で実行                              | Action が `codex exec` を実行                            | 不要（PR 作成/更新で起動）                                            |
| CI 認証                      | `KIRO_API_KEY`、machine_token ファイル、acp-callback、または OAuth（CI では非推奨） | Anthropic API キー/WIF、Bedrock、Vertex、Foundry | `OPENAI_API_KEY`（Azure も可）                           | Copilot ライセンス/組織ポリシー（API キー不要）                       |
| 費用の一次情報               | 未確認                                                                              | README に明記なし（プロバイダ課金）              | README に明記なし（OpenAI 課金）                         | 1 レビュー約 0.05〜5 USD の AI クレジット + Actions 分（docs に明記） |
| 権限の最小化                 | `--trust-tools` でツールを限定                                                      | docs に権限/MCP 設定                             | `permission-profile`、`safety-strategy`（sudo 剥奪など） | ランナー種別の選択、ルールセットで制御                                |
| 出力の形                     | `stream-json`（ACP イベントの JSON Lines）                                          | 構造化出力（JSON を Action outputs 化）          | `final-message` を step output に                        | PR のレビューコメント/承認                                            |
| モデル選択                   | `--model`、`--list-models`                                                          | `claude_args` で指定                             | `model`/`effort` 入力                                    | 不可（用途特化のモデル固定）                                          |

## Kiro CLI（インストール版 2.33.1）

- インストールされているのは 2 系統。`~/.local/bin/kiro-cli`（エージェントの CLI、`--version` で `kiro-cli 2.33.1`）と、PATH 上の `kiro`（VS Code 系の Kiro IDE、`Kiro 1.0.52`。`-d`、`-g` などエディタのフラグ）。GitHub Actions で使うのは `kiro-cli` の方。CLI の `--help` と `--version` の出力が根拠。
- 非対話の実行：`kiro-cli chat --help` に `--no-interactive`（「ユーザー入力を期待せずに実行する」）、`-a, --trust-all-tools`、`--trust-tools <TOOL_NAMES>`（例 `--trust-tools=fs_read,fs_write`、無指定で全ツール不許可）、`--output-format <text|stream-json>`（`stream-json` は「実行の ACP イベントを stdout に JSON Lines で出す。`--no-interactive` を含意」）がある。`--agent`、`--model`、`--effort`、`--require-mcp-startup`（MCP の起動失敗で終了コード 3）も指定できる。
- エンジンの版：`~/.local/share/kiro-cli/kas/` に `2.32.0-...` と `2.33.1-...` が入る。最新は `2.33.1-3f3c844506ab197a42642c02d2146abee3502698d196923d3cfcca56729c5dd2`。
- CI 向けの認証（エンジンのコードが根拠、最新版の `@kiro/agent/dist/server/` 配下の `.d.ts`）：
  - `env-auth-provider.d.ts`：`EnvAuthProvider` は既定で環境変数 `KIRO_API_KEY` を読む。コメントに「kiro-cli の `KIRO_API_KEY` フロー（`UnifiedBearerResolver`）を反映」「ディスクに保存しない」「API キーは人を指さずプロファイルを解決しない」とある。キー自体はリージョンを持たず、`ApiKeyRegionDiscovery` のプローブで発行リージョンを探る。`apiKey` を明示指定でき、AWS/Stripe/OpenAI の SDK 慣行に合わせる。空白のみの値は未設定扱い。
  - `file-auth-provider.d.ts`：`FileAuthProvider` は既定で `~/.aws/sso/cache/kiro-auth-token.json` の JSON トークンを読む。`authMethod: 'machine_token'` を指定すると、指定パスのプレーンテキストのアクセストークンを読む（人のサインインではなくマシンのトークン）。
  - `acp-callback-auth-provider.d.ts`：`--auth=acp-callback` で起動すると、ホスト（kiro-cli など）が OIDC のリフレッシュトークンを持ち、KAS はアクセストークンしか見ない。`_kiro/auth/getAccessToken` で取得。オンディスクの状態を持たない。
- 対話的なログイン：`kiro-cli login --help` は `--license <free|pro>`（free は Builder ID / Google / GitHub のソーシャル、pro は Identity Center）、`--identity-provider`、`--region`、`--use-device-flow`（ブラウザのリダイレクトが扱えない環境向けの OAuth デバイスフロー）だけ。API キーを渡すフラグはログインには無い。CI では `login` ではなく `KIRO_API_KEY` かマシントークンを使う形になる。
- cloud サンドボックス：`chat --cloud`（V3/KAS 専用）と `--repo <owner/name>` がある。`--no-interactive` と併用でき、`session/new` に `_meta.kiro.executionTarget` を送る。ローカルのランナーではなくクラウドで実行する経路だが、GitHub Actions からの使い方は未確認。
- 判断：非対話の実行と API キー認証は実装としてそろっているので、GitHub Actions のステップで `KIRO_API_KEY` をシークレットに入れ、`kiro-cli chat --no-interactive --output-format stream-json --trust-tools=...` を呼ぶ形は原理的に組める。標準の慣行（公式が用意した GitHub Action や Marketplace のアクション）があるかは未確認。避けたいアンチパターン：対話の `login` を CI で回そうとすること（デバイスフローは人手が要る）と、`--trust-all-tools` を無防備に使うこと。出典：`kiro-cli chat --help`、`kiro-cli login --help`、`kiro-cli --version`（ローカル実行、2026-10-23）、`~/.local/share/kiro-cli/kas/2.33.1-.../node_modules/@kiro/agent/dist/server/{env-auth-provider,file-auth-provider,acp-callback-auth-provider,api-key-region-probe}.d.ts`。

## anthropics/claude-code-action

- 公式リポジトリの README（`https://raw.githubusercontent.com/anthropics/claude-code-action/main/README.md`、2026-10-23 取得）に、GitHub の PR と issue 向けの汎用アクションと明記。`@claude` メンション、issue のアサイン、明示プロンプトの自動化でモードを自動判定する。
- 認証：Anthropic 直の API（API キーまたは workload identity federation）、Amazon Bedrock、Google Vertex AI、Microsoft Foundry に対応。
- 実行場所：アクションは自分の GitHub ランナー上で全て実行される（API 呼び出しは選んだプロバイダへ）。
- 出力：構造化出力（検証済み JSON が自動で GitHub Action の outputs になる）。進捗はチェックボックスで表示。
- 用途：自動 PR レビュー、パス限定レビュー、外部コントリビュータのレビュー、定期メンテナンス、issue トリアージ、docs 同期、セキュリティ重視レビューの例が Solutions ガイドにある（ドリフト検査や掃除 PR、docs 手入れに合致）。
- セットアップ：`claude` で `/install-github-app` を実行する方法（Anthropic 直の API のみ。Bedrock/Vertex/Foundry は別手順）。リポジトリ管理者権限が必要。
- 判断：GitHub Actions での利用は公式に設計されており（標準の慣行＝anthropics 公式リポジトリと docs）、PR レビュー・定期メンテ・docs 同期という Issue #34 の用途をそのまま満たす。費用そのものの数値は README に無い（プロバイダ課金のため別途確認）。

## openai/codex-action

- 公式リポジトリの README（`https://raw.githubusercontent.com/openai/codex-action/main/README.md`、2026-10-23 取得）に、ワークフローから Codex を動かし、権限を厳しく制御するアクションと明記。Codex CLI のインストールと Responses API へのセキュアなプロキシ設定を担う。
- 認証：プロバイダの API キーを GitHub Actions のシークレットで渡す（`OPENAI_API_KEY`、Azure なら `AZURE_OPENAI_API_KEY` + `responses-api-endpoint`）。
- 権限：`permission-profile`（`:workspace`、`:read-only`、名前付きプロファイル。beta、Codex CLI 0.138.0 以上が必要）と `safety-strategy`（`drop-sudo` 既定で sudo と root 所有ソケットを剥奪、`unprivileged-user`、`read-only`、`unsafe`）。Windows ランナーはサンドボックス未対応で `unsafe` のみ。
- 出力：`final-message`（`codex exec` の最終メッセージ）を step の output に取り、別ジョブで PR コメントに投稿する例がある。
- 入力：`prompt`/`prompt-file`、`model`、`effort`、`output-schema`、`codex-args`、`allow-users`/`allow-bots`（書き込み権限チェックのバイパス制御）など。
- 用途：README の例が「PR 作成時にレビューしてコメントする自前のレビューボット」。ドリフト検査・掃除 PR・docs 手入れも `prompt` と権限プロファイルで組める。
- 判断：GitHub Actions 向けの公式アクションで、権限最小化（sudo 剥奪、読み取り専用プロファイル）が設計の中心。費用の数値は README に無い（OpenAI 課金）。避けたいアンチパターン：README が警告する通り、信頼できないチェックアウトから `config.toml` や名前付きプロファイルを読ませること、不要に `unsafe` を使うこと。

## GitHub Copilot code review

- 公式 docs（`https://docs.github.com/en/copilot/concepts/agents/code-review`、`.../how-tos/.../configure-code-review`、2026-10-23 取得、版 free-pro-team@latest）。
- 位置づけ：これは「CLI を Actions で動かす」仕組みではなく、GitHub.com 側のマネージドな PR レビュー機能。対応面は GitHub.com、GitHub CLI、GitHub Mobile、VS Code、Visual Studio、Xcode、JetBrains、Azure DevOps（public preview）。
- トリガ：既定では Copilot をレビュアに割り当てたときだけ。自動レビューは、ユーザー設定（Copilot Pro/Pro+/Max、または Business/Enterprise ライセンス）、リポジトリ所有者、組織所有者が設定でき、ルールセットでも設定できる。ユーザー設定とルールセットは独立で、どちらかが有効なら自動レビューが走る（両方有効でもレビューは 1 回）。
- 費用：1 レビューあたり「Lite」で約 0.05〜1 USD、「Balanced」（既定）で約 0.25〜5 USD の AI クレジットという見積りが docs に明記。これに GitHub Actions 分は含まない。モデルと処理トークン数で変わる。
- GitHub Actions の関与：エージェント機能（プロジェクト全体のコンテキスト収集、Copilot cloud agent への修正提案の受け渡し）は裏で GitHub Actions ランナーを使う。既定は標準の GitHub ホストランナー。大きいランナーは単価が高く、セルフホストは Actions 分を消費しない。Actions が無効でも使えるが、ホストランナーを無効にしていると機能が限定される。
- 権限/制御：組織の Copilot ポリシーで `Copilot code review` を有効化する必要。外部ライセンスでのレビュー要求は「Only allow Copilot code review to be triggered by authorized users」で禁止できる。モデル切り替えは非対応（用途特化のモデル固定）。`.github/copilot-instructions.md`、パス別 `*.instructions.md`、`AGENTS.md`、skills、MCP（GitHub と Playwright は既定で有効）を読む。
- 判断：PR の AI レビューだけが目的なら、API キー不要で設定が最も軽い（標準の慣行＝GitHub 公式機能）。一方で「定期のドリフト検査」「掃除の PR 作成」「docs の手入れ」のような自由なタスク実行には向かず、モデルも固定。Issue #34 の用途全体はカバーしない。

## 未確認のこと

- Kiro CLI を GitHub Actions で動かす公式の手順・GitHub Action・Marketplace のアクションの有無。`kiro.dev` は TLS 検証に失敗して読めず、一次資料にアクセスできなかった。
- `KIRO_API_KEY` の発行方法（どの画面/コマンドで発行するか）と、キーのリージョンの扱いの運用面。
- Kiro CLI の費用体系（従量課金か定額か、無料枠の有無）。一次資料未確認。
- `--cloud`/`--repo` のクラウドサンドボックスを GitHub Actions から使えるか、使う場合の認証と費用。
- claude-code-action と codex-action の実際の料金（各プロバイダの課金に依存。本調査では数値を確認していない）。
- GitHub には別途「Copilot CLI in Actions」「Automate with Actions」という docs があるが、これは GitHub 自身の Copilot CLI（Kiro CLI とは別製品）の話。混同しないこと。詳細は未確認。

## 出典

- Kiro CLI（ローカル実行、2026-10-23）：`kiro-cli --version`（`kiro-cli 2.33.1`）、`kiro-cli --help-all`、`kiro-cli chat --help`、`kiro-cli login --help`、`kiro-cli whoami --help`、`kiro-cli agent --help`。
- Kiro エンジン（最新版 2.33.1、一次資料）：`~/.local/share/kiro-cli/kas/2.33.1-3f3c844506ab197a42642c02d2146abee3502698d196923d3cfcca56729c5dd2/node_modules/@kiro/agent/dist/server/env-auth-provider.d.ts`、`file-auth-provider.d.ts`、`acp-callback-auth-provider.d.ts`、`api-key-region-probe.d.ts`。環境変数の一覧は同 `dist/` 配下の grep（`KIRO_API_KEY` ほか）。
- anthropics/claude-code-action README：`https://raw.githubusercontent.com/anthropics/claude-code-action/main/README.md`（2026-10-23 取得）。
- openai/codex-action README：`https://raw.githubusercontent.com/openai/codex-action/main/README.md`（2026-10-23 取得）。
- GitHub Copilot code review：`https://docs.github.com/en/copilot/concepts/agents/code-review`、`https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-code-review`（2026-10-23 取得、版 free-pro-team@latest）。
