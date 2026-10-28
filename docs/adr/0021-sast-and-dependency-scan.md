---
type: ADR
title: "ADR 0021: SAST と依存の脆弱性は、PR が新しく持ち込んだ指摘だけで止め、ゲートは CodeQL と dependency review、ローカルの写しは Semgrep と OSV-Scanner にする"
description: SAST と依存の脆弱性スキャンの決定。merge のゲートは CodeQL の default setup (ruleset の code_scanning の規則) と actions/dependency-review-action で、どちらも PR が新しく持ち込んだ指摘だけで止める。ローカルでも動く写しとして Semgrep CE と OSV-Scanner を pre-push と CI に重ねて置く。OSV-Scanner の指摘だけは、main への push のときに SARIF にして Code scanning に送る (ゲートにはしない)。SAST や依存のスキャンの道具、閾値、抑制の仕方を変えるとき、CodeQL と Semgrep のどちらかを外したくなったとき、Trivy や pnpm audit を足したくなったとき、private のリポジトリで使うときに読む。
tags: [adr, tooling, security, sast, dependencies, github]
---

# ADR 0021: SAST と依存の脆弱性は、PR が新しく持ち込んだ指摘だけで止め、ゲートは CodeQL と dependency review、ローカルの写しは Semgrep と OSV-Scanner にする

