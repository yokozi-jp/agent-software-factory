# Git hook は Vite+ の hook ではなく lefthook で管理する

Vite+ には `vp config` / `vp hooks` による hook の仕組み (`.vite-hooks/` のシェルスクリプトと `core.hooksPath`) がありますが、使わずに lefthook に一本化しました。hook は commit-msg (commitlint)、pre-commit (betterleaks と `vp check --fix`)、pre-push (betterleaks) の3つで、npm 以外のツール (betterleaks) も呼びます。lefthook は宣言的な設定、並列実行、`{staged_files}` と `stage_fixed` を標準で持つ安定版のツールで、ベータ版の Vite+ の hook 機能に依存せずに済みます。両方を入れると `core.hooksPath` を取り合うので、Vite+ の hook は `vp create --no-hooks` で無効にしています。

## Consequences

- staged ファイルの処理に lint-staged (`vp staged`) は使いません。lefthook が `vp check --fix {staged_files}` を直接実行します。
- `vp create` や `vp migrate` を後から実行する場合は、`--no-hooks` を付けてください。付けないと `.vite-hooks` が作られ、lefthook と競合します。
