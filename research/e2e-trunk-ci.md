# トランクベース開発での、PR ごとの CI の E2E（Docker でアプリを立てる形）の標準とアンチパターン

## 問い

[Issue #305](https://github.com/yokozi-jp/agent-software-factory/issues/305) の調査。[E2E テストの道具を決める (#223)](https://github.com/yokozi-jp/agent-software-factory/issues/223) の利用者から、「たまにやる AWS の検証環境のテスト」と「日々 CI で回す E2E」を別に考えたい、トランクベース開発なので E2E を回す頻度は多いほうがよい、検証環境を使わず CI で Docker でアプリを立てる形でもよい、という方針が出た。その形の標準とアンチパターンを調べる。決定は下さない。

調べた日は 2026-10-28。読んだ出典は次の 5 つ。Playwright の [Best Practices](https://playwright.dev/docs/best-practices)、[Continuous Integration](https://playwright.dev/docs/ci)、[webServer](https://playwright.dev/docs/test-webserver)、[Retries](https://playwright.dev/docs/test-retries)、[trunkbaseddevelopment.com の Continuous Integration](https://trunkbaseddevelopment.com/continuous-integration/)、Fowler「[Eradicating Non-Determinism in Tests](https://martinfowler.com/articles/nonDeterminism.html)」。Playwright の文書の版は v1.64.1。実際に流して試してはいない。

## 要約

- 確かめた: Playwright の公式は「CI をセットアップして、テストを頻繁に回す。理想は各 commit と PR ごと」（Best Practices の「Run tests on CI」）。「PR では回さず検証環境でだけ」という形は公式の推奨ではない。利用者の方針（日々の CI の E2E と、たまの検証環境を分ける）は標準に沿う。
- 確かめた: トランクベース開発の側の原則は、「マージの前に、機械の合意（CI）と人の合意（レビュー）を取る」「CI は commit から失敗の通知までの時間が短いこと」「テストは誤って通ることはなく、誤って落ちるのが常で、flaky なテストが多いと CI の価値が下がる」（trunkbaseddevelopment.com）。
- 確かめた: Playwright が公式に示す構成は 2 通り。(a) `webServer` でアプリを CI のジョブの中で起動して流す、(b) 公式の Docker イメージ（`mcr.microsoft.com/playwright:v1.64.1-noble`）をジョブの `container` に使う。アプリを docker compose で立てる形は、Playwright の文書には出てこない。その形の標準は Playwright の側にはなく、GitHub Actions 側の機能（service containers など）になる（本調査では読んでいない）。
- 確かめた: 速くする手段は公式にある。Linux で流す、必要なブラウザだけ入れる、shard、`--only-changed` で変更に関係するテストを先に流す（その後に必ず全部を流す）。
- 確かめた: flaky への公式の態度は「retry は使えるが、`flaky` として分類して見える状態にする」「テストは互いに独立にする」。Fowler は「非決定的なテストは隔離（quarantine）し、期限か数の上限を設けて直す」。
- 判断: このリポジトリでは、PR の必須チェックにする E2E は、CI のジョブの中でアプリと DB を起動して Playwright を流す形が標準に近い。AWS の検証環境は #88 のまま（手動と週次）で、役割が重ならない。ただし、PR ごとに回す範囲は絞る（後述）。

## 1. トランクベース開発での E2E の置き方

出典: trunkbaseddevelopment.com の「Continuous Integration」。

- マージ前に、人のレビューと機械の CI の両方を通すのが望ましい。マージ後にも CI が走るが、2 回目が失敗する確率は小さいので、自動 revert と通知で処理する。
- 速い build が前提。「build の失敗が分かるまでの時間」が鍵で、遅いと、その間に積まれた commit のせいで直すコストが上がる。
- 機能テストは、Docker で本番の小さな写しを作った、並列で使い捨ての CI の環境で、安く速く何度も回すもの。性能などの非機能のテストは、後の段階に移すのが良いと書かれている。
- 注意（出典の記述）: レビューが数日かかると、CI が数分で終わっても意味がなくなる。短命のブランチが長命になる危険もある。

DORA の資料は読んでいない。

### PR で回すか、merge 後に回すか

公式の文書に「E2E は PR で回せ」と明記した文は見つからなかった。Playwright の Best Practices は「各 commit と PR で回す」としているのみ。つまり PR で回す、merge 後にも回す（trunkbaseddevelopment.com の 2 回目の CI）、は両方標準。

**遅さの対処**（Playwright の CI の文書）:

- `workers`: CI は 1 を推奨（安定と再現性のため）。強力な self-hosted なら並列を有効にできる。
- shard: `--shard=1/3` のように複数のジョブに分ける。GitHub Actions の例とレポートの統合の手順が公式にある。
- `--only-changed=origin/$GITHUB_BASE_REF`: 依存グラフで、変更に関係するテストファイルを先に流す。**ヒューリスティックで見逃すことがあるので、その後に必ず全部を流す**と書かれている。
- 必要なブラウザだけ入れる（`npx playwright install chromium --with-deps`）。ブラウザの cache は、復元の時間がダウンロードと同程度なので、推奨されていない。
- `globalTimeout` を必ず設定する。ないと、ジョブの上限で runner に殺され、レポートが出ない。ジョブの `timeout-minutes` は、それより十分長くする。

実行時間の目安: 公式に数値はない。このリポジトリの値は未測定。

## 2. GitHub Actions で、アプリを立てて Playwright を流す標準

出典: Playwright の CI と webServer の文書。

### 構成 (a): `webServer`

```ts
webServer: {
  command: 'npm run start',
  url: 'http://localhost:3000',
  reuseExistingServer: !process.env.CI,
  timeout: 120 * 1000,
}
```

- 起動と、`url` が 2xx/3xx/400〜403 を返すまでの待ち（ready の確認）を Playwright が行う。port の待ちを自作する必要はない。
- `reuseExistingServer: !process.env.CI`: ローカルでは起動済みを使い、CI では必ず新しく起動する。CI で `true` だと、残っていた古いプロセスを使う危険がある。
- 複数のサーバ（フロントと API）は `webServer` を配列にする。`name` でログに印が付く。
- `baseURL` を `use` に書き、テストは相対パスにする。
- Docker のコンテナを `webServer` で起動する場合は、止めるのに SIGTERM が要る。`gracefulShutdown: { signal: 'SIGTERM', timeout: 500 }` を設定する（文書に明記）。

### 構成 (b): Playwright の公式イメージ

```yaml
container:
  image: mcr.microsoft.com/playwright:v1.64.1-noble
  options: --user 1001
```

- ブラウザと OS の依存が入っていて、環境を揃えられる。screenshot の比較（visual regression）では OS が違うと差が出るので、特に勧められる。
- イメージの版は Playwright の版と合わせる。
- 注意: 公式イメージのジョブの中でアプリを docker compose で立てるには、Docker を入れ子にする必要がある。**この組合せの標準は、読んだ文書にはない**。

### 構成 (c): アプリと DB を docker compose や service container で立てる

- Playwright の文書にはない。GitHub Actions の `services:`（service containers）で DB を立て、アプリは `webServer` で立てるのが、小さく済む組合せだと思う（判断）。出典は未読なので、採るなら別途確かめる。
- トランクベース開発の側は、「Docker で本番の小さな写しを作ってテストする」を肯定している（上記）。

### レポートと失敗の調査

- CI の失敗には trace viewer を使う。`trace` は「最初の retry で採る」を推奨し、全テストで `on` にするのは重いので勧めない。
- HTML レポートは `actions/upload-artifact` で `if: ${{ !cancelled() }}` で保存する（公式の例）。
- Linux で流す（安い）。

## 3. 認証、データ、外部サービス

出典: Playwright Best Practices。

- 認証: 各テストは独立にする。毎回ログインするより、setup project で 1 回ログインして状態を再利用する方法が公式に挙げられている。Better Auth の Cookie（ADR 0022）の場合の具体は読んでいない。
- データ: 「DB を使うなら、データを自分で制御する。変わらないステージング環境に対してテストする」。CI の使い捨ての DB は、これを満たす形。データの用意と後始末の具体（テストごとの作成、トランザクション、ID を分ける）は、公式に詳しい記述がない。
- 外部サービス: 「自分が制御しない第三者のサービスをテストしない。Network API（`page.route`）でレスポンスを固定する」。AWS のサービスをテストの対象外にする根拠になる。ただし本調査では AWS のモック（LocalStack など）の標準は調べていない。

## 4. flaky の扱いとゲートの条件

- Playwright の retry（出典: Retries）: 既定は retry なし。`retries` を設定すると、結果は `passed`、`flaky`（最初に失敗して retry で通った）、`failed` に分類される。失敗したテストは新しい worker プロセスで再実行される。`flaky` が報告に出るので、見えなくならない。
- テストの独立: 公式は「テストは互いに独立に。`describe.serial` は依存するテストを束ねる用で、独立にするほうが良い」。
- Fowler（nonDeterminism）: 非決定的なテストは、残すと「感染」する（失敗を無視する習慣が付き、健全なテストの失敗も無視される）。隔離して、別のスイートに置く。隔離は期限（例: 1 週間）か数の上限（例: 8 個）で管理する。**隔離したテストを主のパイプラインに入れたままにするのは勧めない**（ただし優秀なチームは、1 段後ろに入れる例がある）。
- trunkbaseddevelopment.com: 「テストが誤って通ることはなく、誤って落ちるのが問題」「いつも一定の割合で落ちる CI の価値は低い」。
- ゲートにしてよい条件（上記からの判断）: (1) 決定的である（モデルの判定に依存しない）。(2) 独立している。(3) 速い（失敗の通知まで数分〜十数分。目安は公式にない）。(4) flaky が見えて、期限付きで隔離される。(5) 失敗時に trace が残る。

### アンチパターン（出典付き）

- テスト間でデータや状態を共有する（Playwright Best Practices、Fowler の「Lack of Isolation」）。
- CSS クラスや XPath の locator（Best Practices。`getByRole` などを優先）。
- `expect(await x.isVisible()).toBe(true)` のような手動の assertion（Best Practices）。
- 第三者のサイトやサービスをテストの対象にする（Best Practices）。
- retry で flaky を隠す。`flaky` の分類を見ない（Retries、Fowler）。
- `globalTimeout` がなく、ジョブの上限で殺されてレポートが出ない（CI の文書）。
- `--only-changed` だけで全体を流さない（CI の文書）。
- CI で `reuseExistingServer: true`（webServer の文書は `!process.env.CI` を示す）。
- 隔離したテストを放置する（Fowler）。
- 全ブラウザを入れる、全 OS で流す（CI の文書は Linux と、必要なブラウザだけを勧める）。
- 非機能（性能）のテストを、機能の E2E と同じ段階で流す（trunkbaseddevelopment.com は後の段階を勧める）。

## 5. このリポジトリに当てはめたときの論点

このリポジトリの構成（Nx、Vite+、Hono の API と React の web、Aurora、ECS か Lambda Web Functions のコンテナ）は、ADR と `docs/` による。読んだ範囲では次が論点になる。

1. **何を起動するか**: web（Vite の build の成果物か preview）と API（Hono）、DB（Aurora は PostgreSQL 互換か MySQL 互換かで service container のイメージが変わる。ADR で確認が要る）。`webServer` を配列にして 2 つ起動し、DB は service container か compose。
2. **コンテナのイメージを使うか**: 本番に近い形（ADR 0013 のコンテナ）で立てるか、dev server で立てるか。前者のほうが検証環境の smoke(#88) と近いが、build の時間がかかる。後者は速いが、コンテナ固有の問題は見逃す。
3. **範囲**: PR の必須には、少数の重要な導線（ログイン、主要な書き込み 1〜2 本）に絞り、広い網羅は merge 後や定期に回す形が、トランクベース開発の「速い build」と合う（判断）。公式は範囲の分け方を指定していない。
4. **AWS の依存**: 日々の CI では AWS の実物を使わない。AWS に依存する導線は検証環境の smoke(#88) に任せる。分け方が決まると、2 つの E2E が重ならない。
5. **ブラウザ**: 日々の CI は Chromium のみ、定期に 3 ブラウザ、という分け方が公式の「必要なブラウザだけ」と合う。
6. **Vitest の browser mode の component test との分担**: `docs/web-frontend/testing.md` のとおり、ページ遷移を伴うものが E2E の担当。

## 6. 確かめられなかったこと

- 実際に流した時間と費用。このリポジトリの値は未測定。
- docker compose で立てる形の標準（GitHub Actions の service containers、docker compose の文書は未読）。
- DORA の資料、Google のテストの資料。
- Better Auth の Cookie のログインを setup project で再利用する具体、DB のデータの用意と後始末の標準、AWS の API のモックの標準。
- Aurora のエンジン（PostgreSQL か MySQL か）と ADR の関係の読み合わせ。

## 7. 決めるべき論点（#223 へ）

1. 日々の CI の E2E を PR の必須チェックにするか。するなら範囲（導線の数）と時間の上限。
2. アプリの起動を `webServer` だけにするか、DB を service container や compose で立てるか、コンテナのイメージで立てるか。
3. flaky の方針（retry 0 か 1、`flaky` の扱い、隔離の期限）。
4. 日々の CI の E2E と、検証環境の smoke（#88）の導線の分担。
