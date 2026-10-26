---
type: ADR
title: "ADR 0024: スクリプトと Kiro の hook は tools/scripts の TypeScript で書き、Node.js の型の除去で直接実行し、CLI を呼ぶだけの薄いラッパーは sh に残す"
description: 解析や分岐する規則を持つ検査のスクリプトと Kiro の hook を、Nx の project の tools/scripts に TypeScript で置き、Node.js 24 の型の除去で実行する決定。テストは Vitest で、規則の関数と少数のプロセスのテストに分け、宣言していない入力を読まない。Git hook の変数からの隔離を setupFiles、sandbox()、gitIn()、lint の規則、decoy の回帰テストで作り直す。スクリプトや hook を足す、移すとき、sh で書きたくなったとき、tools/scripts のテストの書き方や隔離を変えるときに読む。
tags: [adr, tooling, typescript, node, vitest, stryker, git-hooks, kiro]
---

# ADR 0024: スクリプトと Kiro の hook は tools/scripts の TypeScript で書き、Node.js の型の除去で直接実行し、CLI を呼ぶだけの薄いラッパーは sh に残す

`scripts/` の検査とテスト、`.kiro/hooks/` の hook は、`.agents/` を除いて 2,411 行のシェルスクリプトでした。100 行を超えるものが 7 つあり、設定ファイル、JSON、pre-push の標準入力を sed、awk、jq で読んでいました。型の検査、Knip、coverage、mutation test はどれもかかりません。CI の `scripts` の job は main の直近 3 回で 152〜172 秒かかる最も遅い job で、テストを 1 つずつ順に実行します。決めた経緯は [Issue #136](https://github.com/yokozi-jp/agent-software-factory/issues/136) の解決コメントに、実施の計画は [Issue #158](https://github.com/yokozi-jp/agent-software-factory/issues/158) にあります。

## ルール

- **言語**: 解析 (設定ファイル、JSON、pre-push の標準入力、ref) か、分岐する規則を持つスクリプトと Kiro の hook は TypeScript で書きます。1 つの CLI に引数を渡すだけのもの (`shellcheck.sh`、`check-root-files.sh` など) は sh に残します。[Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html) ("When to use Shell") は、100 行を超えるか、制御の流れが単純でないスクリプトは、構造のある言語で書き直すよう勧めています。
- **実行**: Node.js 24 の型の除去 (type stripping) で `node <file>.ts` として直接実行します。build も `tsx` も要りません。型の除去は v24.12.0 で stable になりました ([Node.js の Modules: TypeScript](https://nodejs.org/docs/latest-v24.x/api/typescript.html))。ルートの `tsconfig.json` の `erasableSyntaxOnly` と `verbatimModuleSyntax` ([ADR 0020](0020-typescript-strictness.md)) が、型を消すだけで動く書き方を保ちます。
- **置き場所**: `tools/scripts` に Nx の project (`scripts`) を 1 つ作り、検査を `src/checks/<名前>/`、hook を `src/hooks/`、sh に残すものを `sh/` に置きます。`nx affected`、cache、tsconfig、`vp check`、Knip がアプリと同じ仕組みで効きます ([ADR 0002](0002-nx-orchestrates-vite-plus.md))。入口 (`cli.ts`) は argv、標準入力、環境変数、git を読んで出力するだけにし、規則は純粋な関数 (`rules.ts` など) に置きます。
- **[ADR 0007](0007-api-on-node-web-standard-app.md) との関係**: 「Web 標準の API だけで書く」は `apps/api/src` の規則で、`tools/` には当てはまりません。`tools/scripts` は Node.js の上でだけ動く開発用の道具なので、`node:child_process` や `node:fs` を使います。
- **テストの形**: Vitest で書きます。規則の関数はその場で呼ぶテストにします。exit コード、標準入力、本物の git が要るつなぎ目だけを、少数のプロセスを起動するテスト (`cli.test.ts`) で確かめます。
- **テストの入力**: テストは宣言していない入力を読みません。`test` の target のテストは project の中の fixture だけを読み、リポジトリの本物のファイルは読みません。本物のファイルの検査は、センサーの実行 (CI の `checks` と pre-commit) の役割です。本物の道具と設定を使うテストは `*.tools.test.ts` にし、`test-tools` の target で走らせます。読む設定ファイルと `mise.toml`、`mise.lock` を、その target の `inputs` にファイルごとに書きます ([Nx の Configure Inputs](https://nx.dev/docs/guides/tasks--caching/configure-inputs))。宣言していない入力を読むテストは、Nx の cache が古い結果を返すアンチパターンです。
- **どこで走るか**: `test` は CI の `nx` の job の `nx affected -t check test build mutation` と、`tools/scripts/**` か Nx の `sharedGlobals` のファイルを変えた commit の pre-commit (`nx test scripts`) で走ります。`test-tools` は mise のある `scripts` の job で `nx affected -t test-tools` として走ります。アプリだけを変えた PR では、どちらも走りません。
- **テストの強さ**: [Issue #30](https://github.com/yokozi-jp/agent-software-factory/issues/30) の基準を当てます。coverage はファイルごとの lines と branches の下限 90% と、全体の値のラチェット (`autoUpdate`) です。入口の `cli.ts` は子プロセスで動き、coverage が見えないので、対象から外します。Stryker を `--incremental` で純粋な関数だけにかけます (`mutation` の target)。`thresholds.break` は導入時の実測値 100 です。#30 は Stryker を domain の最初のモジュールと一緒に入れるとしていましたが、`tools/scripts` が先になりました。

## 隔離

Git hook は `GIT_DIR`、`GIT_INDEX_FILE` などを export し、作業ツリーの root で動きます ([githooks](https://git-scm.com/docs/githooks))。これが残ると、テストが一時ディレクトリに向けた git も hook を動かしたリポジトリに効きます (2026-10-23 に、pre-commit から動いたテストがこのリポジトリに commit して main に push しました。経緯は [PR #10](https://github.com/yokozi-jp/agent-software-factory/pull/10) の本文にあります)。`tools/scripts` のテストは次の 4 つで守ります。

1. Vitest の `setupFiles` (`src/test/setup.ts`) が、`git rev-parse --local-env-vars` の変数を消し、`GIT_CONFIG_GLOBAL=/dev/null`、`GIT_CONFIG_NOSYSTEM=1`、`GIT_ALLOW_PROTOCOL=file` を設定します。githooks は、hook から別のリポジトリで git を使うときにこれらの変数を消すよう書き、pre-commit フレームワークも `no_git_env` で `GIT_*` を消します。
2. `sandbox()` が一時ディレクトリを作って `GIT_CEILING_DIRECTORIES` を設定し、`gitIn(dir, args)` は `dir` の git dir が sandbox の外なら例外にします。`gitIn` と `runIn` は、起動する git とコマンドに `HOME=<sandbox>` を渡します。git 自身のテスト (`t/test-lib.sh`) も `GIT_CEILING_DIRECTORIES`、`GIT_CONFIG_NOSYSTEM`、`HOME` を同じように設定します。拒否は、sh の `in_sandbox_repo` を引き継いだ自前の設計です (判断)。
3. テストのファイル (`tools/scripts/src/**/*.test.ts`) が `node:child_process` を直接 import するのを、Oxlint の `no-restricted-imports` で止めます。メッセージは `gitIn` と `runIn` を使うよう書きます。補助関数のファイル (`src/test/` のテストでないファイル) は対象外です。規則が効いていることは、`oxlint-disable-next-line` を付けた fixture (`src/test/fixtures/child-process.test.ts`) で確かめます ([Issue #43](https://github.com/yokozi-jp/agent-software-factory/issues/43))。ソースを正規表現で探す検査は `execFileSync("git", ["-C", …])` を見落とすので、TypeScript には使いません。`check-repo-policy.sh` の「別のリポジトリへの git」の正規表現は、`tools/scripts/src` の TypeScript を対象から外します。
4. `src/test/isolation.test.ts` が、decoy のリポジトリを指す `GIT_DIR` と `GIT_INDEX_FILE` を設定し、decoy を作業ディレクトリにして、`unit` の project の Vitest を子プロセスで動かします。decoy の ref、index、設定、remote の fingerprint が変わらないことを確かめます。動的な `import()` と `createRequire` は 3 の規則の外なので、この回帰テストで守ります。ただし fingerprint を取るのは decoy だけです。動的な `import()` で `node:child_process` を読み込み、`git -C <このリポジトリの絶対パス>` のように別のリポジトリをパスで指定するテストは、hook の変数も作業ディレクトリも使わないので、このテストでは見つかりません (sh の `isolation.test.sh` も同じです)。この場合に残る守りは、静的な import を止める 3 の規則と、レビューです。子は `unit` の project だけを動かすので、このテスト自身を再び起動しません。

## Considered Options

- **sh のままにして、テストだけを直す**: 起動は速く (`sh` と `jq` は約 6 ms、`node` は約 40〜80 ms)、移す手間もかかりません。ただ、sed と awk で構造のあるデータを読む書き方と、`docs-check.sh` に埋め込んだ検査されない `node -e` が残ります。型、Knip、coverage、mutation test もかからないままです。
- **TypeScript を `scripts/` に置き、Nx の project にしない**: パスは変わりませんが、`nx affected` と cache が効かず、CI でテストを毎回走らせることになります。tsconfig と Vitest の設定も、どの project にも属さない場所に置くことになります。
- **`tsx` や Bun で実行する**: 依存か、別のランタイムが増えます。Node.js 24 の型の除去で足ります。
- **テストを `scripts` の job に残す**: mise の道具は要りませんが、`nx affected` で絞れず、cache も効きません。本物の道具を使うテストだけを `test-tools` にして、mise のある `scripts` の job に置きます。`nx` の job に mise を入れないための判断です。
- **プロセスのテストで規則も確かめる**: sh のテストはすべてこの形で、`adr-check.test.sh` は 1 回 2.1〜2.4 秒かかりました。規則をその場で呼ぶテストは速く、Stryker もかけられます。

## Consequences

- PreToolUse の hook は tool の呼び出しごとに動くので、`node` の起動 (1 回約 40〜80 ms) が sh より遅くなります。hook を trigger ごとに 1 つの入口にまとめ、`NODE_COMPILE_CACHE` を指定して埋め合わせます (#158 の手順 2)。jq がないと hook が何もせずに通る穴はなくなります。
- 移すのは手順ごとに 1 つの PR です (#158)。この ADR を足した PR は、土台と隔離を作り、adr-check (`tools/scripts/src/checks/adr-check/`) を移しました。移した部分の `*.test.sh` は同じ PR で消します。`scripts/` が空になるまでは、sh のテストと隔離 (`scripts/test/lib.sh`、`isolation.test.sh`) も残ります。
- [ADR 0008](0008-pin-shellcheck.md) の shellcheck の対象は、`scripts/` を `tools/scripts/sh/` に移す PR で、その場で直します。
- coverage のラチェットは `tools/scripts/vite.config.ts` を書き換えます。上がった下限を commit し忘れると、CI の「Generated files are committed」で止まります。
- CI には Stryker の incremental の結果を持ち越す cache がないので、`mutation` は `tools/scripts` を変えた PR で毎回すべての mutant を回します (導入時に約 50 秒)。遅くなったら、`reports/stryker-incremental.json` を CI の cache に置くかを決めます。
- 規則の関数に、テストで殺せない (等価な) mutant が出たら、その行に `// Stryker disable next-line <mutator>: 理由` を書きます。`break` の 100 を下げません。

## 出典

- 型の除去が v24.12.0 で stable になったこと: [Node.js の Modules: TypeScript](https://nodejs.org/docs/latest-v24.x/api/typescript.html) の History
- 100 行を超えるスクリプトを書き直す基準: [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html) ("When to use Shell")
- hook が `GIT_DIR` などを export し、別のリポジトリで git を使う前に `git rev-parse --local-env-vars` の変数を消す例: [githooks](https://git-scm.com/docs/githooks) ("DESCRIPTION")
- pre-commit フレームワークが hook の中で `GIT_*` を消すこと: [pre-commit の `pre_commit/git.py`](https://github.com/pre-commit/pre-commit/blob/main/pre_commit/git.py) の `no_git_env`
- git のテストが `GIT_CEILING_DIRECTORIES`、`GIT_CONFIG_NOSYSTEM`、`HOME` を設定すること: [git の `t/test-lib.sh`](https://github.com/git/git/blob/master/t/test-lib.sh)
- 入力をファイルごとに宣言すること: [Nx の Configure Inputs](https://nx.dev/docs/guides/tasks--caching/configure-inputs)
- coverage の `thresholds.perFile` と `autoUpdate`: [Vitest の Coverage の設定](https://vitest.dev/config/coverage)
- Stryker の vitest-runner と `--incremental`: [Stryker の Vitest Runner](https://github.com/stryker-mutator/stryker-js/blob/master/docs/vitest-runner.md)、[Incremental](https://github.com/stryker-mutator/stryker-js/blob/master/docs/incremental.md)
- 変える前に測った時間 (CI の job、pre-commit、shell の呼び出しごとの hook): この ADR を足した PR の本文
