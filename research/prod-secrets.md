# 本番と検証環境の秘密の渡し方（Secrets Manager、Parameter Store）の未確認の点を調べる

## 問い

[Issue #257](https://github.com/yokozi-jp/agent-software-factory/issues/257) の調査。[Issue #216](https://github.com/yokozi-jp/agent-software-factory/issues/216) の決定の前提（秘密は Secrets Manager に置く。ECS は task definition の `secrets` で注入し、Lambda Web Functions は実行時に取る。秘密でない設定は環境変数）に要る、未確認の事実を調べる。

1. Lambda Web Functions で Parameters and Secrets Lambda Extension が使えるか。使えなければ、実行時に取る標準の書き方。
2. Secrets Manager と Parameter Store（SecureString）の単価。検証環境の作って消す流れと、本番の見込みでの月額。
3. 取得の層をコードのどこに置くか。入口で取って `createApp` に引数で渡す形に合うか。
4. VPC の中の Lambda と ECS から Secrets Manager と SSM に届くのに要る VPC endpoint（ADR 0013）。

調べた日は 2026-10-28。作業は Linux、Node.js 24.22.1。AWS アカウントはまだないので、AWS の上では何も実行していない。実際に動かして確かめた事実は「実行して確認」と書き、文書の記述は出典を添える。出典のない文は判断（推論）。

## 要約

- **Extension は使えない（推論）。** Extension の文書は Event Functions 向けの題で、Web Functions の revision の設定（CloudFormation の `ServiceConfig`、`BuildConfig`）に layer を指定する項目が無い。Web Functions の文書は、秘密を環境変数に入れず、Secrets Manager か Parameter Store から実行時に取るよう書く。標準の形は、AWS SDK（または Powertools の `getSecret`）で取り、process の中に TTL 付きで持つ形。
- **単価（東京、Price List API を実行して確認）。** Secrets Manager は 1 secret あたり月 $0.40、API 呼び出し 1 万回あたり $0.05。Parameter Store は standard parameter が無料（SecureString も standard なら無料。AWS 公式の料金ページ）。advanced は 1 parameter あたり月 $0.05。Secrets Manager は時間割りで課金され、削除の予約中は課金されない。
- **月額の見込み（判断、計算は下）。** 秘密 4 つの本番 1 環境で、Secrets Manager は月 $1.60 と取得の費用。検証環境の 1 回（1 時間）は $0.01 未満。どちらも VPC endpoint や NAT に比べれば小さい。Parameter Store に替えて浮くのは月 $1.60 程度。
- **コードの置き場所。** 取得は入口（`server.ts`）で行い、`createApp` には取得済みの値を引数で渡す形が、ADR 0007 に合う。`server.ts` は ADR 0007 の `process` 禁止の対象外。確かめた制約が 2 つある: Web Functions は init の 10 秒以内に listen する必要がある。process が長く生きるので、ローテーションに TTL 付きの再取得が要る。
- **VPC endpoint は、今の ADR 0013 の構成では要らない見込み。** ECS の構成は NAT Gateway がある。Lambda の構成は IPv6 で出る。Secrets Manager の公開 endpoint は `secretsmanager.ap-northeast-1.amazonaws.com` に AAAA があり（実行して確認）、SSM は SDK を dual-stack にすると `ssm.ap-northeast-1.api.aws` を引き、これにも AAAA がある（実行して確認）。**未確認は 1 点: Lambda の構成の IPv6 だけの subnet にある Fargate の task が、起動時の `secrets` の注入で Secrets Manager と SSM に IPv6 で届くか。** 文書にこの記述が無い。

## 1. Lambda Web Functions で Extension が使えるか

### 確かめた事実

- Extension の文書の題は「Use Secrets Manager secrets in Lambda Event Functions」で、手順は Event Functions のコンソールと layer の追加（`AWS-Parameters-and-Secrets-Lambda-Extension`）だけを書く。cache は既定で 300 秒、最大 1,000 個。HTTP の port は 2773（[Use Secrets Manager secrets in Lambda Event Functions](https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html)）。
- Web Functions の revision の設定は、`serviceConfig`（`EgressNetworkConnectorArn`、`EnvironmentVariables`、`ExecutionRoleArn`、`MaxConcurrencyPerEnvironment`、`TelemetryConfig`、`TimeoutSeconds`）と `buildConfig`（`CodeConfig`、`RuntimeConfig`）で、layer を指定する項目が無い（[ServiceConfig](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-webfunctionrevision-serviceconfig.html)、[BuildConfig](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-webfunctionrevision-buildconfig.html)）。設定の一覧にも layer と extension は出てこない（[Configuring Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-configuration.html)）。
- Web Functions の code は zip で、entry file と依存（`node_modules`）をすべて含める（[Web Function deployment package](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-configuration-deployment-package.html)）。AWS SDK がランタイムに入っているかは文書に無い。
- Web Functions の環境変数の文書は「API key や DB の認証情報は環境変数に入れず、Secrets Manager か Parameter Store から実行時に取る」と書く。環境変数は revision の作成時に決まり、変えるには新しい revision が要る（[Environment variables](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-env-vars.html)）。
- best practices は「秘密を deployment package やログに入れない。実行時に秘密の保管先から読み、必要な間だけ cache する」と書く（[Best practices for Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-best-practices.html)）。

### 結論（判断）

- Extension は、設定に layer を指定する方法が文書に無いので、Web Functions では使えないと扱う。AWS が「使えない」と明記した文は見つけていない。
- 標準の書き方は SDK で取る形。Powertools の `getSecret`（`@aws-lambda-powertools/parameters/secrets`）は、`maxAge` の cache を process の中に持つ。Web Functions の文書は Powertools を metadata endpoint で使っている（[Using the metadata endpoint](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-configuration-metadata-endpoint.html)）ので、依存として zip に入れる形は文書の例に沿う。`@aws-sdk/client-secrets-manager` 3.1157.0 は `/tmp` に入れて `GetSecretValueCommand` の組み立てまで動いた。
- Event Functions のワーカーは Extension を使えるが、IPv6 の外向きの通信で Extension がどう動くかは文書に無い。ワーカーも SDK で取る方が、Web Functions と同じ書き方になる（判断）。

## 2. 単価と月額

### 単価（実行して確認）

AWS Price List API の bulk file（`pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<service>/current/ap-northeast-1/index.json`）から、東京の OnDemand の価格を読んだ。

| 項目                                          | 単価                                                  | 出典                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Secrets Manager の secret                     | $0.40 / secret / 月                                   | Price List（AWSSecretsManager、公開日 2026-09-11）                                                              |
| Secrets Manager の API 呼び出し               | $0.05 / 1 万回                                        | 同上                                                                                                            |
| Parameter Store の standard parameter         | 無料                                                  | [Systems Manager の料金](https://aws.amazon.com/systems-manager/pricing/)                                       |
| Parameter Store の advanced parameter         | $0.05 / parameter / 月（時間割り）                    | Price List（AWSSystemsManager、公開日 2026-10-08）、[同ページ](https://aws.amazon.com/systems-manager/pricing/) |
| Parameter Store の API（standard throughput） | standard parameter は無料、advanced は $0.05 / 1 万回 | [同ページ](https://aws.amazon.com/systems-manager/pricing/)                                                     |
| Parameter Store の API（higher throughput）   | $0.05 / 1 万回（standard、advanced とも）             | [同ページ](https://aws.amazon.com/systems-manager/pricing/)                                                     |

- Secrets Manager は、1 か月に満たない secret を時間割りで課金する（[料金のページ](https://aws.amazon.com/secrets-manager/pricing/)）。削除を予約した secret は課金されない。削除の recovery window は最短 7 日（[Delete a secret](https://docs.aws.amazon.com/secretsmanager/latest/userguide/manage_delete-secret.html)）。
- Parameter Store の既定の throughput は GetParameter 系で 40 TPS（[Parameter Store throughput](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-throughput.html)）。
- standard parameter の値は 4 KB まで、advanced は 8 KB まで（[Parameter tiers](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-advanced-parameters.html)）。
- SecureString を customer managed key で暗号化したときの KMS の費用は調べていない。上の表の Parameter Store の $0 は、AWS 管理の key を使う前提（判断）。

### 月額の見込み（判断、計算）

前提: 秘密は 4 つ（`AUTH_SECRET`、`OIDC_CLIENT_SECRET`、DB の接続情報、もう 1 つ）。実際の数は #216 の ADR で決まる。

| 場面                                                     | Secrets Manager                                           | Parameter Store（standard SecureString） |
| -------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| 本番 1 環境の保管                                        | 4 × $0.40 = **$1.60 / 月**                                | $0                                       |
| ECS の task が起動時に 4 つを注入（月 100 回起動）       | 400 回 ≈ $0.002                                           | $0（standard throughput）                |
| Lambda の実行環境が 5 分 TTL で再取得（常に動く 1 環境） | 4 × 12 回/時 × 730 時 ≈ 35,000 回 ≈ **$0.18 / 月 / 環境** | $0                                       |
| 検証環境の 1 回（1 時間、4 secret）                      | 4 × $0.40 × 1/730 ≈ **$0.002**。削除後の予約中は課金なし  | $0                                       |

- 差は月に $2 程度。判断: 費用で Parameter Store に替える理由は無い。差が出るのは、Secrets Manager にしかない機能（自動ローテーション、ランダムな値の生成。ECS の文書も Secrets Manager の利点としてこの 2 つを挙げる。[Pass sensitive data to an Amazon ECS container](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html)）と、後に述べる IPv6 の到達性。
- 比較のため: ADR 0013 は、インターフェイスエンドポイント 3 つ（2 AZ）を月に約 $61 とする。Secrets Manager と SSM に 1 つずつ足すと月に約 $41。保管の費用 $1.60 より 1 桁以上大きいので、費用の判断は VPC endpoint を足すかどうかで決まる。

### 作って消す流れでの注意

- CDK の `secretsmanager.Secret` は、`removalPolicy` を指定しなければ `DESTROY` を適用する（[secret.ts](https://github.com/aws/aws-cdk/blob/main/packages/aws-cdk-lib/aws-secretsmanager/lib/secret.ts) の `applyRemovalPolicy`）。消した secret は 7 から 30 日の間、同じ名前で作り直せない（同ファイルの `secretName` の説明）。判断: 作って消す stack では `secretName` を固定せず、CloudFormation に名前を生成させる。固定の名前が要る secret は、消さない stack に置く。
- `generateSecretString` で `AUTH_SECRET` のようなランダムな値を stack が作れる（同ファイル）。検証環境で毎回新しい値になり、固定の値を持ち回る必要が無い（判断）。
- ECS では `ecs.Secret.fromSecretsManager(secret, field?)` と `ecs.Secret.fromSsmParameter(parameter)` があり、どちらも task の execution role に読み取りを付ける（[container-definition.ts](https://github.com/aws/aws-cdk/blob/main/packages/aws-cdk-lib/aws-ecs/lib/container-definition.ts)）。

## 3. 取得の層をコードのどこに置くか

### 今のコード（リポジトリを読んだ結果）

- `apps/api/src/server.ts` が `process.env` を直接読み、`requireEnv` で 6 つの変数を検査し、`createAuth` を作って `createApp({ auth })` に渡す。取得は同期で、起動時に 1 回。
- `createApp` は `{ auth }` を引数で受ける。`app.ts` には環境変数を読む処理が無い。
- ADR 0007 は、`apps/api/src` で `process` などのグローバルを使わず、環境変数は `c.env` で受けるとする。入口のファイル（`server.ts`）とテストはこの制限の対象外（`vite.config.ts` の `lint.overrides`）。`apps/api/package.json` は `"type": "module"` で、`start` は `node dist/server.js`。

### 合うか（判断）

- 合う。ランタイム固有の取得は、ECS と Web Functions で共通の `server.ts` に置ける。`createApp` には取得済みの値（`auth` の設定）だけを渡すので、`app.ts` とそのテストは変わらない。
- 取得の関数は `server.ts` から切り出し、`getSecret(name): Promise<string>` のような小さな関数にしておくと、ECS では環境変数を読み、Lambda では SDK で取る、と中身を分けられる（判断）。ADR 0007 の「実行する場所の違いは入口のファイルで吸収する」に沿う。
- ECS は task definition の `secrets` で注入される値を `process.env` から読むので、今の `requireEnv` がそのまま使える。Lambda だけ、起動時に SDK で取って `process.env` 相当の値にする。

### 確かめた制約

- Web Functions の server は init の 10 秒以内に listen する必要がある。init で重い処理をする代わりに、listen の後で行い、handler が共有の promise を待つ形を勧める（[Execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html)）。
- 判断: このリポジトリは認証を必須にして、秘密が無いときに起動しない（fail closed、`server.ts` のコメント）。秘密の取得を listen の前に置くと、取得に失敗した環境は listen せず `Application.TimeoutListenError` か `Application.InitCodeError` になる（[Troubleshooting](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-troubleshooting.html)）。取得は数回の API 呼び出しなので 10 秒に収まる見込みだが、cold start の時間には足される。実測はしていない。
- 判断: Web Functions の process は長く生きる。Secrets Manager の値をローテーションするなら、起動時に 1 回取るだけでは古い値が残る。DB の接続情報は、pool が古い認証情報で接続し続ける問題も出る。ローテーションをしないなら（秘密を手で変えて新しい revision を出す）、起動時に 1 回取る形で足りる。
- ECS も同じ: 注入は task の起動時の 1 回で、秘密を更新しても自動では届かず、新しい task（force new deployment）が要る（[Secrets Manager の注入](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)）。
- 確かめていない: Web Functions の entry file（`index.js`）を ESM にできるか（top-level `await` を使えるか）。`dist/server.js` は ESM で、Web Functions の entry は `index.js` を zip の root に置く（[Environment variables](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-env-vars.html)）。

## 4. VPC endpoint

### ADR 0013 の構成

- ECS の構成: ECS のタスクと DB を private subnet に置き、外への通信は NAT Gateway を通す。
- Lambda の構成: dual-stack の VPC と egress-only internet gateway で IPv6 の endpoint に出る。ECS のタスク（migrate、締めのバッチ、WireMock）は IPv6 だけの private subnet に置く。NAT Gateway とインターフェイスエンドポイントは置かない。

### ECS の構成（NAT Gateway あり）

- 起動時の注入も、アプリが SDK で取る場合も、NAT Gateway を通って公開の endpoint に届く。VPC endpoint は要らない（判断）。
- ECS の文書は「VPC の interface endpoint を使うと private subnet からの接続の制御が強まる」と書く（推奨であり、NAT があれば必須ではない。[Secrets Manager の注入](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)、[Parameter Store の注入](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-ssm-paramstore.html)）。
- dual-stack の subnet の Fargate task は、ECR、SSM、Secrets Manager に届くのに IPv4 の `0.0.0.0/0` の経路が要る（[Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html)）。ADR 0013 の ECS の構成は NAT があるので満たす。

### Lambda の構成（IPv6 の外向き）

公開の endpoint が IPv6 で引けるかを、東京の名前で DNS を引いて確かめた（実行して確認）。

| 名前                                          | A    | AAAA                                      |
| --------------------------------------------- | ---- | ----------------------------------------- |
| `secretsmanager.ap-northeast-1.amazonaws.com` | あり | **あり**（`2406:da14:...`）               |
| `secretsmanager.ap-northeast-1.api.aws`       | なし | なし                                      |
| `ssm.ap-northeast-1.amazonaws.com`            | あり | **なし**（IPv4-mapped の `::ffff:` だけ） |
| `ssm.ap-northeast-1.api.aws`                  | あり | **あり**（`2406:da70:...`）               |
| `kms.ap-northeast-1.amazonaws.com`            | あり | **なし**（IPv4-mapped だけ）              |
| `kms.ap-northeast-1.api.aws`                  | あり | **あり**                                  |

AWS SDK for JavaScript v3（3.1157.0）の `useDualstackEndpoint: true`（`AWS_USE_DUALSTACK_ENDPOINT=true` と同じ効果）で、リクエストの宛先を確かめた（実行して確認、通信は発生させていない）。

| client          | 既定                                          | dual-stack                                    |
| --------------- | --------------------------------------------- | --------------------------------------------- |
| Secrets Manager | `secretsmanager.ap-northeast-1.amazonaws.com` | `secretsmanager.ap-northeast-1.amazonaws.com` |
| SSM             | `ssm.ap-northeast-1.amazonaws.com`            | `ssm.ap-northeast-1.api.aws`                  |

- AWS の「IPv6 に対応するサービス」の表は、Secrets Manager を「公開の endpoint が IPv6 対応: Yes、dual-stack: Yes、IPv6 only: No」、SSM を「dual-stack: No、IPv6 only: No、公開の endpoint が IPv6 対応: Yes、private endpoint が IPv6 対応: Yes」とする。KMS は「dual-stack: Yes、IPv6 only: Partial」（[AWS services that support IPv6](https://docs.aws.amazon.com/vpc/latest/userguide/aws-ipv6-support.html)）。Secrets Manager の endpoint は dual-stack で、IPv4 と IPv6 の両方を受ける（[Secrets Manager endpoints](https://docs.aws.amazon.com/secretsmanager/latest/userguide/asm_access.html)）。SSM の IPv6 だけの環境向けの endpoint は `ssm.<region>.api.aws`（[Systems Manager の VPC の設定](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-create-vpc.html)）。
- 判断: Web Functions と Event Functions が SDK で取る場合は、`AWS_USE_DUALSTACK_ENDPOINT=true` で Secrets Manager にも SSM にも IPv6 で出られる見込み。VPC endpoint は要らない。ADR 0013 の「新しい AWS のサービスを呼ぶときは IPv6 の対応を確かめる」規則は満たす。
- 判断: **Secrets Manager の方が、Lambda の構成と相性がいい。** SDK が dual-stack の設定に関係なく IPv6 を持つ名前を引く。SSM は dual-stack の設定を入れ忘れると、AAAA が無い名前を引いて失敗する。

### 未確認: IPv6 だけの subnet の Fargate task が `secrets` を注入できるか

- ECS の文書は、IPv6 だけの subnet の task が ECR に dualstack の URI で届くことは書くが、起動時の `secrets` の取得（Secrets Manager、SSM）が IPv6 で届くかは書かない。dual-stack の subnet では IPv4 の経路が要ると書く（上）。ADR 0013 は IPv6 だけの subnet を選んだ前提で、この点を未確認のまま進めている（`docs/adr/0013` の Consequences は ECR と Aurora を列挙し、Secrets Manager と SSM は含まない）。
- 判断: 起動時の取得を行うのは ECS のエージェントで、SDK の設定を利用者が触れない。SSM の公開名 `ssm.<region>.amazonaws.com` に AAAA が無い（上）ので、エージェントが dual-stack の名前に切り替えなければ、IPv6 だけの subnet では Parameter Store の注入が失敗しうる。Secrets Manager は `.amazonaws.com` に AAAA があるので、同じ問題は起きにくい。どちらも AWS の上で動かしていない。
- 失敗した場合の退路: private endpoint は両方とも IPv6 対応（上の表）で、`com.amazonaws.<region>.secretsmanager` の interface endpoint を足せる（[Secrets Manager の VPC endpoint](https://docs.aws.amazon.com/secretsmanager/latest/userguide/vpc-endpoint-overview.html)）。ADR 0013 の試算では 1 つあたり月に約 $20。最初の検証環境で確かめる項目に足すのが妥当（判断）。

## 決めるべき論点（決定は下さない）

| 論点                       | 選択肢                                                                                   | 材料                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 保管先                     | Secrets Manager / Parameter Store（standard SecureString）                               | 費用の差は月に $2 程度。IPv6 の到達性と ECS の `secrets` の確実さは Secrets Manager が有利（判断）。ローテーションも Secrets Manager だけ |
| Lambda の取り方            | SDK を直接 / Powertools の `getSecret`                                                   | Extension は使えない見込み。Powertools は TTL の cache を持つ。依存が 1 つ増える                                                          |
| 取得の時点                 | listen の前に取る（fail closed）/ listen の後に取る                                      | 前者は 10 秒の制約の中に収まる見込みで、認証を必須にする方針に合う。後者は cold start が短い                                              |
| ローテーション             | 手動（新しい revision と force new deployment）/ TTL 付きの再取得                        | 長く生きる process、pool の認証情報の差し替えが要る。当面は手動で足りる（判断）                                                           |
| 作って消す stack の secret | `generateSecretString` で毎回生成、`secretName` は固定しない / 消さない stack に固定の値 | 消した名前は 7〜30 日使えない                                                                                                             |
| VPC endpoint               | 足さない（既定）/ Secrets Manager だけ足す（IPv6 だけの subnet で注入が失敗したとき）    | ADR 0013 に「IPv6 だけの subnet の task が Secrets Manager と SSM に届くか」を最初の検証環境の確認項目として足す                          |

## ADR 0013 に触れる点

- Consequences の「最初の検証環境で確かめる」の一覧に、IPv6 だけの subnet の Fargate task が `secrets` の注入で Secrets Manager（と使うなら SSM）に届くことを足す。
- ルールの「新しい AWS のサービス」の確認として、Secrets Manager と SSM は、上の表のとおり IPv6 に対応している。SSM は SDK の dual-stack の設定が必須（`ssm.<region>.api.aws`）。
- 退路の interface endpoint は、ADR 0013 が既に退けた形（月に約 $20 / 個）。足すときは ADR に書く。

## 確かめられなかったこと

- Web Functions で Extension が動かないこと（layer を指定する項目が無い、までは確認。AWS の明記は見つけていない）。
- Web Functions のランタイムに AWS SDK が入っているか。zip に入れる前提で書いた。
- Web Functions の entry file が ESM（top-level `await`）で動くか。
- Web Functions と Event Functions の IPv6 の外向きの通信が、Secrets Manager と SSM に実際に届くこと（DNS の AAAA と SDK の宛先までは確認。通信は未実行）。
- IPv6 だけの subnet の Fargate task の `secrets` の注入（上）。
- SecureString を customer managed key で暗号化したときの KMS の費用。
- Secrets Manager の secret を CloudFormation で消したときの recovery window の長さ（CDK の説明は「7 から 30 日」）。
- Secrets Manager の secret を時間割りで課金する単位の細部（料金のページは「時間に基づいて日割り」と書く）。

## 出典

- [Use Secrets Manager secrets in Lambda Event Functions](https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html)
- [Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)、[Environment variables](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-env-vars.html)、[Execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html)、[Best practices](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-best-practices.html)、[Configuring](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-configuration.html)、[Deployment package](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-configuration-deployment-package.html)、[Networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)、[Troubleshooting](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-troubleshooting.html)
- [CloudFormation: WebFunctionRevision ServiceConfig](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-webfunctionrevision-serviceconfig.html)、[BuildConfig](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-webfunctionrevision-buildconfig.html)
- [Secrets Manager の料金](https://aws.amazon.com/secrets-manager/pricing/)、[Systems Manager の料金](https://aws.amazon.com/systems-manager/pricing/)、AWS Price List bulk API（AWSSecretsManager、AWSSystemsManager の ap-northeast-1）
- [Delete a secret](https://docs.aws.amazon.com/secretsmanager/latest/userguide/manage_delete-secret.html)、[Secrets Manager endpoints](https://docs.aws.amazon.com/secretsmanager/latest/userguide/asm_access.html)、[Secrets Manager の VPC endpoint](https://docs.aws.amazon.com/secretsmanager/latest/userguide/vpc-endpoint-overview.html)
- [Parameter tiers](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-advanced-parameters.html)、[Parameter Store throughput](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-throughput.html)、[Systems Manager の VPC の設定](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-create-vpc.html)
- [Pass sensitive data to an Amazon ECS container](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html)、[Secrets Manager の注入](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)、[Parameter Store の注入](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-ssm-paramstore.html)、[Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html)
- [AWS services that support IPv6](https://docs.aws.amazon.com/vpc/latest/userguide/aws-ipv6-support.html)
- [aws-cdk: secret.ts](https://github.com/aws/aws-cdk/blob/main/packages/aws-cdk-lib/aws-secretsmanager/lib/secret.ts)、[container-definition.ts](https://github.com/aws/aws-cdk/blob/main/packages/aws-cdk-lib/aws-ecs/lib/container-definition.ts)
- リポジトリ: `docs/adr/0007-api-on-node-web-standard-app.md`、`docs/adr/0013-api-on-ecs-and-lambda-web-functions.md`、`apps/api/src/server.ts`、`apps/api/src/app.ts`、[env-management の調査](https://github.com/yokozi-jp/agent-software-factory/blob/research/env-management/research/env-management.md)
