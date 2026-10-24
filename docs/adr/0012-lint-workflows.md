---
type: ADR
title: "ADR 0012: GitHub Actions の workflow は版を固定した actionlint と zizmor で検査する"
description: git で管理している workflow を actionlint 1.7.12 と zizmor 1.31.1 で検査し、mise で固定した版を pre-commit hook と CI の同じスクリプトから使う決定。zizmor はオフラインで動かし、fork の jactionlint はまだ使わない。workflow の検査を変えるとき、二つの道具の版や設定を変えるとき、jactionlint への移行を考えるときに読む。
tags: [adr, tooling, actionlint, zizmor, github-actions, ci, security]
---

# ADR 0012: GitHub Actions の workflow は版を固定した actionlint と zizmor で検査する

`.github/workflows/` の workflow を検査するものは、`vp check` の書式の検査しかありませんでした。式の型の誤りや存在しない step の参照は、PR で workflow が動くまで分かりません。script injection、過大な権限、`persist-credentials` の書き忘れは、動いても分かりません。そこで二つの道具で検査します。

- **actionlint**: workflow の構文、式の型、`needs` や `steps` の参照、Action の入力を検査します。`PATH` に shellcheck があれば、`run:` のスクリプトも shellcheck で検査します。`mise exec` は `mise.toml` の道具をすべて `PATH` に入れるので、固定した shellcheck ([ADR 0008](0008-pin-shellcheck.md)) で検査します。
- **zizmor**: workflow のセキュリティの問題を検査します。template injection、`persist-credentials` の書き忘れ (artipacked)、過大な権限、commit SHA で固定していない Action などです。

二つの道具は見るものが違うので、両方を使います (template injection のように、両方が見つけるものもあります)。版は `mise.toml` (actionlint 1.7.12、zizmor 1.31.1) と `mise.lock` で固定し、ローカルと CI で同じ版を使います ([ADR 0009](0009-mise-for-pinned-cli-tools.md))。`scripts/lint-workflows.sh` が、git で管理している `.github/workflows/*.yml` と `*.yaml` を両方の道具に渡します。このスクリプトは CI の `ci.yml` の `main` job と、workflow を変えた commit の pre-commit hook から呼びます。

zizmor は `--offline` で動かします。zizmor は `GH_TOKEN` か `GITHUB_TOKEN` があると、GitHub API を使う online audit (impostor-commit、known-vulnerable-actions、ref-confusion、stale-action-refs など) も実行します。トークンの有無で結果が変わると、ローカルの hook と CI の結果がずれます。API の一時的な失敗で hook や CI が落ちることもあります。

## Considered Options

- **zizmor の公式 Action (`zizmorcore/zizmor-action`)**: 既定では結果を code scanning に SARIF で送り、そのために `security-events: write` の権限が要ります。どちらにしても、pre-commit hook と同じスクリプトを使えません。
- **CI だけトークンを渡して online audit を実行する**: 検査は増えますが、ローカルと CI の結果がずれます。入れるなら別の Issue にします。
- **jactionlint (`jdx/jactionlint`)**: mise の作者の jdx が 2026-10-05 に作った actionlint の fork です。upstream で merge されていない修正、新しい構文 (parallel steps など)、zizmor の audit に倣った security と policy の規則を足しています。mise は同じ日の v2026.10.3 で `actionlint` を非推奨にし、jactionlint を勧めています。ただし、registry にこの推奨を入れたのは jdx 本人です。jactionlint は 2026-10-07 から aqua registry にも入っているので、upstream と同じく aqua backend で入れられ、`mise.lock` に attestation の検証を記録できます。
  upstream の `rhysd/actionlint` は archive されておらず、保守の終了も宣言されていません。ただし main への commit は 2026-04-19 が最後で、作者の不在を尋ねた Issue #719 にも作者の rhysd は返信していません。事実上休止している、と判断します。
  それでも今は upstream を使います。これは判断です。jactionlint は作られて 3 週間で、作って 4 日後の 2026-10-09 に v2.0.0 を出しています。`--profile` を指定しないと security と policy の規則も動き、v2.0.0 から v2.2.0 までの minor の版ごとに規則が足されています。fork 後の commit のほとんどは jdx 一人のものです。lint の版を上げるたびに指摘が変わると、hook と CI で同じスクリプトを使うこの構成では、版を上げる作業が重くなります。一方で、今の workflow は jactionlint 2.3.0 で検査しても指摘がないことを確かめました (actionlint 1.7.12 でも同じです)。upstream の休止で困ることは、まだ起きていません。jactionlint は zizmor の audit をすべて持つと主張していますが、これは jactionlint 自身の比較で、自分で欠けを挙げてもいます。そのため zizmor の代わりにもしません。
