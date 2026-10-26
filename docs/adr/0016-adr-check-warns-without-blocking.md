---
type: ADR
title: "ADR 0016: 判断が絡む変更に ADR がないと、pre-push hook と CI で警告だけを出す（adr-check）"
description: 依存、ツールの設定、workflow、ruleset、Kiro の hook や設定を変えたのに、同じ変更で docs/adr/ に ADR が増えていないと adr-check (tools/scripts/src/checks/adr-check/) が警告する決定。失敗させない理由、pre-commit ではなく pre-push と CI に置く理由、対象の範囲、比較の起点がないときの扱いも書く。adr-check の警告が出たとき、対象のファイルや警告の出し方を変えるとき、検査を失敗させたくなったときに読む。
tags: [adr, tooling, ci, git-hooks, adr-check]
---

# ADR 0016: 判断が絡む変更に ADR がないと、pre-push hook と CI で警告だけを出す（adr-check）

決定が絡みやすいファイル (依存、ツールの設定、workflow、ruleset、Kiro の hook など) を変える変更が、ADR を書くかどうかを考えないまま通ることがありえます。変更を出す人も、レビューする人も、変更したファイルの名前から ADR を連想するとは限らないためです。そこで adr-check (`tools/scripts/src/checks/adr-check/`) で、そのような変更に ADR (`docs/adr/NNNN-*.md`) の追加がなければ、書くかどうかを考え直す合図を出します。

