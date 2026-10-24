---
type: ADR
title: "ADR 0011: GitHub Actions の workflow は版を固定した actionlint と zizmor で検査する"
description: git で管理している workflow を actionlint 1.7.12 と zizmor 1.31.1 で検査し、mise で固定した版を pre-commit hook と CI の同じスクリプトから使う決定。zizmor はオフラインで動かす。workflow の検査を変えるとき、二つの道具の版や設定を変えるときに読む。
tags: [adr, tooling, actionlint, zizmor, github-actions, ci, security]
---

# ADR 0011: GitHub Actions の workflow は版を固定した actionlint と zizmor で検査する

`.github/workflows/` の workflow を検査するものは、`vp check` の書式の検査しかありませんでした。式の型の誤りや存在しない step の参照は、PR で workflow が動くまで分かりません。script injection、過大な権限、`persist-credentials` の書き忘れは、動いても分かりません。そこで二つの道具で検査します。

- **actionlint**: workflow の構文、式の型、`needs` や `steps` の参照、Action の入力を検査します。`PATH` に shellcheck があれば、`run:` のスクリプトも shellcheck で検査します。`mise exec` は固定した shellcheck ([ADR 0008](0008-pin-shellcheck.md)) も `PATH` に入れるので、その版で検査します。
- **zizmor**: workflow のセキュリティの問題を検査します。template injection、`persist-credentials` の書き忘れ (artipacked)、過大な権限、commit SHA で固定していない Action などです。

二つの道具は見るものが違うので、両方を使います (template injection のように、両方が見つけるものもあります)。版は `mise.toml` (actionlint 1.7.12、zizmor 1.31.1) と `mise.lock` で固定し、ローカルと CI で同じ版を使います ([ADR 0009](0009-mise-for-pinned-cli-tools.md))。`scripts/lint-workflows.sh` が、git で管理している `.github/workflows/*.yml` と `*.yaml` を両方の道具に渡します。このスクリプトは CI の `ci.yml` の `main` job と、workflow を変えた commit の pre-commit hook から呼びます。

zizmor は `--offline` で動かします。zizmor は `GH_TOKEN` か `GITHUB_TOKEN` があると、GitHub API を使う online audit (impostor-commit、known-vulnerable-actions、ref-confusion など) も実行します。トークンの有無で結果が変わると、ローカルの hook と CI の結果がずれます。API の一時的な失敗で hook や CI が落ちることもあります。

## Considered Options

- **zizmor の公式 Action (`zizmorcore/zizmor-action`)**: 既定では結果を code scanning に SARIF で送り、そのために `security-events: write` の権限が要ります。どちらにしても、pre-commit hook と同じスクリプトを使えません。
- **CI だけトークンを渡して online audit を実行する**: 検査は増えますが、ローカルと CI の結果がずれます。入れるなら別の Issue にします。
- **jactionlint (`jdx/jactionlint`)**: mise の作者による actionlint の fork です。2026-10-05 の mise 2026.10.3 から、mise の registry は `actionlint` を非推奨にして、こちらを勧めています。ただし fork は同じ 2026-10-05 に作られたばかりで (v2.0.0 は 2026-10-09)、mise の registry では aqua でなく `github:` の backend を使います。upstream の `rhysd/actionlint` は archive されておらず、最後のリリースは 2026-03-30 の v1.7.12 です。そのため upstream を使い、fork の様子を見ます。
- **pip や uvx で zizmor を入れる**: Python の環境が要ります。mise の aqua backend は GitHub Releases のバイナリを checksum で検証して入れるので、ほかの道具と入れ方を揃えられます。

## Consequences

- 検査の対象は、git で管理している workflow だけです。commit していない作業用の workflow は検査しません。
- `scripts/test/lint-workflows.test.sh` は、わざと誤りを入れた workflow で検査が失敗し、正しい workflow で通ることを確かめます。
- 意図して書いた箇所の指摘は、その場所に理由を書いて止めます。zizmor は `# zizmor: ignore[<audit>]`、`run:` の中の shellcheck は `# shellcheck disable=SCxxxx` です。例えば `release.yml` の checkout は、`nx release` が push するので `persist-credentials` を残します。
- zizmor の persona は既定の regular です。pedantic の指摘 (permissions の説明のコメントなど) は扱いません。
- 版を上げるときは、`mise.toml` の版を変えて `mise lock --platform linux-x64` を実行し、`mise.lock` と一緒に commit します。新しい版で指摘が増えたら、同じ PR で直します。
- `mise install` は、actionlint が非推奨だという警告を出します。`mise exec` は警告を出しません。

## 出典

- actionlint が `PATH` の shellcheck で `run:` を検査すること: [actionlint の Checks ("shellcheck integration for `run:`")](https://github.com/rhysd/actionlint/blob/main/docs/checks.md)
- zizmor がトークンの有無でオフラインとオンラインを切り替えること、`--offline`、ignore コメント、persona: [zizmor の Usage](https://docs.zizmor.sh/usage/)
- zizmor-action が既定で code scanning に送り、`security-events: write` を求めること: [zizmorcore/zizmor-action の README](https://github.com/zizmorcore/zizmor-action)
- mise が `actionlint` を非推奨にして jactionlint を足したこと: [mise v2026.10.3 のリリース](https://github.com/jdx/mise/releases/tag/v2026.10.3) (2026-10-05 公開)
- 各版の公開日: [rhysd/actionlint の Releases](https://github.com/rhysd/actionlint/releases)、[jdx/jactionlint の Releases](https://github.com/jdx/jactionlint/releases)、[zizmorcore/zizmor の Releases](https://github.com/zizmorcore/zizmor/releases)