- **pip や uvx で zizmor を入れる**: Python の環境が要ります。mise の aqua backend は、registry の定義に従って checksum や attestation を検証して入れるので、ほかの道具と入れ方を揃えられます。

## Consequences

- 検査の対象は、git で管理している workflow だけです。commit していない作業用の workflow は検査しません。
- `scripts/test/lint-workflows.test.sh` は、わざと誤りを入れた workflow で検査が失敗し、正しい workflow で通ることを確かめます。
- 意図して書いた箇所の指摘は、その場所に理由を書いて止めます。zizmor は `# zizmor: ignore[<audit>]`、`run:` の中の shellcheck は `# shellcheck disable=SCxxxx` です。例えば `release.yml` の checkout は、`nx release` が push するので `persist-credentials` を残します。
- zizmor の persona は既定の regular です。pedantic の指摘 (permissions の説明のコメントなど) は扱いません。
- 版を上げるときは、`mise.toml` の版を変えて `mise lock --platform linux-x64` を実行し、`mise.lock` と一緒に commit します。新しい版で指摘が増えたら、同じ PR で直します。
- mise 2026.10.17 で、`mise install` が actionlint は非推奨だという警告を出し、`mise exec` は警告を出さないことを確かめました。
- 次のどれかが起きたら、jactionlint への移行を検討し直します。
  - upstream の actionlint が、使いたい構文や runner label で誤った指摘を出し、直らない。
  - upstream が archive されるか、保守の終了が宣言される。
  - jactionlint が 2〜3 か月 major を上げずに落ち着き、jdx 以外の継続的な contributor や、第三者の採用が出てくる。

  移るときは、`mise.toml` に `"aqua:jdx/jactionlint"` を完全な版で書き、`.github/jactionlint.yaml` に `profile: correctness` を書いて、actionlint と同じ範囲から始めます。zizmor はしばらく併用して、両方の指摘を比べます。これも判断です。

## 出典

- actionlint が `PATH` の shellcheck で `run:` を検査すること: [actionlint の Checks ("shellcheck integration for `run:`")](https://github.com/rhysd/actionlint/blob/main/docs/checks.md)
- `mise exec` が設定の道具を子プロセスの `PATH` に入れること: [mise の `mise exec`](https://mise.jdx.dev/cli/exec.html)
- mise の aqua backend が checksum、attestation などを検証すること: [mise の aqua backend ("Security verification")](https://mise.jdx.dev/dev-tools/backends/aqua.html)
- zizmor がトークンの有無でオフラインとオンラインを切り替えること、`--offline`、ignore コメント、persona: [zizmor の Usage](https://docs.zizmor.sh/usage/)
- impostor-commit、known-vulnerable-actions、ref-confusion、stale-action-refs がオフラインで動かないこと: [zizmor の Audit Rules (各 audit の "Works offline")](https://docs.zizmor.sh/audits/)
- zizmor-action が既定で code scanning に送り、`security-events: write` を求めること: [zizmorcore/zizmor-action の README](https://github.com/zizmorcore/zizmor-action)
- mise が `actionlint` を非推奨にして jactionlint を足したこと、それを入れたのが jdx であること: [mise v2026.10.3 のリリース](https://github.com/jdx/mise/releases/tag/v2026.10.3) (2026-10-05 公開)、[mise#13960](https://github.com/jdx/mise/pull/13960)
- jactionlint の作成日、保守者、fork で足したもの: [jdx/jactionlint](https://github.com/jdx/jactionlint) (作成日は GitHub API の `created_at`)、[v1.8.0 のリリースノート](https://github.com/jdx/jactionlint/releases/tag/v1.8.0)
- jactionlint の v2 の変更と既定の profile: [jactionlint の CHANGELOG](https://github.com/jdx/jactionlint/blob/main/CHANGELOG.md)、[Coming from actionlint](https://github.com/jdx/jactionlint/blob/main/docs/actionlint.md)
- jactionlint の zizmor との比較と、自分で挙げた欠け: [jactionlint and zizmor](https://github.com/jdx/jactionlint/blob/main/docs/zizmor-parity.md)
- jactionlint が aqua registry に入ったこと: [aqua-registry#62034](https://github.com/aquaproj/aqua-registry/pull/62034) (2026-10-07)
- upstream の状態: [rhysd/actionlint の commits](https://github.com/rhysd/actionlint/commits/main)、[Issue #719](https://github.com/rhysd/actionlint/issues/719)
- 各版の公開日: [rhysd/actionlint の Releases](https://github.com/rhysd/actionlint/releases)、[jdx/jactionlint の Releases](https://github.com/jdx/jactionlint/releases)、[zizmorcore/zizmor の Releases](https://github.com/zizmorcore/zizmor/releases)
