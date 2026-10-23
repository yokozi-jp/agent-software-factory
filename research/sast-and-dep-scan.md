---
type: Reference
title: SAST と依存の脆弱性スキャンの道具を比べる
description: CodeQL、Semgrep、OSV-Scanner、Trivy、pnpm audit を、TypeScript monorepo 対応、public repo での無料範囲、SARIF 出力、誤検知の除外、Renovate との役割の重なりの観点で、一次資料で比べた調査。
tags: [research, security, sast, dependency-scan, codeql, semgrep, osv-scanner, trivy, pnpm-audit]
---

# SAST と依存の脆弱性スキャンの道具を比べる

## 問い

[Issue #36](https://github.com/yokozi-jp/hono-nx-vite-plus/issues/36): CodeQL、Semgrep、OSV-Scanner、Trivy、`pnpm audit` を比べる。観点は、TypeScript の monorepo への対応、public repository での無料の範囲、SARIF の出力、誤検知の除外の方法、Renovate と役割が重なるか。今日は 2026-10-23。

## 要約

- 道具は 2 種類に分かれる。CodeQL と Semgrep はコード自体を解析する SAST。OSV-Scanner、Trivy、`pnpm audit` は依存（ロックファイルの中身）の既知の脆弱性を調べる SCA。観点の「SAST と依存の脆弱性スキャン」はこの 2 層に対応する。
- CodeQL は JavaScript/TypeScript を一等の対象にし、GitHub の code scanning に SARIF をそのまま出し、public repository では無料 (出典: github/docs)。
- Semgrep は OSS (LGPL-2.1) で 30+ 言語、`--sarif` で SARIF を出し、`# nosemgrep` と `.semgrepignore` で誤検知を除外する (出典: semgrep/semgrep のソース)。クラウド機能やサプライチェーンは別の有償製品。
- OSV-Scanner (Apache-2.0) と Trivy (Apache-2.0) はともに SARIF v2.1.0 を出し、npm/pnpm のロックファイルを読む。Trivy は `pnpm-lock.yaml` を名指しで対応 (出典: 各 docs)。
- `pnpm audit` は pnpm に同梱で、GHSA で除外 (`audit.ignore`)、`--fix` で overrides を書く。SARIF 出力は持たない (出典: pnpm の docs)。
- Renovate (Issue #14) は依存を「更新する」道具で、脆弱性を「検出する」SCA とは役割が違う。ただし両者とも GitHub Advisory Database (GHSA) を参照源にできる点が重なる。Renovate 自身も vulnerability alert による更新 PR を作れる (未確認、二次的)。
- 判断: SAST 層と SCA 層は別々に 1 つずつ選ぶのが標準 (OWASP の分類)。両方を 1 つの道具に兼ねさせるのはアンチパターンで、どちらかの精度が落ちる。
- 判断の材料として、このリポジトリは pnpm monorepo で public、CI は GitHub Actions、既に betterleaks で secret scan を持つ (`.github/workflows/secret-scan.yml`)。

## 比較

| 道具          | 層                         | ライセンス/無料範囲 (public repo) | TypeScript monorepo 対応      | SARIF 出力                        | 誤検知の除外                                      | Renovate と役割                 |
| ------------- | -------------------------- | --------------------------------- | ----------------------------- | --------------------------------- | ------------------------------------------------- | ------------------------------- |
| CodeQL        | SAST                       | public repo は無料 (GitHub)       | JS/TS が一等対象              | ネイティブ (code scanning に直結) | アラートの dismiss、`// codeql[...]` / query 設定 | 重ならない (コード解析)         |
| Semgrep (OSS) | SAST                       | OSS (LGPL-2.1)、CLI は無料        | 30+ 言語に JS/TS 含む         | `--sarif`                         | `# nosemgrep`、`.semgrepignore`                   | 重ならない (コード解析)         |
| OSV-Scanner   | SCA                        | Apache-2.0、無料                  | npm 等のロックファイル対応    | `--format sarif` (v2.1.0)         | `osv-scanner.toml` の `IgnoredVulns`              | 一部重なる (脆弱性検出 vs 更新) |
| Trivy         | SCA (ほか IaC/secret/SBOM) | Apache-2.0、無料                  | `pnpm-lock.yaml` を名指し対応 | `--format sarif` (v2.1.0)         | `.trivyignore` / `.trivyignore.yaml`、Rego        | 一部重なる (脆弱性検出 vs 更新) |
| `pnpm audit`  | SCA                        | pnpm 同梱、無料                   | pnpm workspace をそのまま監査 | なし (`--json` のみ)              | `audit.ignore` (GHSA)、`--ignore`                 | 一部重なる (脆弱性検出 vs 更新) |

## CodeQL

- 対応言語に `JavaScript/TypeScript` が明記され、`javascript-typescript` で両方を解析する。出典: [github/docs `data/reusables/code-scanning/codeql-languages-bullets.md`](https://raw.githubusercontent.com/github/docs/main/data/reusables/code-scanning/codeql-languages-bullets.md) (取得 2026-10-23)。
- 無料範囲: 「Many of these features are available for **free for public repositories**」。出典: [github/docs `content/repositories/.../managing-security-and-analysis-settings-for-your-repository.md`](https://raw.githubusercontent.com/github/docs/main/content/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-security-and-analysis-settings-for-your-repository.md) (取得 2026-10-23)。CodeQL は `fpt or ghec` の版で有効。
- SARIF: code scanning は SARIF を取り込み、CodeQL は GitHub Actions の default/advanced setup で直接 code scanning に結果を出す。他の CI で走らせて SARIF を upload もできる。出典: [github/docs `data/reusables/code-scanning/enabling-options.md`](https://raw.githubusercontent.com/github/docs/main/data/reusables/code-scanning/enabling-options.md) (取得 2026-10-23)。
- monorepo: 言語単位で解析するため、pnpm monorepo でも JS/TS をまとめて対象にできる。パス単位の除外や複数言語の設定は advanced setup の config で行う (一次の詳細は未確認)。
- 誤検知の除外: code scanning のアラートを dismiss する運用が基本。CodeQL 固有の抑制は query filter / config で行う (一次の詳細は未確認)。

## Semgrep (OSS CLI)

- OSS。ライセンスは LGPL-2.1。「Semgrep is a fast, open-source, static analysis tool ... supports 30+ languages」。出典: [semgrep/semgrep `README.md`](https://raw.githubusercontent.com/semgrep/semgrep/develop/README.md) (取得 2026-10-23)。
- SARIF: CLI に `--sarif` フラグがあり、出力形式に `OutputFormat.SARIF` を持つ。出典: [semgrep/semgrep `cli/src/semgrep/commands/scan.py`](https://raw.githubusercontent.com/semgrep/semgrep/develop/cli/src/semgrep/commands/scan.py)、[`cli/src/semgrep/constants.py`](https://raw.githubusercontent.com/semgrep/semgrep/develop/cli/src/semgrep/constants.py) (取得 2026-10-23)。
- 誤検知の除外: 行末の `# nosemgrep` コメントで個別に抑制できる。出典: [semgrep/semgrep `cli/src/semgrep/rule_match.py`](https://raw.githubusercontent.com/semgrep/semgrep/develop/cli/src/semgrep/rule_match.py) (取得 2026-10-23)。ファイル単位の除外は `.semgrepignore` (一次の詳細は semgrep.dev の docs にあるが TLS で未取得、未確認)。
- monorepo: CLI は対象のディレクトリを再帰で走査するので、monorepo のルートで 1 回走らせれば全体を見る (一次の詳細は未確認)。
- 役割の重なり: Semgrep Supply Chain は依存の到達可能な脆弱性を見る別製品 (「supports 12 languages across 15 package managers」)。OSS CLI の SAST とは別で、ここでは SAST としてだけ数える。出典: README (同上)。

## OSV-Scanner

- OSS (google/osv-scanner)。SLSA 3 のバッジ。対応言語に Javascript、パッケージマネージャに npm/yarn を明記。出典: [google/osv-scanner `README.md`](https://raw.githubusercontent.com/google/osv-scanner/main/README.md) (取得 2026-10-23)。
- 参照源は OSV.dev。GitHub Security Advisories などのオープンな権威ある出典を集約する。出典: README (同上)。
- SARIF: `osv-scanner scan --format sarif` が SARIF v2.1.0 を出す。脆弱性 (alias でまとめる) を rule、脆弱な依存を持つパッケージを rule 違反として表す。GitHub Action は結果を security > code scanning タブに upload する。出典: [`docs/output.md`](https://raw.githubusercontent.com/google/osv-scanner/main/docs/output.md)、[`docs/github-action.md`](https://raw.githubusercontent.com/google/osv-scanner/main/docs/github-action.md) (取得 2026-10-23)。
- 誤検知の除外: スキャン対象のディレクトリに置く `osv-scanner.toml` の `[[IgnoredVulns]]` に `id` を書く。`ignoreUntil` で期限、理由も書ける。alias も一緒に無視する。出典: [`docs/configuration.md`](https://raw.githubusercontent.com/google/osv-scanner/main/docs/configuration.md) (取得 2026-10-23)。
- monorepo: 再帰スキャン (`-r`) で `package.json` や `package-lock.json` 等を見つける。pnpm のロックファイル対応の有無は supported-languages-and-lockfiles の docs に当たる必要がある (TLS で未取得、未確認)。

## Trivy

- OSS (aquasecurity/trivy、Apache-2.0)。Node.js は `npm`、`Yarn`、`pnpm`、`Bun` の 4 つに対応し、`pnpm-lock.yaml` を名指しで対応 (推移的依存に対応、開発依存は既定で除外)。出典: [aquasecurity/trivy `docs/guide/coverage/language/nodejs.md`](https://raw.githubusercontent.com/aquasecurity/trivy/main/docs/guide/coverage/language/nodejs.md) (取得 2026-10-23)。
- SARIF: 「SARIF ... complying with SARIF 2.1.0 OASIS standard can be generated with the `--format sarif` flag」。GitHub code scanning に upload でき、Trivy GitHub Action がある。出典: [`docs/guide/configuration/reporting.md`](https://raw.githubusercontent.com/aquasecurity/trivy/main/docs/guide/configuration/reporting.md) (取得 2026-10-23)。
- 誤検知の除外: `.trivyignore` と `.trivyignore.yaml` の ignore ファイルで ID を無視する。`.trivyignore.yaml` は `vulnerabilities`/`misconfigurations`/`secrets`/`licenses` を分けて書けるが experimental で `--ignorefile` の明示が要る。Rego でも抑制できる。`--show-suppressed` で抑制結果を表示。出典: [`docs/guide/configuration/filtering.md`](https://raw.githubusercontent.com/aquasecurity/trivy/main/docs/guide/configuration/filtering.md) (取得 2026-10-23)。
- 広さ: Trivy は依存の脆弱性だけでなく IaC の誤設定、secret、ライセンス、SBOM、コンテナイメージも 1 つで扱う。出典: docs のツリー構成 (`docs/guide/scanner/` 配下に misconfiguration、secret、license、supply-chain)。地図の「デプロイ先が決まってから」の項 (イメージのスキャン、SBOM) と重なる余地がある。

## pnpm audit

- pnpm に同梱のコマンド。v11 以降は registry の `/-/npm/v1/security/advisories/bulk` に問い合わせ、advisory は GHSA で絞る。出典: [pnpm/pnpm.io `docs/cli/audit.md`](https://raw.githubusercontent.com/pnpm/pnpm.io/main/docs/cli/audit.md) (取得 2026-10-23)。
- 誤検知の除外: `pnpm-workspace.yaml` の `audit.ignore` に GHSA を列挙する (旧 `auditConfig.ignoreGhsas`)。`--ignore GHSA-...` でも書き込める。v11 より前は CVE だったが今は GHSA。出典: audit.md (同上)。
- 修正: `--fix` は `pnpm-workspace.yaml` に overrides を書いて非脆弱な版を強制する。`--fix=update` でロックファイル側を更新する。出典: audit.md (同上)。
- SARIF: 出力は table と `--json` のみで、SARIF は持たない。出典: audit.md の Options に SARIF の記載なし (取得 2026-10-23)。
- monorepo: pnpm workspace をそのまま監査する。`--dev`/`--prod`/`--no-optional` で範囲を絞れる。出典: audit.md (同上)。

## Renovate との役割の重なり (Issue #14)

- Issue #14 は Renovate で `mise.toml`/`mise.lock`、GitHub Actions の SHA pin、pnpm catalog の固定版を自動更新する作業。参照は [Renovate の mise manager の docs](https://docs.renovatebot.com/modules/manager/mise/)。出典: [Issue #14](https://github.com/yokozi-jp/hono-nx-vite-plus/issues/14)。
- Renovate は依存を「新しい版に更新する」道具。SCA (OSV-Scanner、Trivy、`pnpm audit`) は依存の「既知の脆弱性を検出する」道具。目的が違う。
- 重なる点: 参照源。SCA は GitHub Advisory Database (GHSA) / OSV を見る。Renovate も vulnerability alert を使って脆弱性ドリブンの更新 PR を出せる (Renovate 公式に `vulnerabilityAlerts` の設定があるはずだが、TLS で未取得、二次的・未確認)。重なりを避けるなら、SCA は「検出とゲート」、Renovate は「更新 PR」と役割を分けるのが素直。
- 判断: 依存の更新 (Renovate) と脆弱性の検出 (SCA) は別の道具に分けるのが標準。1 つに兼ねさせると、更新が止まった依存の脆弱性を見逃す、あるいは脆弱性と無関係な更新 PR に埋もれるアンチパターンになる。

## 未確認のこと

- Semgrep の `.semgrepignore` の正確な書式と monorepo でのパス解決 (semgrep.dev が TLS 検証に失敗し、一次 docs を未取得)。
- OSV-Scanner が pnpm の `pnpm-lock.yaml` を直接のロックファイルとして対応するか (supported-languages-and-lockfiles の docs を未取得。README では npm/yarn は明記、pnpm は未確認)。
- CodeQL の advanced setup でのパス除外、複数言語・monorepo 向け config の正確な書式 (一次 docs の本文を未取得)。
- Renovate の `vulnerabilityAlerts` / OSV 連携の正確な仕様 (docs.renovatebot.com を未取得)。
- 各道具の最新バージョン番号と、その版での挙動 (今回は main/develop ブランチの docs とソースを根拠にした。固定版での差分は未確認)。
- GitHub code scanning に third-party の SARIF を upload する機能の、private repo での課金条件 (public repo が無料であることは確認。private は未確認)。

## 出典

- Issue #36: <https://github.com/yokozi-jp/hono-nx-vite-plus/issues/36>
- Issue #14 (Renovate): <https://github.com/yokozi-jp/hono-nx-vite-plus/issues/14>
- CodeQL 対応言語: <https://raw.githubusercontent.com/github/docs/main/data/reusables/code-scanning/codeql-languages-bullets.md>
- CodeQL enabling options: <https://raw.githubusercontent.com/github/docs/main/data/reusables/code-scanning/enabling-options.md>
- public repo の無料範囲: <https://raw.githubusercontent.com/github/docs/main/content/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-security-and-analysis-settings-for-your-repository.md>
- Semgrep README: <https://raw.githubusercontent.com/semgrep/semgrep/develop/README.md>
- Semgrep scan コマンド (`--sarif`): <https://raw.githubusercontent.com/semgrep/semgrep/develop/cli/src/semgrep/commands/scan.py>
- Semgrep 出力形式: <https://raw.githubusercontent.com/semgrep/semgrep/develop/cli/src/semgrep/constants.py>
- Semgrep nosemgrep: <https://raw.githubusercontent.com/semgrep/semgrep/develop/cli/src/semgrep/rule_match.py>
- OSV-Scanner README: <https://raw.githubusercontent.com/google/osv-scanner/main/README.md>
- OSV-Scanner 出力 (SARIF): <https://raw.githubusercontent.com/google/osv-scanner/main/docs/output.md>
- OSV-Scanner GitHub Action: <https://raw.githubusercontent.com/google/osv-scanner/main/docs/github-action.md>
- OSV-Scanner 設定 (IgnoredVulns): <https://raw.githubusercontent.com/google/osv-scanner/main/docs/configuration.md>
- Trivy Node.js 対応: <https://raw.githubusercontent.com/aquasecurity/trivy/main/docs/guide/coverage/language/nodejs.md>
- Trivy レポート (SARIF): <https://raw.githubusercontent.com/aquasecurity/trivy/main/docs/guide/configuration/reporting.md>
- Trivy フィルタ (.trivyignore): <https://raw.githubusercontent.com/aquasecurity/trivy/main/docs/guide/configuration/filtering.md>
- pnpm audit: <https://raw.githubusercontent.com/pnpm/pnpm.io/main/docs/cli/audit.md>
- 既存の CI: `.github/workflows/ci.yml`、`.github/workflows/secret-scan.yml`
