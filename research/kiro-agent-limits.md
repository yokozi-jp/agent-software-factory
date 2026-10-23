# Kiro でエージェントに何を制限できるか調べる

## 問い

[Issue #32](https://github.com/yokozi-jp/hono-nx-vite-plus/issues/32)。インストール済みの Kiro のエンジンのコードを正として、tool の許可と拒否、hook（PreToolUse など）で止められる操作、MCP の server と tool の許可リスト、サンドボックス、同じ失敗の繰り返しを hook で検出できるか、を調べる。

一次資料のファイル: `~/.local/share/kiro-cli/kas/2.33.1-3f3c844506ab197a42642c02d2146abee3502698d196923d3cfcca56729c5dd2/node_modules/@kiro/agent/dist/server/acp-server.js`（版 2.33.1、ビルド済みの1枚もの。以下「エンジン」と書く）。introspect のドキュメントは版が古く、KAS エンジンが使わない項目を載せていた（後述の「未確認のこと」と比較表を参照）。食い違いはエンジンのコードを正とした。

## 要約

- エンジンの制限の軸は4つある。(1) tool の有効化（`tools` / `excludedTools`）、(2) 許可ルール（`permissions.rules`、効果は `allow` / `deny` / `ask` / `evaluate`）、(3) hook（`PreToolUse` などで止める）、(4) MCP server と tool の有効・無効。これらはカスタムエージェントの設定スキーマ `URr` に全部ある（関数名 `URr`、`permissions:xTi`）。
- 許可ルールの `capability` に使える値は固定の集合 `Cha`: `all` `builtin` `filesystem` `fs_read` `fs_write` `shell` `web_fetch` `web_search` `mcp` `subagent` `skill` `power` `context` `diagnostics` `workflow` `sandbox_network`（文字列 `Cha=new Set([...])`）。
- ルールの衝突は `deny` > 明示の `ask` > `ask` > `evaluate` > 先頭、の順で解決する（関数 `Uue`）。`shell` などは `match`/`exclude` にコマンドのグロブ（`git log *`、`npm audit` に対する `exclude:["npm audit fix*"]` など）を書ける。
- hook のトリガーは `Pxo` に凍結列挙されている: `SessionStart` `SessionEnd` `Stop` `PreToolUse` `PostToolUse` `PreTaskExec` `PostTaskExec` `UserPromptSubmit` `PostFileCreate` `PostFileSave` `PostFileDelete` `Manual`。止められる（exit 2 で block）のは `UserPromptSubmit` `PreToolUse` `PreTaskExec` の3つだけ（関数 `Yjr`）。
- `PreToolUse` は exit 2 で拒否、または exit 0 の stdout に `{"hookSpecificOutput":{"permissionDecision":"ask",...}}` を返すとユーザーに確認を出せる（関数 `p_u`）。`Stop` は exit 1 か `{"decision":"block"}` で続行を促せる（関数 `m_u` / `f_u`）。
- MCP は server 単位で `disabled`、tool 単位で `disabledTools` と `autoApprove` を持つ（スキーマ `gRa` / `wRa`）。これはこのリポジトリの `.kiro/settings/mcp.json`（iwe の `disabledTools` 8個）と一致する。
- 「サンドボックス」はエンジンでは2つの別物を指す。(1) 実行環境の種類 `local` / `sandbox`（`sandbox` は `kiro-web` クライアント、`FYt=["local","sandbox"]`）、(2) 許可 capability の `sandbox_network`（ネットワーク送信先のグロブを `allow`/`deny` する、関数 `vRe`）。tool 1つずつを OS レベルで隔離する仕組みは、このファイルには見当たらない（未確認）。
- 「同じ失敗の繰り返し」をエンジンが検出して止める仕組みは見当たらない。`consecutiveFailures` はネットワーク publish のリトライ用で、tool 呼び出しの失敗ではない。「same failure」はプロンプト文（モデルへの助言）だけ。判断: PostToolUse hook が自前で回数を数える以外にない。

## 比較

| 制限の軸       | 設定の場所（キー）                                 | 効果・値                                                                     | 一次資料（関数・文字列）                           |
| -------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| tool の有効化  | `tools`, `excludedTools`                           | tool 名・グロブ・`@server` を有効/除外                                       | `URr`（`tools:T.union([...])`、`excludedTools`）   |
| 許可ルール     | `permissions.rules[]`                              | `capability` + `match`/`exclude` + `effect`(`allow`/`deny`/`ask`/`evaluate`) | `xTi`、`Uue`、`Cha`                                |
| 許可プリセット | `permissions.policies[]`（`"preset:<id>"`）        | 既定の束を参照                                                               | `mBo`（id の Map）、`hBo`（`/^preset:(\S+) in /`） |
| hook           | `hooks[]`（agent 設定）または `.kiro/hooks/*.json` | 12 トリガー。止めるのは Pre 系3つ                                            | `Pxo`、`Yjr`、`f8e`（executor）                    |
| MCP server     | `mcpServers.<name>.disabled`                       | server ごと読み込み無効                                                      | `wRa`（`disabled:T.boolean()`）                    |
| MCP tool       | `mcpServers.<name>.disabledTools` / `autoApprove`  | tool 名の配列で無効化/自動承認                                               | `gRa`（`disabledTools`, `autoApprove`）            |
| ネットワーク   | `permissions` の `capability:"sandbox_network"`    | 送信先グロブを allow/deny                                                    | `vRe`、`Cha` に `sandbox_network`                  |
| 実行環境       | クライアント種別                                   | `local` / `sandbox`(=kiro-web)                                               | `FYt=["local","sandbox"]`、`Efe`                   |

## tool の有効化と除外（`tools` / `excludedTools`）

カスタムエージェントのスキーマ `URr`（`acp-server.js`、`var ...URr=T.object({...})`）に `tools:T.union([T.string(),T.array(T.string())]).optional()` と `excludedTools:T.array(T.string()).optional()` がある。`includeMcpJson`（既定 `false`）と `includePowers`（既定 `false`）も同じスキーマにある。tool 名のグロブ判定は `JP`（`e.includes("*")||e.includes("?")`）。

tool 名・タグと capability の対応は `kha`（`[{tag:rt.MCP,capability:"mcp"},{tag:rt.POWERS,capability:"power"},{tag:rt.SUBAGENT_META,capability:"subagent"},{tag:rt.CONTEXT,capability:"context"}]`）。capability の全集合は `Cha`（上記）。

判断: tool を絞るときは、まず `tools` で有効な集合を定め、危険なものは `excludedTools` で外し、さらに `permissions` の `deny` で二重に塞ぐのが、エンジンのスキーマに沿う。標準の慣行かどうかはエンジン内に明記がないので、ここは判断。避けたいアンチパターンは、`allowedTools` や `toolsSettings.shell.allowedCommands` を書くこと。KAS エンジンはこれらを「サポートしない項目」として扱い、エージェントの読み込みに失敗して既定エージェントにフォールバックする（文字列 `bTi=["allowedTools","toolsSettings"]`、introspect の docs も「uses fields this agent engine does not support: allowedTools」と書く）。

## 許可ルール（`permissions.rules`）

スキーマ `xTi`（`rules:T.array(T.object({capability:T.string(),match:T.array(T.string()).optional(),exclude:T.array(T.string()).optional(),effect:T.enum(["allow","deny","ask","evaluate"])})),policies:T.array(T.string()).optional()`）。

- `effect` の衝突解決は `Uue`: `deny` を最優先、次に明示の `ask`（`isExplicitAsk`）、次に `ask`、次に `evaluate`、どれも無ければ先頭。`evaluate` と非明示の `ask` は、別のルールがあればそれに譲る（`zQ`）。
- 表示用の射影 `FMt` は `evaluate` を `ask` に落とす（ユーザーには「確認」に見える）。
- `shell` capability の `match`/`exclude` はコマンド文字列のグロブ。エンジン内蔵の既定 allow リストに `git status`、`git log *`、`git diff *`、`npm run *`、`cargo test *`、`gh pr view *` などが並ぶ（`exclude:["git apply *--unsafe-paths*"]`、`exclude:["npm audit fix*"]` のように危険形を除外する例つき）。
- `sandbox_network` capability のルールは、`match` のグロブと `effect`（`evaluate` 以外）から `{pattern, effect}` の送信先リストに変換される（`vRe`）。ネットワークの送信先を allow/deny で絞れる。

## 許可プリセット（`permissions.policies`）

`policies` には `"preset:<id>"` を書く（`hBo` が `/^preset:(\S+) in /` で id を取り出し、`tje(id)` で束を引く）。内蔵の束 `mBo`（Map）には次がある（`id` と `description` はコードの文字列どおり）:

- `allow-all`: すべての tool を自動承認（ワークスペース外の fs も含む）。rules は `{capability:"all",effect:"allow"}`。
- `edit-workspace`: `fs_read`/`fs_write` を `./**` に allow。
- `dev-shell`: 開発でよく使う shell コマンド群を allow（system info, git, build tools, workspace fs ops）。
- `read-all`: どこでも `fs_read` と `web_fetch`/`web_search` を allow。
- `read-only-shell`: 読み取り専用の shell クエリ群を allow。
- `read-workspace`: ワークスペース内の `fs_read` を allow。
- `approve-for-me`: `requiresClassifier:!0`。`{capability:"all",effect:"evaluate"}` に `edit-workspace` と読み取り shell を足したもの。ルールで決まらない分を信頼分類器（classifier）に委ねる。

`requiresClassifier` の束は、モードが `enforce` のときだけ有効（`y$t`: `e.requiresClassifier!==!0||t==="enforce"`）。分類器は `evaluate` を実際の allow/ask に変える役。

判断: 既定の束を `policies:["preset:dev-shell"]` のように参照しつつ、プロジェクト固有の `deny` を `rules` に足すのが、エンジンの作りに沿う。`preset:allow-all` は「ワークスペース外の fs も含む」と説明にあるとおり広すぎるので避ける。

## hook で止められる操作

トリガーの凍結列挙 `Pxo`（`SessionStart` `SessionEnd` `Stop` `PreToolUse` `PostToolUse` `PreTaskExec` `PostTaskExec` `UserPromptSubmit` `PostFileCreate` `PostFileSave` `PostFileDelete` `Manual`。小文字・別名も同じ値に正規化される。例: `agentSpawn`→`SessionStart`、`AfterFileEdit`→`PostFileSave`）。

exit コードの意味は関数 `Yjr(trigger, exitCode)` が決める:

- `block`（tool を止める、stderr をエージェントに返す）になるのは、exit 2 かつ trigger が `UserPromptSubmit` / `PreToolUse` / `PreTaskExec` のときだけ（定数 `s_u={sendStdout:!1,sendStderr:!0,block:!0}`）。
- exit 0 の stdout をコンテキストに入れる（`Kjr`）のは `SessionStart` / `UserPromptSubmit` / `PreTaskExec`。
- `PreToolUse` の exit 0 の stdout は、コンテキストには入れず、`permissionDecision` の JSON として解釈する（`m=r.trigger==="PreToolUse"&&d.exitCode===0?p_u(d.stdout):void 0`）。`{"hookSpecificOutput":{"permissionDecision":"ask","permissionDecisionReason":"..."}}` でユーザー確認に落とせる（`p_u`）。
- `Stop` は exit 1、または exit 0 で `{"decision":"block","reason":"..."}` を返すと「続行」を促せる（`m_u`、`f_u`）。tool を止めるのとは別。
- matcher は `PreToolUse`/`PostToolUse` では tool 名に、`PostFileCreate`/`Save`/`Delete` では file パスにかかる。それ以外のトリガーでは無視（常にマッチ、`vNt`）。正規表現にメタ文字が無ければ tool 名のグロブとして扱う（`eGr` の `toolPattern`）。
- hook の action は `command`（stdin に JSON を渡して shell を実行）か `agent`（静的プロンプトを文脈に足す、`h8e.buildPromptAppendix`）。

このリポジトリの `.kiro/hooks/` はこの仕組みを使う。`block-force-push.json` と `block-iwe-normalize.json` は `trigger:"PreToolUse"` で `matcher:"shell|execute_bash"`（iwe 側は `@iwe*`）で、スクリプトが `exit 2` で拒否する。`warn-concurrent-sessions.json` は `trigger:"SessionStart"` で stdout を文脈に足す（常に exit 0）。どれもエンジンの仕様（Pre 系の exit 2 で block、SessionStart の exit 0 stdout を文脈へ）に合っている。

## MCP の server と tool の許可

MCP server の設定スキーマ（`acp-server.js`）:

- 共通 `gRa`: `env` `timeout`(`min(1)`) `waitForReady` `disabledTools:T.array(T.string())` `autoApprove:T.array(T.string())` `versionNegotiation`(`auto`/`legacy`)。
- stdio 系 `yRa`: `command` `args` `cwd`。
- http 系 `SRa`: `url` `headers` `oauth` `oauthScopes`。
- 共通 `wRa`: `disabled:T.boolean()` `type`。

`disabled:true` で server ごと読み込みを止める。`disabledTools` で server 内の tool を名前で無効化する。`autoApprove` で tool を自動承認する。これはこのリポジトリの `.kiro/settings/mcp.json`（iwe server、`disabled:false`、`disabledTools` に `iwe_normalize` など8個）と同じ形。

エージェント全体の許可では、MCP は capability `"mcp"` でまとめて `allow`/`deny`/`ask` できる（`kha` の `{tag:rt.MCP,capability:"mcp"}`）。企業の MCP レジストリ（管理者が許す server だけ使える）はこのファイルの外の governance 側の話で、introspect の docs にはあるがエンジンのこのファイルでは未確認。

## サンドボックス

エンジンで「sandbox」は2つの意味がある。

1. クライアント/実行環境の種別。`FYt=["local","sandbox"]`、`NMs=["kiro-web","kiro-ide","kiro-cli"]`。`environment==="sandbox"` だと client は `kiro-web` になり、`Efe` が「web か sandbox か」を判定する。これは tool を隔離する箱ではなく、どこで動いているかの区別。
2. ネットワークの許可 capability `sandbox_network`（`Cha` に含む）。`vRe` が `sandbox_network` のルールの `match` グロブと `effect` を集めて、送信先の `{pattern, effect}` リストを作る。つまりサンドボックス内のネットワーク送信先を allow/deny で絞れる。

tool 呼び出しごとに OS レベルのサンドボックス（名前空間・seccomp など）で隔離する仕組みは、このファイルからは確認できなかった（未確認）。

## 同じ失敗の繰り返しを hook で検出できるか

- エンジンが「同じ tool の失敗が続いたら止める」ような検出をして block する仕組みは、このファイルには見当たらない。
- `consecutiveFailures` は別物。ネットワークの publish 側のリトライ/バックオフ用のカウンタ（クラス内の `failures`、`recordFailure`、`retryAt`。`publish_failure`、`retryAfterMs` の近く）。tool 呼び出しの失敗ではない。
- 「same failure has survived more than one honest attempt」はモデルへのプロンプト文（エスカレーション判断の助言）であって、エンジンの制御ではない。
- 判断: 繰り返し失敗を検出して止めたいなら、`PostToolUse` hook（または `PreToolUse`）で自前で状態を持ち、`KIRO_SESSION_ID` ごとにカウンタを書いて、閾値を超えたら `PreToolUse` を exit 2 で止めるしかない。これはエンジンの標準機能ではなく自作。避けたいアンチパターンは、`consecutiveFailures` のような内部カウンタに依存すること（公開インターフェースではない）。

## introspect の docs とコードの食い違い（コードを正とする）

- introspect は agent 設定に `allowedTools` / `toolsSettings`（`shell.allowedCommands` / `deniedCommands` / `denyByDefault` / `autoAllowReadonly`、`write.allowedPaths` / `deniedPaths`）があると書く。KAS エンジンにこれらの文字列は無い（`denyByDefault`/`allowedCommands`/`deniedCommands`/`autoAllowReadonly`/`allowedPaths` はいずれも 0 件）。KAS は `permissions.rules`（capability モデル）を使う。introspect 自身も「allowedTools in KAS はサポート外」と注記している。
- hook のトリガー。introspect の Hooks ドキュメントは5つ（`agentSpawn` `userPromptSubmit` `preToolUse` `postToolUse` `stop`）だけ挙げるが、エンジンの `Pxo` は12個（`SessionEnd` `PreTaskExec` `PostTaskExec` `PostFileCreate/Save/Delete` `Manual` を含む）。
- exit 2 で止められるトリガー。introspect は「PreToolUse only」と書くが、エンジンの `Yjr` は `UserPromptSubmit` と `PreTaskExec` でも exit 2 で block する。
- エンジン内の in-prompt ドキュメント（`<hooks>` の説明文）自体も、コードと小さく食い違う。説明文は「exit 0 の stdout を SessionStart/UserPromptSubmit/PreToolUse で転送」と書くが、`Yjr` のコードは `SessionStart`/`UserPromptSubmit`/`PreTaskExec` を転送対象にし、`PreToolUse` の exit 0 stdout は `permissionDecision` の解釈に回す。実装（`Yjr`、`p_u`）を正とした。

## 未確認のこと

- tool を1つずつ OS レベルで隔離する実行サンドボックスの有無。このファイルからは確認できなかった。
- 企業の MCP レジストリ（管理者が許す server だけに絞る governance）は、introspect の docs にはあるが、`acp-server.js` のこのファイル内では確認していない。別のモジュールか server 側の可能性。
- `power` `workflow` `diagnostics` `context` capability の具体的な対象 tool 群。capability 名はあるが、各々がどの tool を含むかの網羅は追えていない。
- `permissions` の評価モード（`enforce` 以外に何があるか）と、信頼分類器（classifier、126 箇所）の判定ロジックの詳細。
- これらが「設定ファイルのどこに書けば効くか」（`.kiro/agents/<name>.json` 以外の優先順位）の完全な解決順序。

## 出典

- エンジン（一次資料、すべて同一ファイル）: `~/.local/share/kiro-cli/kas/2.33.1-3f3c844506ab197a42642c02d2146abee3502698d196923d3cfcca56729c5dd2/node_modules/@kiro/agent/dist/server/acp-server.js`、版 2.33.1（2026-10-22 ビルド）。
  - hook トリガー列挙: 文字列 `Pxo=Object.freeze({SessionStart:...,Manual:"Manual",...})`。
  - hook の exit コード意味: 関数 `Yjr`、定数 `s_u`/`Kjr`/`o_u`、hook executor クラス `f8e`、command action クラス（`CommandAction`）。
  - `permissionDecision` 解釈: 関数 `p_u`。`Stop` の続行判定: 関数 `m_u` / `f_u`。
  - matcher の対象: 関数 `vNt`、`eGr`、`Gue`。
  - カスタムエージェント設定スキーマ: `URr`（`tools`/`excludedTools`/`permissions`/`mcpServers`/`hooks`）、`permissions` スキーマ `xTi`。
  - capability 集合: 文字列 `Cha=new Set(["all","builtin","filesystem","fs_read","fs_write","shell","web_fetch","web_search","mcp","subagent","skill","power","context","diagnostics","workflow","sandbox_network"])`、対応 `kha`。
  - 許可ルールの衝突解決: 関数 `Uue`、`zQ`、`Bue`、`FMt`。
  - 内蔵プリセット: Map `mBo`、各 `id`(`allow-all`/`edit-workspace`/`dev-shell`/`read-all`/`read-only-shell`/`read-workspace`/`approve-for-me`)、`requiresClassifier`、`y$t`、`hBo`。
  - 内蔵 shell allow リスト: `capability:"shell",match:[...]` の並び（`git log *`、`npm audit` の `exclude:["npm audit fix*"]` など）。
  - MCP スキーマ: `gRa`(`disabledTools`/`autoApprove`/`timeout`)、`yRa`(`command`/`args`/`cwd`)、`SRa`(`url`/`headers`/`oauth`)、`wRa`(`disabled`)。
  - サンドボックス: `FYt=["local","sandbox"]`、`NMs`、`Efe`、ネットワーク `vRe`（`sandbox_network`）。
  - 繰り返し失敗: クラスの `consecutiveFailures`/`recordFailure`（publish リトライ用）、プロンプト文「same failure has survived more than one honest attempt」。
  - サポート外フィールド: 文字列 `bTi=["allowedTools","toolsSettings"]`。
- このリポジトリの設定（一次資料、突き合わせ用）:
  - `.kiro/settings/mcp.json`（iwe server、`disabledTools` 8個、`disabled:false`）。
  - `.kiro/hooks/block-force-push.json`、`.kiro/hooks/block-iwe-normalize.json`（`PreToolUse`、exit 2 で拒否）、`.kiro/hooks/warn-concurrent-sessions.json`（`SessionStart`、exit 0 で stdout を文脈へ）。
- introspect のドキュメント（二次資料、版が古い。コードと食い違う点は上の「食い違い」節に明記）: Agent Configuration（validated 2026-07-31）、Hooks System（2026-07-14）、/tools（2026-06-09）、MCP Registry（2026-07-02）。
