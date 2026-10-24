---
type: Reference
title: コンテナイメージの検査、スキャン、署名、SBOM と provenance の道具を比べる
description: ECS 用のコンテナイメージと Lambda 用の zip に付ける道具（hadolint、Trivy、Grype、Syft、Amazon Inspector、Docker Scout、cosign、AWS Signer と ECR managed signing、Lambda のコード署名、GitHub の artifact attestations、docker buildx の attestation）を、強制できるか、mise で固定できるか、GitHub Actions での動かし方、ライセンス、費用、保守の状況の観点で、一次資料と手元の実験で比べた調査。
tags: [research, security, supply-chain, container, lambda, sbom, slsa, sigstore, trivy, hadolint]
---

# コンテナイメージの検査、スキャン、署名、SBOM と provenance の道具を比べる

## 問い

[コンテナイメージの検査、スキャン、署名、SBOM と provenance の道具を比べる](https://github.com/yokozi-jp/agent-software-factory/issues/87) の調査。前提は [デプロイ先と実行基盤を決める](https://github.com/yokozi-jp/agent-software-factory/issues/25) の決め直しのコメントと ADR 0013 で、成果物は次の2種類。

- ECS 用のコンテナイメージ 1 つ（API、ワーカー、バッチ）。ECR に置く。
- Lambda 用の zip。API は Web Functions、ワーカーは Event Functions（`nodejs24.x`）。

観点は次のとおり。

- Dockerfile の検査（hadolint など）。
- イメージの脆弱性のスキャン（Trivy、Grype、ECR の Inspector のスキャン、Docker Scout など）。[SAST と依存の脆弱性スキャンの道具を比べる](https://github.com/yokozi-jp/agent-software-factory/issues/36) と重なる部分。
- イメージの署名と検証（cosign、AWS Signer と ECR managed signing）。ECS で検証を強制できるか。
- Lambda の zip の署名（Lambda のコード署名と AWS Signer）。Web Functions と Event Functions の両方で強制できるか。
- SBOM と provenance（SLSA 1.2）を何に付けるか。形式、道具、GitHub の artifact attestations との関係。
- それぞれ、mise で版を固定できるか（ADR 0009）、GitHub Actions でどう動かすか、ライセンス、費用、保守の状況と最新の版。

SAST と、ロックファイルを読む依存のスキャン（CodeQL、Semgrep、OSV-Scanner、Trivy、`pnpm audit`）は、上の調査で比べた。ここでは繰り返さず、成果物（イメージと zip）に固有の部分だけを調べる。調べた日は 2026-10-24。mise は 2026.10.17、Docker は 29.9.1（buildx 0.38.0）。AWS のリソースは作っていない。

## 要約

- Dockerfile の検査は hadolint 2.15.1（GPL-3.0、2026-07-31）が定番で、mise の aqua で固定できる。docker の build checks（`docker build --check`、Dockerfile 1.8 から）と Trivy の `trivy config` も Dockerfile を検査する。実験では、hadolint が 4 件、Trivy が HEALTHCHECK などを含む指摘、build checks が 1 件（CMD の JSON 形式）を出した。
- イメージのスキャンは、Trivy 0.76.1 と Grype 0.121.0（どちらも Apache-2.0）を mise で固定して CI で動かせる。ECR の enhanced scanning（Amazon Inspector）は push の後に継続してスキャンするが、Inspector の料金がかかる。basic scanning は OS のパッケージだけを見る。Docker Scout は Docker の利用規約のもとの製品で、Personal のプランは 1 リポジトリまで、mise の registry にない。
- Trivy は 2026-03-19 に、悪意のある v0.69.4 の release と、`aquasecurity/trivy-action` の 77 個のうち 76 個のタグの書き換えを受けた（GHSA-69fq-xp46-6x23）。commit SHA で固定した action と、digest で参照したイメージは影響を受けなかったと advisory に書かれている。mise.lock の checksum と cosign の検証で入れる形（ADR 0009）は、この種類の攻撃を防ぐ側にある。
- 署名は 2 系統ある。Sigstore（cosign、GitHub の artifact attestations）と、AWS Signer（Notation の形式。ECR managed signing は push のときに自動で署名する）。ECS には EKS のような実行時の検証の強制がなく、AWS の docs が示す方法は、サービスのデプロイの lifecycle hook（Lambda）で検証して失敗させる形。lifecycle hook は blue/green、linear、canary のデプロイの機能で、締めのバッチ（Step Functions からの RunTask）には効かない。
- Lambda のコード署名（AWS Signer、`Enforce`）は Event Functions には使え、IAM の `lambda:CodeSigningConfigArn` で設定を必須にできる。Web Functions には使えないと Lambda の docs に明記されている。Web Functions のコードは、版を管理した S3 の object を revision が直接参照する形で、整合性は S3 の書き込みの権限と、デプロイの前の検証で守ることになる。
- provenance は、GitHub の `actions/attest`（v4.2.2）で、イメージと zip の両方に SLSA の build provenance（in-toto、Sigstore の bundle）を付けられる。GitHub の docs では、これだけで SLSA Build L2、reusable workflow で作れば L3。イメージには `push-to-registry` で ECR に OCI の referrer として置ける。public のリポジトリでは無料だが、private のリポジトリでは GitHub Enterprise Cloud が要る。
- SBOM は Syft 1.55.0 か Trivy で SPDX 2.3 か CycloneDX 1.7 の JSON を作り、`actions/attest` の `sbom-path` で成果物に結び付けられる。docker buildx の SBOM と provenance の attestation は image index に入るが、既定の provenance は SLSA v0.2 の形式。zip とディレクトリでは、Syft と Trivy の既定はロックファイルしか見ないので、`node_modules` を見る設定（Syft の `javascript-package-cataloger`、`trivy rootfs`）が要る（実験）。npm には何も publish していないので、npm の provenance は今は対象の外。
- 判断: 第一候補は、hadolint と Trivy（か Grype）と Syft を mise で固定し、`actions/attest` でイメージと zip に provenance と SBOM を付け、デプロイの前に `gh attestation verify` で検証して digest でデプロイする形。Event Functions には Lambda のコード署名を `Enforce` で足す案がある。ECR managed signing と ECS の lifecycle hook は、強制まで要る案件の選択肢にする。決めるのは後の grilling のチケット。

## 比較

### 道具

| 道具                                      | 役割                                    | 最新の版（日付）                | ライセンス                            | mise（ADR 0009）                                                      | GitHub Actions                                                       | 費用                                         |
| ----------------------------------------- | --------------------------------------- | ------------------------------- | ------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------- |
| hadolint                                  | Dockerfile の検査                       | 2.15.1（2026-07-31）            | GPL-3.0                               | `aqua:hadolint/hadolint`。checksum と GitHub の artifact attestations | `mise exec -- hadolint`。`hadolint/hadolint-action` v3.5.0 もある    | 無料                                         |
| docker build checks                       | Dockerfile の検査                       | buildx 0.15.0 以上              | Apache-2.0（buildx）                  | 対象外（Docker に同梱）                                               | `docker/build-push-action` 6.6.0 以上で自動。PR の差分に注釈         | 無料                                         |
| Trivy                                     | イメージ、rootfs、Dockerfile、SBOM      | 0.76.1（2026-10-21）            | Apache-2.0                            | `aqua:aquasecurity/trivy`。checksum と cosign                         | `mise exec -- trivy`。`aquasecurity/trivy-action` v0.36.0 もある     | 無料                                         |
| Grype                                     | イメージ、ディレクトリ、SBOM のスキャン | 0.121.0（2026-10-19）           | Apache-2.0                            | `aqua:anchore/grype`。checksum と cosign                              | `mise exec -- grype`。`anchore/scan-action` v7.4.2（MIT）もある      | 無料                                         |
| Syft                                      | SBOM の生成                             | 1.55.0（2026-10-19）            | Apache-2.0                            | `aqua:anchore/syft`。checksum と cosign                               | `mise exec -- syft`。`anchore/sbom-action` v0.24.3 もある            | 無料                                         |
| ECR basic scanning                        | OS のパッケージのスキャン               | （マネージド）                  | AWS                                   | 対象外                                                                | push のときか手動                                                    | 追加の料金なし（未確認）                     |
| ECR enhanced scanning（Amazon Inspector） | OS と言語のパッケージの継続スキャン     | （マネージド）                  | AWS                                   | 対象外                                                                | push の後に AWS 側で動く                                             | Inspector の料金（イメージ数と再スキャン数） |
| Docker Scout                              | イメージのスキャンと方針                | scout-cli v1.27.0（2026-10-21） | Docker Subscription Service Agreement | registry にない                                                       | `docker/scout-action` v1.27.0。Docker のアカウントが要る             | Personal は 1 リポジトリまで                 |
| cosign                                    | Sigstore の署名と検証                   | 3.1.4（2026-10-20）             | Apache-2.0                            | `aqua:sigstore/cosign`。checksum と cosign                            | `mise exec -- cosign`。`sigstore/cosign-installer` v4.1.2 もある     | 無料（public の Sigstore）                   |
| `actions/attest`                          | provenance、SBOM の attestation         | v4.2.2（2026-08-04）            | MIT                                   | 対象外（action）                                                      | `id-token: write`、`attestations: write`、`artifact-metadata: write` | public は無料。private は GHEC               |
| `gh attestation verify`                   | attestation の検証                      | gh 2.103.0                      | MIT                                   | `aqua:cli/cli`                                                        | runner に入っている gh か mise の gh                                 | 無料                                         |
| AWS Signer と Notation                    | Notation の形式の署名（イメージ）       | Notation 1.3.2                  | Apache-2.0（Notation）                | `aqua:notaryproject/notation`。Signer の plugin は registry にない    | 手動の署名か、ECR managed signing                                    | 追加の料金なし                               |
| Lambda のコード署名                       | zip の署名の検証（デプロイのとき）      | （マネージド）                  | AWS                                   | 対象外                                                                | Signer の signing job（S3）と、関数の code signing config            | 追加の料金なし                               |

最新の版は `git ls-remote --tags` と GitHub の releases で、ライセンスは GitHub の repository の情報で、mise の backend は `mise registry` で確かめた（2026-10-24）。

### 成果物ごとの付け方

| 成果物                 | 検査とスキャン                                                  | 署名と強制                                                                                      | provenance と SBOM                                                               |
| ---------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ECS のイメージ（ECR）  | hadolint、Trivy か Grype（CI）、ECR のスキャン（push の後）     | cosign か GitHub の attestation（CI で検証）。ECR managed signing。ECS の lifecycle hook で検証 | `actions/attest` の `push-to-registry`（OCI の referrer）。buildx の attestation |
| Event Functions の zip | Trivy の `rootfs` か Syft と Grype（`node_modules` を見る設定） | Lambda のコード署名（`Enforce`）で強制できる                                                    | `actions/attest` の `subject-path`（GitHub に保存）                              |
| Web Functions の zip   | 同上                                                            | コード署名は使えない。S3 の書き込みの権限と、デプロイの前の検証                                 | 同上                                                                             |
| npm のパッケージ       | 対象外（publish しない）                                        | 対象外                                                                                          | publish するなら trusted publishing で自動の provenance                          |

## Dockerfile の検査

- hadolint は Dockerfile を AST にして規則（DL と ShellCheck の SC）で検査する。ライセンスは GPL-3.0 で、最新は 2.15.1（2026-07-31）。リポジトリの最後の push は 2026-10-19 で、保守は続いている（GitHub の API で確認）。
- mise の registry では `aqua:hadolint/hadolint` が先頭にある。aqua の定義には、release の `checksums.sha256` による checksum と、`hadolint/hadolint/.github/workflows/release.yml` を署名者にした GitHub の artifact attestations の検証が書かれている（[aqua-registry の定義](https://github.com/aquaproj/aqua-registry/blob/main/pkgs/hadolint/hadolint/registry.yaml)）。
- docker の build checks は Dockerfile 1.8 からの機能で、buildx 0.15.0 以上と `docker/build-push-action` 6.6.0 以上で動き、ビルドのたびに既定で検査する。GitHub Actions では PR の差分に注釈が付く（[Docker: Build checks](https://docs.docker.com/build/checks/)）。
- Trivy も `trivy config` で Dockerfile の設定の誤りを検査する（DS の規則）。
- 実験: 次の Dockerfile を 3 つの道具で検査した。

  ```dockerfile
  FROM node:24-slim
  RUN apt-get update && apt-get install -y curl
  WORKDIR /app
  COPY package.json ./
  RUN npm install
  COPY . .
  CMD node server.js
  ```

  - `mise exec hadolint@2.15.1 -- hadolint Dockerfile`: DL3008（apt の版を固定する）、DL3009（apt の lists を消す）、DL3015（`--no-install-recommends`）、DL3025（CMD を JSON 形式にする）の 4 件で、終了コードは 1。
  - `trivy config Dockerfile`（0.76.1）: DS-0002（root で動く）、DS-0026（HEALTHCHECK がない）、DS-0029（`--no-install-recommends`）など。
  - `docker build --check .`（buildx 0.38.0）: JSONArgsRecommended の 1 件だけ。

- 判断: 規則の数は hadolint が一番多く、Dockerfile の lint の定番。build checks はビルドのついでに無料で付くので、hadolint と重ねても費用はない。Trivy をイメージのスキャンに使うなら、`trivy config` は IaC（CDK の出力の CloudFormation）にも使える。

## イメージの脆弱性のスキャン

### Trivy と Grype

- どちらも OS のパッケージ（Debian など）と、イメージの中の言語のパッケージ（`node_modules` の `package.json`）を見る。Trivy は Apache-2.0 で 0.76.1（2026-10-21）、Grype は Apache-2.0 で 0.121.0（2026-10-19）。
- mise の aqua の定義では、Trivy と Grype は release の checksums を cosign で検証する。実験で `mise install trivy@0.76.1` を詳細のログで実行すると、`verify checksums with cosign` の段があり、`trivy_0.76.1_checksums.txt.sigstore.json` を取得した。
- 実験: `node:24-slim`（digest `sha256:55fb5f5a527e…`、Debian 12.15）を、2026-10-24 の DB でスキャンした。
  - `trivy image --severity HIGH,CRITICAL`: Debian のパッケージで 57 件。`--ignore-unfixed` を付けると 4 件。DB の取得を含めて 45 秒。
  - `syft` で作った CycloneDX を `grype --only-fixed` で読むと、High 3 件、Medium 8 件、Low 1 件。DB の取得を含めて 4 分 37 秒（この環境は TLS 検査のプロキシを通る）。
  - 同じ CycloneDX を `trivy sbom --ignore-unfixed` で読むと、HIGH と CRITICAL で 4 件。直接のスキャンと同じ件数だった。
- 判断: 件数は DB と重大度の付け方で変わる。直せないもの（unfixed）を含めると件数が大きくなり、CI を止める条件にすると運用できない。CI を止める条件は「直せるもの」に絞るのがふつう（Trivy の `--ignore-unfixed`、Grype の `--only-fixed`）。

### Trivy の 2026-03 の侵害

- 2026-03-19 に、盗まれた credential で、悪意のある Trivy v0.69.4 が release され、`aquasecurity/trivy-action` の 77 個のうち 76 個のタグと、`aquasecurity/setup-trivy` の 7 個すべてのタグが、credential を盗むコードに書き換えられた。2026-03-22 には Docker Hub に悪意のある v0.69.5 と v0.69.6 のイメージが置かれた（[GHSA-69fq-xp46-6x23](https://github.com/advisories/GHSA-69fq-xp46-6x23)、CVE-2026-33634）。
- advisory は、digest で参照したイメージと、安全な commit の SHA で固定した action は影響を受けなかったとし、action を commit の SHA で固定するよう勧めている。trivy-action は中で setup-trivy を呼ぶので、2025-04-09 より前の commit に固定していた場合は、setup-trivy の側から悪意のあるコードが入り得たとも書かれている。修正の版は trivy-action 0.35.0、setup-trivy 0.2.6。
- 判断: CI で Trivy を使うなら、trivy-action（中でさらに action と binary を取る）より、mise.lock の checksum と cosign の検証で binary を入れて `mise exec -- trivy` で呼ぶ形の方が、取りに行くものが少ない。ADR 0009 の形のままで済む。

### ECR のスキャン（Amazon Inspector）

- ECR には basic scanning と enhanced scanning がある。basic は AWS の技術と CVE の DB で OS のパッケージだけを見て、push のときか手動で動く。enhanced は Amazon Inspector との統合で、OS と言語のパッケージを見て、push のときと継続のスキャンを選べ、新しい脆弱性が出ると結果を更新して EventBridge に通知する（[ECR: Scan images for software vulnerabilities](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html)）。
- enhanced scanning は ECR としての追加の料金はないが、Inspector の料金がかかる。イメージが ECS と EKS でどう使われているか（最後に使った時刻、クラスターの数）も見せる。有効にした最初は、過去 14 日に push したイメージだけを対象にする（[ECR: enhanced scanning](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning-enhanced.html)）。
- Inspector の料金は、ECR に push したイメージの初回のスキャンの数と、継続のスキャンでの再スキャンの数で決まる。CI から呼ぶスキャン（Inspector SBOM Generator と Scan API）と SBOM を渡す API は、1 回 0.03 USD と料金のページに書かれている。新しいアカウントには 15 日の無料の期間がある（[Amazon Inspector pricing](https://aws.amazon.com/inspector/pricing/)）。東京の ECR のスキャンの単価は、料金のページの表が JavaScript で描かれるので読み取れなかった（未確認）。
- Inspector には Lambda のスキャンもあり、Lambda standard scanning は `nodejs24.x` に対応している。対象は、過去 90 日に呼ばれたか更新された `$LATEST` の関数（[Inspector: Lambda scanning](https://docs.aws.amazon.com/inspector/latest/user/scanning-lambda.html)、[Supported runtimes](https://docs.aws.amazon.com/inspector/latest/user/supported.html)）。Web Functions が対象になるかは docs に書かれていない（未確認）。
- 判断: ECR のスキャンは、デプロイした後に出た脆弱性に気づくためのもので、CI のスキャン（デプロイの前に止める）と役割が違う。ADR 0013 の検証環境は常には置かないので、継続のスキャンの価値は、案件で本番を置いたときに出る。

### Docker Scout

- Docker Scout はイメージから SBOM を作り、脆弱性の DB と照らす。Personal のサブスクリプションは 1 リポジトリまで（[Docker Scout](https://docs.docker.com/scout/)）。CLI は Docker Subscription Service Agreement のもとで提供される（[scout-cli の README](https://github.com/docker/scout-cli)）。
- mise の registry にはない（`mise registry docker-scout` は not found）。GitHub Actions の `docker/scout-action` は Docker のアカウントでのログインを前提にする。
- 判断: OSS でなく、アカウントと credential が要り、ADR 0009 の形で入れられないので、テンプレートの既定には向かない。

### SAST と依存の脆弱性スキャンの道具を比べる との重なり

- 上の調査は、ロックファイル（`pnpm-lock.yaml`）を読む SCA として OSV-Scanner、Trivy、`pnpm audit` を比べた。イメージのスキャンが足すのは、ベースイメージの OS のパッケージと、イメージに実際に入った `node_modules` の 2 つ。
- 判断: SCA に Trivy を選ぶなら、同じ binary で `trivy fs`（ロックファイル）、`trivy image`（イメージ）、`trivy rootfs`（zip を展開したもの）、`trivy config`（Dockerfile）を回せ、道具が 1 つで済む。OSV-Scanner を選ぶなら、イメージには Trivy か Grype を別に足すことになる。

## イメージの署名と検証

### Sigstore（cosign と GitHub の artifact attestations）

- Sigstore の keyless の署名は、OIDC の ID と結び付いた短命の証明書を Fulcio が出し、署名を透明性ログの Rekor に記録する。GitHub Actions のような自動の環境では、OIDC の ID token を直接使える（[Sigstore: Signing overview](https://docs.sigstore.dev/cosign/signing/overview/)）。検証では、`--certificate-identity` と `--certificate-oidc-issuer` で、誰が署名したはずかを指定する（[Sigstore: Verifying](https://docs.sigstore.dev/cosign/verifying/verify/)）。
- cosign v3 は、新しい bundle の形式（`--new-bundle-format`）、trusted root と signing config のファイル、OCI Image 1.1 の referrer としての署名の保存を、既定で有効にした（[cosign の CHANGELOG の v3.0.0](https://github.com/sigstore/cosign/blob/main/CHANGELOG.md)）。最新は 3.1.4（2026-10-20）。
- ECR は 2024-06 から OCI Image と Distribution の 1.1 に対応し、署名や SBOM を referrer として置け、レプリケーションと lifecycle policy も referrer を扱う（[AWS What's New 2024-06-27](https://aws.amazon.com/about-aws/whats-new/2024/06/amazon-ecr-oci-image-distribution-version-1-1/)）。
- `actions/attest` は、成果物の digest を in-toto の statement に入れ、Sigstore の短命の証明書で署名し、GitHub の attestations API に保存する。public のリポジトリは public good の Sigstore を、private のリポジトリは GitHub の Sigstore を使う。イメージなら `push-to-registry: true` でレジストリにも置ける（[actions/attest の README](https://github.com/actions/attest)）。
- `actions/attest-build-provenance` は v4 から `actions/attest` の薄い wrapper になり、新しく使うなら `actions/attest` を使うよう README に書かれている（[actions/attest-build-provenance の README](https://github.com/actions/attest-build-provenance)）。
- GitHub の private の Sigstore は、public のものと同じコードだが透明性ログを持たない（[GitHub: Artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)）。判断: SI の案件のような private のリポジトリから cosign で public の Sigstore に署名すると、証明書に入るリポジトリと workflow の名前が公開のログに残る。private のリポジトリなら、GitHub の attestations（GHEC が要る）か AWS Signer の方が合う。

### AWS Signer と ECR managed signing

- ECR は AWS Signer と組んで、managed signing（推奨）と manual signing（Notation の CLI と Signer の plugin）の 2 つの署名の方法を持つ。署名は referrer としてリポジトリに置かれ、イメージの数の quota に 1 つずつ数えられる（[ECR: Sign images](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-signing.html)）。
- managed signing は、レジストリの signing configuration（Signer の signing profile と、リポジトリの名前のフィルター）に従い、push したときに、push した主体の ID で自動で署名する。push する主体には `signer:SignPayload` の権限が要る。規則はレジストリごとに 10 個まで。region をまたぐ署名はできず、アカウントをまたぐ署名はできる。手で検証するなら Notation の CLI が要る（[ECR: Managed signing](https://docs.aws.amazon.com/AmazonECR/latest/userguide/managed-signing.html)）。
- Signer は、Lambda、ECR、EKS、ほかのコンテナのサービスで使う分には追加の料金がない（[Signer: Pricing](https://docs.aws.amazon.com/signer/latest/developerguide/whatis-pricing.html)）。
- Notation は `aqua:notaryproject/notation` で mise に入る（1.3.2）。AWS Signer の plugin は mise の registry にない（未確認: plugin の入れ方を CI で固定する方法）。

### ECS で検証を強制できるか

- ECR の docs が挙げる検証の方法は 3 つ。EKS のマネージドの検証（コンテナを動かす前に自動で検証する）、ECS のサービスのデプロイの lifecycle hook から Lambda で検証する方法、Notation の CLI による手動の検証（[ECR: Signature verification](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-signing-verification.html)）。ECS には EKS のような実行時の強制の機能がない。
- ECS の Lambda hook は、デプロイの段階（`PRE_SCALE_UP` など）で Lambda を呼び、`FAILED` を返すとデプロイを前のサービスの revision に戻す。関数が失敗するか、正しい `hookStatus` を返さなくても戻す（[ECS: Lambda hooks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/lambda-lifecycle-hooks.html)、[ECS: Lifecycle hooks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-lifecycle-hooks.html)）。
- lifecycle hook は blue/green、linear、canary のデプロイの docs に書かれ、rolling update（`ECS`）のデプロイの docs には書かれていない（[blue/green](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html)、[linear](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-linear.html)、[rolling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html)）。hook はサービスのデプロイの機能なので、サービスでない RunTask（締めのバッチ）には効かない（判断）。
- ECR の docs が案内する Signer の「Verify container image signatures for Amazon ECS」のページ（`ecs-verification.html`）は、2026-10-24 には Signer の docs の目次になく、URL は docs の入口に転送された（未確認: ページの移動先）。
- ECS は既定で、タスク定義のイメージのタグをデプロイのときに digest に解決し、サービスのすべてのタスクで同じイメージを使う（`versionConsistency`、[ECS: rolling update](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html)）。ECR はタグの上書きを禁じる設定（tag immutability）を持つ（[ECR: image tag mutability](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html)）。
- 判断: ECS で一番簡単に効くのは、CI で `gh attestation verify`（か `cosign verify`）を通してから、検証した digest をタスク定義に書いてデプロイする形。デプロイの権限を CI の role だけに絞れば、実質の強制になる。避けるアンチパターンは、可変のタグ（`latest` など）でデプロイすることと、署名を作るだけで検証しないこと（GitHub の docs も「attestation は検証して初めて意味がある」と書いている）。

## Lambda の zip の署名

- Lambda のコード署名は、AWS Signer で署名したコードのパッケージだけをデプロイさせる機能。関数に code signing config を付けると、新しいデプロイごとに、整合性、期限、signing profile、失効を検証する。検証はデプロイのときだけで、実行には影響しない。`UntrustedArtifactOnDeployment` が `Warn`（既定）なら警告だけで、`Enforce` ならデプロイを止める。追加の料金はない。layer も署名が要る（[Lambda: code signing](https://docs.aws.amazon.com/lambda/latest/dg/configuration-codesigning.html)）。
- 同じページに、コード署名は .zip かコンテナイメージの Event Functions に適用され、**Web Functions と Lambda MicroVMs には使われない**と明記されている。一方、作成の手順のページは「コンテナイメージの関数はコード署名に対応しない」と書いていて、docs の中で食い違っている（[Lambda: Creating code signing configurations](https://docs.aws.amazon.com/lambda/latest/dg/configuration-codesigning-create.html)）。zip を使うこのリポジトリには影響しない。
- 管理者は IAM の `lambda:CodeSigningConfigArn` の条件で、`CreateFunction` に特定の code signing config を必須にできる（[Lambda: IAM policies for code signing](https://docs.aws.amazon.com/lambda/latest/dg/config-codesigning-policies.html)）。既存の関数に後から付けても、すでに動いている署名のないコードは次のデプロイまで動き続ける。
- Web Functions のコードは、版を管理した S3 の bucket の .zip だけで、revision は特定の object の版を直接参照する。bucket は S3 versioning が必須で、Lambda のサービスの principal に `s3:GetObject` と `s3:GetObjectVersion` を許す（[Web Functions: Deploying code from S3](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-code-s3.html)）。コードを置く主体（`s3:PutObject`）と、revision を作る主体（`lambda:CreateWebFunctionRevision`）は別の権限になる（[Web Functions: permissions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-permissions.html)）。
- 判断: Event Functions はコード署名を `Enforce` にし、IAM の条件で config を必須にすれば、AWS の側で強制できる。Web Functions は強制の機能がないので、S3 の bucket に書ける主体を CI の role だけに絞り、CI で zip の attestation を `gh attestation verify` で検証してから revision を作る形になる。API とワーカーで守り方が分かれるのは、ADR 0013 で zip を 2 種類の関数に置くと決めたことの費用の一つ。

## SBOM と provenance

### SLSA 1.2

- SLSA の仕様の最新は v1.2（Approved）で、Build Track と、1.2 で戻ってきた Source Track を持つ（[SLSA specification](https://slsa.dev/spec/v1.2/)）。
- Build Track の段階は L1（provenance がある）、L2（hosted のビルドの基盤が署名した provenance）、L3（hardened なビルドの基盤）（[SLSA: Build Track Basics](https://slsa.dev/spec/v1.2/build-track-basics)）。
- GitHub の artifact attestations は、それだけで SLSA v1.0 の Build L2 を満たし、組織で共有する reusable workflow でビルドすれば Build L3 を満たすと GitHub の docs に書かれている。attestation は作るだけでは意味がなく、検証して初めて効くとも書かれている（[GitHub: Artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)）。
- GitHub の docs は、テストのためだけの頻繁なビルドには署名しないよう勧めている（同）。判断: attestation は、デプロイする成果物（ECR に push するイメージと、S3 に置く zip）を作る workflow でだけ作る。

### 何に付けるか

- イメージ: `docker/build-push-action` の出力の digest を `actions/attest` の `subject-digest` に渡し、`push-to-registry: true` で ECR に置く（[actions/attest の README](https://github.com/actions/attest) の Container Image）。SBOM も `sbom-path` で同じイメージに結び付けられる。
- Lambda の zip: `actions/attest` の `subject-path` に zip を渡す。attestation は GitHub の API に保存され、`gh attestation verify` で検証できる。zip を S3 に置いた後も digest は同じなので、CI で検証してから revision を作れる。
- npm の成果物: リポジトリのパッケージはすべて `private: true` で、`release.yml` には「Nothing is published to npm」とある。publish するようになったら、npm の trusted publishing が provenance を自動で作る（[npm: Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements)、[npm: Trusted publishers](https://docs.npmjs.com/trusted-publishers)）。
- 費用: artifact attestations は public のリポジトリならすべてのプランで使える。private と internal のリポジトリでは GitHub Enterprise Cloud が要り、GitHub Enterprise Server では使えない。storage record は組織が持つリポジトリでだけ作れる（[actions/attest の README](https://github.com/actions/attest)）。このリポジトリは個人のアカウント（`yokozi-jp`、種別は User）が持つ。

### docker buildx の attestation

- BuildKit はビルドのときに SBOM と provenance の attestation を作り、image index の中の manifest として最終のイメージに付ける。provenance は `mode=min` が既定で付く（[Docker: Build attestations](https://docs.docker.com/build/metadata/attestations/)）。
- provenance の既定の形式は SLSA provenance v0.2 で、`version=v1` で SLSA provenance v1 にできる（[Docker: Provenance attestation](https://docs.docker.com/build/metadata/attestations/slsa-provenance/)）。SBOM は SPDX の JSON（[Docker: SBOM attestations](https://docs.docker.com/build/metadata/attestations/sbom/)）。
- GitHub Actions では、public のリポジトリなら `mode=max`、private なら `mode=min` が既定で付く。`mode=max` はビルドの引数の値を含むので、秘密をビルドの引数で渡すと漏れる（[Docker: Attestations with GitHub Actions](https://docs.docker.com/build/ci/github-actions/attestations/)）。
- Docker の docs には buildx の attestation の署名の方法が書かれていない（未確認: BuildKit の attestation に署名があるか）。判断: 署名して検証する provenance が要るなら `actions/attest` を使い、buildx の attestation は中身を見るための補助にする。両方を付けると provenance が 2 つになり、どちらを検証するかが曖昧になる。

### 形式と道具

- SBOM の形式は SPDX と CycloneDX の 2 つ。`actions/attest` の `sbom-path` はどちらの JSON も受け、16 MB まで（[actions/attest の README](https://github.com/actions/attest)）。
- Syft 1.55.0 の出力は `cyclonedx-json`、`cyclonedx-xml`、`spdx-json`、`spdx-tag-value`、`syft-json` など（`syft --help`）。Trivy も `--format cyclonedx` と `spdx-json` を出す。
- 実験: `syft node:24-slim -o cyclonedx-json -o spdx-json` で、CycloneDX 1.7（1.26 MB、components 3371）と SPDX 2.3（2.79 MB、packages 236）ができた。どちらも 16 MB の上限より小さい。
- 実験（zip）: `node_modules/lodash/package.json`（4.17.20）だけを入れた zip とディレクトリで試した。
  - `syft file:fn.zip` と `syft dir:` は「No packages discovered」。Syft の `javascript-package-cataloger`（入った `node_modules` を読む）は image の場合だけの既定で、dir と file はロックファイルを読む `javascript-lock-cataloger` だけを使う（`syft cataloger list`）。`--select-catalogers +javascript-package-cataloger` を付けると lodash 4.17.20 が出て、Grype が CVE-2021-23337（HIGH）などを出した。
  - `trivy fs` は何も出さず、`trivy rootfs` は lodash で 5 件（HIGH 2、MEDIUM 3）を出した。
- 判断: zip の SBOM とスキャンは、ロックファイルからではなく zip の中身から作る。zip に入れる `node_modules` が `pnpm-lock.yaml` の一部（本番の依存だけ）になるため。そのとき、上の設定を付けないと「何もない」SBOM ができ、検査を通ったように見える。zip を bundle して `node_modules` を入れない形にするなら、bundle に入った依存は SBOM に出ないので、ロックファイルからの SBOM（`pnpm` の本番の依存）を使うことになる（未確認: Vite の bundle から依存を取り出す道具）。

## mise で固定できるか、GitHub Actions での動かし方

- hadolint、Trivy、Grype、Syft、cosign、Notation、slsa-verifier（2.7.1）、gh（2.103.0）は、mise の registry で aqua の backend が先頭にある（`mise registry`、2026-10-24）。Docker Scout と AWS Signer の Notation plugin はない。
- 実験: `mise install` を詳細のログで実行すると、Trivy と Syft は checksums のファイルの Sigstore の bundle を取り、`verify checksums with cosign` の段を通った。Grype、cosign、hadolint は checksum の段が出た。aqua の定義では、Grype と cosign にも cosign の、hadolint には GitHub の artifact attestations の検証が書かれている（[aqua-registry](https://github.com/aquaproj/aqua-registry/tree/main/pkgs)）。
- GitHub Actions では、CI の今の形（`jdx/mise-action` を lock から入れ、`MISE_LOCKED=1`）のまま、`mise exec -- hadolint` などで呼べる。道具ごとの action（trivy-action、scan-action、sbom-action、hadolint-action、cosign-installer）は、中で binary を取りに行くか Docker のイメージを使うので、版の固定が action の側に分かれる（判断）。
- action を使うときの commit の SHA（2026-10-24、`git ls-remote` で取得）:

  | action                                  | 版      | commit                                     |
  | --------------------------------------- | ------- | ------------------------------------------ |
  | `actions/attest`                        | v4.2.2  | `1e69f48acb82d1966a394da916b4c1698aa569d6` |
  | `actions/attest-build-provenance`       | v4.2.2  | `4d101475d8b20a2381f78447822ac1eab6504dd8` |
  | `docker/build-push-action`              | v7.4.0  | `c3c9e263c25d99ce0380d002d59b67737d91b0dc` |
  | `docker/setup-buildx-action`            | v4.4.1  | `f87e5991a6d7451dcb8d9637bfbc97413f497069` |
  | `aws-actions/configure-aws-credentials` | v6.3.0  | `e1253824e5c10ff9df46874f81ed3ec929e19cfd` |
  | `aws-actions/amazon-ecr-login`          | v2.1.7  | `03f1aad4c6c7ffd436567f42f9384779290529bd` |
  | `sigstore/cosign-installer`             | v4.1.2  | `6f9f17788090df1f26f669e9d70d6ae9567deba6` |
  | `aquasecurity/trivy-action`             | v0.36.0 | `ed142fd0673e97e23eac54620cfb913e5ce36c25` |
  | `anchore/scan-action`                   | v7.4.2  | `27805bf3b4e84b4a5c980df22ed233c00390a439` |
  | `anchore/sbom-action`                   | v0.24.3 | `66cbf4bc1f1c0d2edc94016e65bc221b6bb0ad6c` |
  | `hadolint/hadolint-action`              | v3.5.0  | `06be81baf89a55ffd0e24b8f04a4185738dd3387` |
  | `docker/scout-action`                   | v1.27.0 | `a4119c5a8c5076236a54e4ce99531f7e4dd2ef84` |

- `actions/attest` には `id-token: write`、`attestations: write`、`artifact-metadata: write` の権限が要る（[actions/attest の README](https://github.com/actions/attest)）。判断: この権限は attestation を作る job にだけ付け、PR の CI には付けない。ADR 0012 の zizmor は、広すぎる権限を指摘する。

## 推奨の候補（判断）

決めるのは後の grilling のチケット。ここでは、標準かどうかと出典と、避けるアンチパターンを並べる。

- **Dockerfile は hadolint を mise で固定して CI と pre-commit で回し、build checks はビルドのついでに使う。** hadolint は Dockerfile の lint の定番で、mise の aqua に入っている。避けるアンチパターンは、`latest` のベースイメージ、root での実行、apt の版の未固定などを、レビューの目だけで見つけようとすること。
- **イメージと zip は CI で Trivy（か Grype）でスキャンし、「直せる HIGH と CRITICAL」で止める。** SCA に Trivy を選ぶなら 1 つの道具で済む。避けるアンチパターンは、直せない脆弱性まで止める条件に入れて、無視の設定が増えること。Trivy の 2026-03 の侵害の advisory が勧めるとおり、action はタグでなく commit の SHA で、binary は lock の checksum で固定する。
- **provenance と SBOM は `actions/attest` で付け、デプロイの前に `gh attestation verify` で検証し、digest でデプロイする。** GitHub の docs が SLSA Build L2 と書く標準のやり方で、Sigstore の署名が付く。避けるアンチパターンは、attestation を作るだけで検証しないこと（GitHub の docs）と、可変のタグでデプロイすること。テンプレートを private のリポジトリで使う案件では GHEC が要るので、その場合は AWS Signer（ECR managed signing と Lambda のコード署名）に寄せる。
- **Event Functions の zip には Lambda のコード署名を `Enforce` で付ける案。** AWS の側で強制できる唯一の方法。Web Functions には使えないので、S3 の書き込みの権限を絞る。
- **ECR managed signing と ECS の lifecycle hook は、強制まで要る案件の選択肢にする。** lifecycle hook は blue/green などのデプロイが前提で、ADR 0013 の ecs-patterns のサービスの既定のデプロイ（rolling update）から変えることになる（未確認: CDK の ecs-patterns で lifecycle hook を書けるか）。

## 未確認のこと

- 次は実行していない（未実行）: cosign の keyless の署名と検証、`actions/attest` と `gh attestation verify`、ECR managed signing、ECR のスキャン、Inspector、Docker Scout、Lambda のコード署名、ECS の lifecycle hook。AWS のリソースと credential を使わない条件のため。
- `actions/attest` の `push-to-registry` が ECR の referrer に正しく置けるか。ECR が OCI 1.1 の referrer を、すべてのクライアントの形で受けるか（`oras copy -r` で 405 を返すという報告がある、[aws/containers-roadmap#2783](https://github.com/aws/containers-roadmap/issues/2783)）。
- ECS の rolling update のデプロイで lifecycle hook が使えないこと（docs に書かれていないことからの推定）。CDK の ecs-patterns での lifecycle hook の書き方。
- Signer の「Verify container image signatures for Amazon ECS」のページの移動先。
- Inspector の Lambda のスキャンが Web Functions を対象にするか。東京の Inspector の ECR のスキャンの単価。
- BuildKit の attestation に署名があるか。
- Lambda の zip を bundle するか、`node_modules` を入れるか（[Lambda Web Functions と Event Functions で、Hono の streaming、VPC の DB、SQS の部分的な失敗の応答が動くかを確かめる](https://github.com/yokozi-jp/agent-software-factory/issues/86) の範囲）。bundle するなら、SBOM の作り方が変わる。
- Grype の DB の取得にかかる時間が GitHub Actions の runner でどれくらいか（この環境では 4 分 37 秒）。

## 出典

取得日はすべて 2026-10-24。

- hadolint: [リポジトリ](https://github.com/hadolint/hadolint)、[releases](https://github.com/hadolint/hadolint/releases)、[hadolint-action](https://github.com/hadolint/hadolint-action)
- Docker: [Build checks](https://docs.docker.com/build/checks/)、[Build attestations](https://docs.docker.com/build/metadata/attestations/)、[Provenance attestation](https://docs.docker.com/build/metadata/attestations/slsa-provenance/)、[SBOM attestations](https://docs.docker.com/build/metadata/attestations/sbom/)、[Attestations with GitHub Actions](https://docs.docker.com/build/ci/github-actions/attestations/)、[build-push-action](https://github.com/docker/build-push-action)、[Docker Scout](https://docs.docker.com/scout/)、[scout-cli](https://github.com/docker/scout-cli)
- Trivy: [リポジトリ](https://github.com/aquasecurity/trivy)、[trivy-action](https://github.com/aquasecurity/trivy-action)、[GHSA-69fq-xp46-6x23](https://github.com/advisories/GHSA-69fq-xp46-6x23)
- Anchore: [Grype](https://github.com/anchore/grype)、[Syft](https://github.com/anchore/syft)、[scan-action](https://github.com/anchore/scan-action)、[sbom-action](https://github.com/anchore/sbom-action)
- Sigstore: [Signing overview](https://docs.sigstore.dev/cosign/signing/overview/)、[Verifying](https://docs.sigstore.dev/cosign/verifying/verify/)、[cosign の CHANGELOG](https://github.com/sigstore/cosign/blob/main/CHANGELOG.md)、[cosign-installer](https://github.com/sigstore/cosign-installer)
- GitHub: [Artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)、[actions/attest](https://github.com/actions/attest)、[actions/attest-build-provenance](https://github.com/actions/attest-build-provenance)、[gh attestation verify](https://cli.github.com/manual/gh_attestation_verify)
- SLSA: [Specification v1.2](https://slsa.dev/spec/v1.2/)、[Build Track Basics](https://slsa.dev/spec/v1.2/build-track-basics)
- npm: [Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements)、[Trusted publishers](https://docs.npmjs.com/trusted-publishers)
- Amazon ECR: [Scan images](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html)、[Enhanced scanning](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning-enhanced.html)、[Sign images](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-signing.html)、[Managed signing](https://docs.aws.amazon.com/AmazonECR/latest/userguide/managed-signing.html)、[Signature verification](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-signing-verification.html)、[Image tag mutability](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html)、[OCI 1.1 の対応（What's New）](https://aws.amazon.com/about-aws/whats-new/2024/06/amazon-ecr-oci-image-distribution-version-1-1/)
- Amazon ECS: [Lifecycle hooks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-lifecycle-hooks.html)、[Lambda hooks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/lambda-lifecycle-hooks.html)、[Blue/green](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html)、[Linear](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-linear.html)、[Rolling update](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html)
- AWS Lambda: [Code signing](https://docs.aws.amazon.com/lambda/latest/dg/configuration-codesigning.html)、[Creating code signing configurations](https://docs.aws.amazon.com/lambda/latest/dg/configuration-codesigning-create.html)、[IAM policies for code signing](https://docs.aws.amazon.com/lambda/latest/dg/config-codesigning-policies.html)、[Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)、[Web Functions: code from S3](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-code-s3.html)、[Web Functions: permissions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-permissions.html)
- AWS Signer: [Pricing](https://docs.aws.amazon.com/signer/latest/developerguide/whatis-pricing.html)、[Container images の手順](https://docs.aws.amazon.com/signer/latest/developerguide/container-workflow.html)
- Amazon Inspector: [Pricing](https://aws.amazon.com/inspector/pricing/)、[Lambda scanning](https://docs.aws.amazon.com/inspector/latest/user/scanning-lambda.html)、[Supported](https://docs.aws.amazon.com/inspector/latest/user/supported.html)、[CI/CD integration](https://docs.aws.amazon.com/inspector/latest/user/scanning-cicd.html)
- mise と aqua: `mise registry` と `mise latest`（mise 2026.10.17）、[aqua-registry](https://github.com/aquaproj/aqua-registry)
- 版と commit の SHA は `git ls-remote --tags` と GitHub の releases の API で、ライセンスは GitHub の repository の API で確かめた。
