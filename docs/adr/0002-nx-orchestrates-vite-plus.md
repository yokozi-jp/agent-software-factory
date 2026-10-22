# タスクの実行は Nx が担当し、Vite+ はツールチェーンとしてだけ使う

Vite+ は `vp run` という task runner と cache を持っていますが、使いません。タスクの順序、cache、変更の影響範囲の計算 (`nx affected`) は Nx に一本化し、Vite+ は各プロジェクトの `package.json` scripts から `vp build`、`vp test`、`vp check` として呼ばれるだけにしました。`vp run` は local cache だけで、affected の計算と remote cache がありません (2026-10 時点、Nx 公式の比較記事 nx.dev/docs/kb/nx-vs-vite-plus と Vite+ のロードマップによる)。Nx から `vp run` を呼ぶと、実行順序と cache を二重に管理することになります。

## Considered Options

- **`@nx/vite` プラグイン**: `vite.config.ts` から target を推論しますが、`vite` CLI を前提にしています。Vite+ の `vp` サブコマンドは Nx 公式の比較記事でも `package.json` scripts として実行する方法が示されているので、プラグインは使わず、scripts から target を推論させています。cache の inputs と outputs は `nx.json` の `targetDefaults` に書きます。
- **Vite+ だけ (Nx なし)**: Vite+ はベータ版で、affected、remote cache、モジュール境界のルール、リリース管理がありません。

## Consequences

- `vite.config.ts` に `run` ブロックを書かず、`vp run` / `vpr` は使いません。Vite+ テンプレートが生成する `run: { cache: true }` は削除しています。
- `nx init` は `@nx/vite` を自動で追加することがあります。追加された場合は削除してください。