このリポジトリには、コードの脆弱性 (SAST) と依存の既知の脆弱性を調べる検査がありませんでした。依存の脆弱性は、コードを変えなくても advisory が公開された日から main に現れます。指摘が1つでもあれば止める形 (zizmor や betterleaks) にすると、関係のない PR まで止まり、理由のない ignore で黙らせることになります。そこで、PR が新しく持ち込んだ指摘だけで merge を止め、すでにある指摘は alert の一覧で扱います。決めた経緯は [Issue #127](https://github.com/yokozi-jp/agent-software-factory/issues/127) に、道具の比較は [Issue #36](https://github.com/yokozi-jp/agent-software-factory/issues/36) にあります。

- **SAST のゲート**: CodeQL の default setup (TypeScript と Actions) です。`protect-main` の ruleset に `code_scanning` の規則を足し、閾値は Alerts を Errors、Security alerts を High or higher にします (閾値は判断)。この規則は、道具が設定されていないときにも merge を止めます ([Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets))。default setup の設定はリポジトリのファイルになりませんが、無効になれば ruleset が PR を止めるので、別の検出の仕組みは作りません。
- **依存のゲート**: [`actions/dependency-review-action`](https://github.com/actions/dependency-review-action) を必須チェックにし、`fail-on-severity: high` にします (判断。既定の `low` は止まる回数が増えます)。dependency graph は `pnpm-lock.yaml` を読みます ([Dependency graph supported package ecosystems](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/dependency-graph-supported-package-ecosystems))。
- **ローカルでも動く写し**: エージェントが PR を出す前に指摘を受け取れるよう、Semgrep CE と OSV-Scanner を pre-push の hook と CI の `main` job に置きます。
  - Semgrep CE は merge base を `--baseline-commit` に渡し、Registry の TypeScript と React の ruleset に `--metrics off` と `--severity ERROR` を付けて、新しい ERROR の指摘だけで失敗させます ([CLI reference](https://docs.semgrep.dev/cli-reference))。ERROR に絞るのは、CodeQL と重なって誤検知で2回止まるのを減らすためです (判断)。
  - OSV-Scanner は `pnpm-lock.yaml` を検査し、警告だけを出します (adr-check と同じ形、[ADR 0016](0016-adr-check-warns-without-blocking.md))。CLI に基準の commit との差分を取る機能がないためです。
- **Dependabot**: alerts と malware alerts を有効にし、すでにある指摘の一覧にします。依存を上げる PR は Renovate が出すので ([ADR 0018](0018-renovate-for-pinned-versions.md))、security updates は無効のままにします。
- **抑制**: どの道具でも、理由を個別に書きます ([ADR 0017](0017-knip-unused-code.md) と同じ方針)。Semgrep は `# nosemgrep: <rule-id>` の後、OSV-Scanner は `osv-scanner.toml` の `reason`、CodeQL は dismiss の理由、dependency review は `allow-ghsas` の隣のコメントに書きます。
- **証拠**: OSV-Scanner の指摘は、SARIF にして Code scanning に送り、Security タブの alert の一覧で見て dismiss できるようにします ([Issue #313](https://github.com/yokozi-jp/agent-software-factory/issues/313))。CodeQL の default setup は GitHub 側で動くので、CodeQL のために workflow に権限は要りません。
  - `ci.yml` の `osv-scanner` の job が `github/codeql-action/upload-sarif` を使い、`category: osv-scanner` で CodeQL の alert と分けます。
  - 送るのは main への push のときだけです。fork の PR の token は書き込めず、PR ごとに alert が増えるのも避けます。スキャンが失敗して SARIF がなければ、送りません。
  - `security-events: write` を持つのはこの job だけで、ほかの job の権限は増やしません。
  - ゲートは変わらず CodeQL と dependency review です。`protect-main` の `code_scanning` の規則は道具に CodeQL だけを挙げているので、OSV-Scanner の alert で merge は止まりません。
  - Dependabot alerts と同じ脆弱性が二重に見えることは、判断として受け入れます。public のリポジトリでは Code scanning に追加の費用はありません。
  - 以前は SARIF を送らず、`security-events: write` も持たない方針でした ([ADR 0012](0012-lint-workflows.md) で zizmor-action を採らなかったのと同じ理由です)。alert を一覧にも dismiss もできず、CI のログの警告だけでは扱いにくかったため、OSV-Scanner についてこの方針を変えました。

## Considered Options

- **CodeQL の advanced setup**: workflow をリポジトリに置けますが、`security-events: write` が要ります。
- **Semgrep だけ、または CodeQL だけ**: CodeQL はローカルで手軽に動きません。Semgrep CE はファイルをまたぐ解析を有償版に持たせており、GitHub の code scanning とも直結しません。SAST を2つ重ねるのは、ゲートと、エージェントが早く受け取る写しで役割が違うためです。
- **Opengrep**: Semgrep の LGPL-2.1 の fork で、aqua で入り cosign の署名もあります。ただし公開の規則の `opengrep/opengrep-rules` は archived で、Registry の規則は Semgrep のための許諾です ([Semgrep Rules License v1.0](https://semgrep.dev/legal/rules-license))。
- **OSV-Scanner をゲートにする**: すべての指摘で失敗するので、PR が新しく持ち込んだ指摘だけで止める方針に合いません。公式の PR 用の workflow は差分を比べますが、PR ごとに SARIF を送り `security-events: write` が要ります ([OSV-Scanner の GitHub Action](https://google.github.io/osv-scanner/github-action/))。ゲートにしない代わりに、SARIF の送信だけを main への push に絞って採りました。
- **Trivy**: 2026-03 に release と action のタグを侵害されました。依存のスキャンは dependency review と、秘密情報は betterleaks と重なります。イメージと IaC の検査は、CD の流れを決めた後に決めます。
- **`pnpm audit`**: 差分で止められず、SARIF もありません。

## Consequences

- CodeQL と dependency review は、public のリポジトリでは無料ですが、private のリポジトリでは GitHub Advanced Security (GitHub Code Security) が要ります。GHAS のない private の派生プロジェクトでは、OSV-Scanner をゲートに格上げし、Semgrep を SAST のゲートにします。
- Semgrep の Registry の規則は、自分の業務の中では使えますが配布できません。規則をリポジトリに複製せず、実行のたびに取り寄せます。そのため CI と pre-push の hook はネットワークを使い、規則の版は固定できません。比べるのは差分だけなので、規則が変わったときの影響は小さくなります。
- Semgrep CE は PyPI にしかなく、mise の `pypi` backend が uv で入れます。2026-10-24 に、Semgrep 1.182.1、uv 0.13.5、Python 3.13.17 (python-build-standalone) を `mise.toml` で固定し、`mise lock` が依存のグラフ (wheel の hash、`.mise/locks/pypi-semgrep/1.182.1/uv.lock`) と、その digest を `mise.lock` に記録することを確かめました。sidecar の hash を1つ書き換えると、`mise install --locked` は `digest mismatch` で失敗します。Python は Semgrep の tool option (`python = "3.13.17"`) ではなく、ふつうの tool として固定しました。mise 2026.10.17 では tool option にすると、`mise lock` が呼ぶ uv がその Python を見つけられずに失敗したためです ([Issue #129](https://github.com/yokozi-jp/agent-software-factory/issues/129))。
- mise の `minimum_release_age` (供給網リスク対策の cooldown、新しすぎる版を避ける) は既定が `"24h"` の duration で、`now` を基準にします。`pypi` backend はこの cutoff を uv の `exclude-newer` として渡すので、sidecar の `uv.lock` を作り直すたびに `now-24h` の絶対時刻が焼かれ、semgrep の版を固定していても digest が毎回変わりました。Renovate の lock file maintenance はこの再生成を含むため、PR を merge しても次の実行で差分が復活し、同名の PR が繰り返し作られていました。cooldown は供給網防御なので外さず、`minimum_release_age` を duration ではなく固定日時 (`2026-10-24T00:00:00Z`、semgrep 1.182.1 を固定した日) にして lock を決定論にしました。semgrep の版を上げるときは、この日付も進めます (判断。固定日時にすると cutoff を人が進める必要があり、放置すると推移的依存のセキュリティ更新も止まります)。
- Registry の `p/typescript` の ERROR の規則は 24 個で、`require` で読み込んだ `jsonwebtoken` を使う書き方など、ライブラリを特定した規則が多くを占めます。`eval` のような一般の書き方は WARNING 以下なので、Semgrep の ERROR で止まるものは少なく、広い検出は CodeQL が担います。
- dependency review は、既定の runtime の依存だけでなく development の依存 (`fail-on-scopes: runtime, development`) でも止めます。Nx、Vite+、lint の道具は CI と開発者の手元で動くためです (判断)。
- 導入時の OSV-Scanner の警告は、development の依存の `undici@7.29.0` (Nx の依存、13 件) と `katex@0.16.47` (1 件) です。Renovate の PR か手で上げます。
- [保証カタログ](../tooling/assurance-catalog.md) に、CodeQL、dependency review、Semgrep の3行と、警告だけのセンサーとして OSV-Scanner の1行を足します。
- この ADR は、実装より前に書いた決定です。版と設定は上に書いたとおりに実装しました。