- **警告だけで、失敗させない**: 終了コードは常に 0 です。対象のファイルの変更の多くは、ADR が要らないためです (依存の版を上げる、workflow の step を直す、など)。ADR は「戻しにくい」「文脈なしには意外」「本当の trade-off の結果」の 3 つがそろうときだけ書きます ([docs の書き方](../knowledge/documentation-authoring.md#adr-を書くかどうか))。この 3 つはファイルの名前からは分からないので、機械は判断できません。止めると、判断が要らない変更で必ず抜け道 (空の ADR を足す、hook を飛ばす) を探すことになります。
- **対象**: 1 か所 (`tools/scripts/src/checks/adr-check/rules.ts` の `isDecisionPath`) に書いた path の一覧です。正は `isDecisionPath` で、ここには種類だけを挙げます。依存の宣言 (`package.json`、`pnpm-workspace.yaml`、`mise.toml`)、ツールの設定 (`nx.json`、`lefthook.yml`、`vite.config.ts`、`commitlint.config.ts`、`.node-version`、`.betterleaks.toml`、`.jscpd.json`、`.markdownlint-cli2.yaml`)、`.github/workflows/` と `.github/rulesets/`、`.kiro/hooks/` と `.kiro/settings/` です。`test/`、`tests/`、`__tests__/`、`fixtures/`、`__fixtures__/` の下 (どの深さでも) と、`*.test.*`、`*.spec.*` は、名前が一覧に合っても対象外です。lockfile (`pnpm-lock.yaml`、`mise.lock`) は、`package.json` と `mise.toml` に従って生成されるので対象にしません。
- **ADR があるとみなす条件**: 比べる範囲に、`docs/adr/NNNN-*.md` が新しく追加されていることです。既にある ADR を直しただけでは、ADR を増やしたとはみなしません。
- **比べる範囲**: 起点との merge base から、変更の先頭までです。起点は、pull request では `origin/$GITHUB_BASE_REF`、それ以外では `origin/main` です。CI は PR の base との差分を、pre-push hook は push するコミットを、同じ式で比べます。pre-push hook は、Git が標準入力に渡す ref ごとのコミットを、ref ごとに別々に比べます (ある ref に ADR があっても、別の ref の警告は消えません)。`git push origin other:branch` のように HEAD 以外を push する場合も、push するコミットを見ます。
- **出し方**: GitHub Actions (`GITHUB_ACTIONS=true`) では、変更の一覧と判断基準へのリンクをログに出し、同じ内容を `::warning title=adr-check::` の annotation にします。ローカルでは標準エラーに出します。警告には、ADR が要らない変更なら `ADR_ACK=1` で警告を抑えられることも書きます。
- **起点がないとき**: 起点の ref がない、または浅い clone で merge base が見つからないときは、理由を出して (CI は `::notice::`) 通します。比べられないことを理由に、push や CI を止めません。

## Considered Options

- **検査を失敗させる (ADR_ACK がなければ止める)**: 抜け漏れは確実に止まります。ただ、上のとおり、ファイルの名前だけでは ADR が要るかどうかを決められないので、要らない変更の多くを止めます。警告は読み流されやすいので効き目は弱いのですが、止めて抜け道を作らせるより、警告の文面に判断基準へのリンクを付けるほうを選びました。警告が無視されて ADR の書き漏れが続くようなら、失敗させる方式に移ることをこの ADR を直して決めます。
- **pre-commit hook に置く**: commit ごとに実行すると、ADR を最後の commit で足す作業の途中で、毎回警告が出ます。pre-push hook は、push する範囲をまとめて見るので、ADR を足した後の状態で判断できます。
- **PR テンプレートのチェック欄だけにする**: `.github/pull_request_template.md` の「Merge Danger」は、戻しやすさを PR の作者に尋ねますが、ADR を書いたかどうかは尋ねません。欄を足しても、変更の中身とは結び付かず、書き忘れに気付く手がかりになりません。
- **CODEOWNERS で `docs/adr/` のレビューを求める**: ADR が増えたときの承認を求める仕組みで、ADR が足りないことには気付けません。
- **ADR が要るかどうかを、変更の内容 (diff の中身) で判断する**: 依存の追加と版の更新、workflow の新しい step と文言の修正を見分ける必要があり、検査が複雑になります。まず path だけで始め、警告が多すぎれば一覧を絞ります。

## Consequences

- 対象の一覧は、このリポジトリのファイルの構成に合わせた判断です。新しい種類の設定ファイルを足したら、`tools/scripts/src/checks/adr-check/rules.ts` の `isDecisionPath` に足すかどうかを考えます。
- 警告は commit も push も止めません。pre-push hook の警告は、lefthook の出力に表示されます。
- ADR を書かずに `ADR_ACK=1` で抑えられるのはローカルの pre-push hook だけです。CI では `ADR_ACK` を渡さないので、ADR が要らない変更の PR には警告 (annotation) が残ります。
- `rules.test.ts` が対象の一覧、ADR があるとみなす条件、ref ごとの判断、警告と annotation の文面を、`cli.test.ts` が sandbox の中の git で、警告が出る場合、出ない場合、`ADR_ACK=1` の場合、CI の annotation、pre-push の入力、起点がない場合 (ref がない、浅い clone) を確かめます (どちらも `tools/scripts/src/checks/adr-check/`)。2026-10 に sh から TypeScript に移しました ([ADR 0024](0024-scripts-and-hooks-in-typescript.md))。振る舞いは変えていません。

## 出典

- `::warning` と `::notice` の annotation の書式 (`title` などの parameter): [Workflow commands for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands) ("Setting a warning message"、"Setting a notice message")
- `GITHUB_BASE_REF` が `pull_request` と `pull_request_target` のときだけ設定されること: [Variables reference](https://docs.github.com/en/actions/reference/workflows-and-actions/variables) ("Default environment variables")
- pre-push hook が標準入力で `<local-ref> <local-object-name> <remote-ref> <remote-object-name>` の行を受け取ること、削除する ref の local-object-name が全て 0 になること: [githooks の pre-push](https://git-scm.com/docs/githooks#_pre_push)
- ADR を書く条件 (戻しにくい、文脈なしには意外、本当の trade-off): `domain-modeling` skill の ADR-FORMAT.md ("When to offer an ADR")
