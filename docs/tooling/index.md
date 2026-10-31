# 開発ツール

- [開発コマンド](commands.md)：開発サーバー、check、test、build、依存の追加などのコマンドを探すとき
- [Git hook](git-hooks.md)：hook で commit や push が止まったとき、Kiro の hook でコマンドが拒否されたとき、hook を飛ばしたいとき、hook を変えるとき
- [CI](ci.md)：CI が失敗したとき、workflow や CI の検証を変えるとき、検査を足すとき
- [保証カタログ](assurance-catalog.md)：何が merge のゲートで保証されているかを確かめるとき、検査、hook、ruleset を足す、変える、消すとき
- [Effect の検査](effect-lint.md)：`lint-effect` が失敗したとき、Effect の規則で `vp check` が止まったとき、Effect の検査や effect-tsgo の版を変えるとき
- [エージェントの権限](agent-permissions.md)：エージェントの操作が止まった、確認を求められたとき、権限の規則や hook を足す、変える、緩めるとき、`--trust-all-tools` を付けるか迷うとき、worktree で Kiro を始めるとき
- [secret scan](secret-scan.md)：betterleaks で止まったとき、誤検知を除外するとき、betterleaks を更新するとき
- [Renovate](renovate.md)：Renovate の PR が出たとき、Renovate の設定を変えるとき、GitHub App をインストールするとき
- [検証環境の流れ](verification-environment.md)：検証環境の workflow や CDK の stack を書く、変えるとき、検証環境が失敗したとき、本番の CD との違いを確かめるとき
- [外部ドキュメントの読み方](external-docs.md)：外部の道具 (AWS、Hono、Vite+、Nx、mise、pnpm、lefthook、Oxlint、betterleaks、GitHub、Effect、Kiro、Codex) や仕様 (RFC、OpenTelemetry、MDN) の一次情報を調べるとき
- [並行作業と worktree](worktrees.md)：別のセッションが同じ作業ツリーで動いていると警告されたとき、並行して作業を始めるとき、worktree から PR を出すとき
- [ローカルでトレースを見る](local-telemetry.md)：API のトレースをローカルで見るとき、トレースが出ないとき、otel-lgtm の版を上げるとき
- [ローカルで通知メールのワーカーを動かす](local-worker.md)：通知メールのワーカーを手元で動かすとき、Mailpit でメールを目で確かめるとき、ElasticMQ や Mailpit の版を上げるとき
- [通知メールの DLQ のメッセージを元のキューに戻す](dlq-redrive.md)：通知メールのメッセージが DLQ に移ったとき、DLQ のメッセージを SQS の redrive で戻すとき、戻すと 2 通目が出る理由を確かめるとき
