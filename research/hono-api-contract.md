# Hono の API 契約の方式を比べる

## 問い

[yokozi-jp/hono-nx-vite-plus#31](https://github.com/yokozi-jp/hono-nx-vite-plus/issues/31)

hono-openapi、`@hono/zod-openapi`、Hono RPC（型の共有）を比べる。観点は、OpenAPI の生成と commit、Spectral による lint、oasdiff による破壊的変更の検出、実際の応答とスキーマの照合、Schemathesis による API の fuzz、MSW の handler の生成（Orval など）との組み合わせ。

## 要約

- `apps/api` は今、素の `Hono` で `app.get("/health", ...)` を1本チェーンし、`export type AppType = typeof app` まで書いてある。Hono RPC は追加の依存なしで今すぐ使える状態。OpenAPI 生成は未導入（`apps/api/src/app.ts`、`pnpm-workspace.yaml` の catalog `hono: ^4.13.13`）。
- Hono RPC は OpenAPI ドキュメントを生成しない。型（`AppType`）を TypeScript 越しに共有するだけ。したがって Spectral、oasdiff、Schemathesis、Orval はどれも Hono RPC 単体では使えない（OpenAPI の成果物が無いため）。
- OpenAPI を生成できるのは `@hono/zod-openapi` と hono-openapi の2つ。両方とも `app.request()` で spec を取り出して JSON に書き出せるので、生成した OpenAPI を commit し、Spectral の lint と oasdiff の破壊的変更検出に回せる。
- `@hono/zod-openapi` 1.6.3 は Zod 専用（peer `zod ^4.0.0`、`hono >=4.10.0`）。`createRoute` でルートを宣言し、`OpenAPIHono` が検証と spec 生成を兼ねる。RPC モードも公式に対応する。
- hono-openapi 1.5.0 は Standard Schema 準拠のバリデータ全般（Zod、Valibot、ArkType、TypeBox、Effect）に対応（peer `hono ^4.11.2`）。`describeRoute` と `openAPISpecs`/`generateSpecs` で既存の素の Hono にかぶせる形。README に「still in development」の注記あり。
- 実際の応答とスキーマの照合は2通り。(a) hono-openapi の `describeRoute({ validateResponse: true })（Experimental）、(b) 生成した spec に対して Schemathesis を実行時に走らせる。`@hono/zod-openapi` は応答の自動照合を標準機能として持たない（ステータス指定は型での担保）。
- Schemathesis 4.32.4 は OpenAPI の spec を入力に、実際に動く API へ入力を生成して投げる（fuzz）。Python ツールで、起動中のサーバが要る。spec だけでは動かない。
- Orval 8.44.0 は OpenAPI v3/Swagger v2 から TypeScript クライアントと MSW のモック handler を生成する。入力は OpenAPI の spec。したがって `@hono/zod-openapi` か hono-openapi の生成物が前提。

## 比較

| 観点                      | Hono RPC                                 | `@hono/zod-openapi`                      | hono-openapi                                      |
| ------------------------- | ---------------------------------------- | ---------------------------------------- | ------------------------------------------------- |
| 最新版（2026-10-23 時点） | `hono` に同梱（catalog `^4.13.13`）      | 1.6.3                                    | 1.5.0                                             |
| peer                      | Hono のみ                                | `hono >=4.10.0`、`zod ^4.0.0`            | `hono ^4.11.2`（+ 各バリデータ）                  |
| OpenAPI ドキュメント生成  | しない                                   | する                                     | する                                              |
| バリデータ                | 任意（Standard Schema 可、RPC は型のみ） | Zod 専用                                 | Standard Schema 全般                              |
| 型の共有（RPC）           | 中心機能                                 | 対応（RPC モード）                       | 素の Hono のため RPC は従来どおり使える（型のみ） |
| 既存コードへの載せ方      | そのまま                                 | `OpenAPIHono` + `createRoute` に書き換え | 素の `Hono` に `describeRoute` を足す             |
| OpenAPI の commit         | 対象外                                   | `app.request('/doc')` を書き出す         | `generateSpecs()` で書き出す                      |
| Spectral lint             | 不可（spec が無い）                      | 生成した spec を lint                    | 生成した spec を lint                             |
| oasdiff 破壊的変更        | 不可                                     | 生成した spec を比較                     | 生成した spec を比較                              |
| 応答とスキーマの照合      | 型（コンパイル時）のみ                   | 標準機能なし                             | `validateResponse`（Experimental）                |
| Schemathesis fuzz         | 不可                                     | 生成 spec + 起動サーバ                   | 生成 spec + 起動サーバ                            |
| Orval / MSW 生成          | 不可                                     | 生成 spec が入力                         | 生成 spec が入力                                  |

## Hono RPC（型の共有）

- RPC は「サーバとクライアントの間で API の仕様（型）を共有する」機能。サーバで `AppType`（`typeof app` か公開したいルート）を export し、クライアントで `hc<AppType>()` に渡すと、入力（Validator が決める）と出力（`c.json()` の戻り）の型が推論される（honojs/website `docs/guides/rpc.md`）。
- バリデータは `@hono/zod-validator` でも Standard Schema Validator でもよい。Valibot など任意の Standard Schema ライブラリが使える（同上）。
- ステータスコードを `c.json(data, 404)` のように明示すると、そのコードが型として伝わる。`c.notFound()` は型が崩れるので、クライアント前提なら使わず `c.json(..., 404)` を使う（同上）。
- モノレポでの注意: クライアントとサーバの両方の tsconfig で `"strict": true` が要る。Hono の版がずれると "Type instantiation is excessively deep" になる。ルートが増えると IDE が遅くなるので、サブアプリに分ける、`hc<AppType>` を事前コンパイルして `hcWithType` を使う、などの緩和策がある（同上）。
- 現状の `apps/api` は既に `export type AppType = typeof app` を書いており、追加の依存なしに RPC が成立する（`apps/api/src/app.ts`）。
- OpenAPI ドキュメントは生成しない。これは RPC の設計上の範囲外で、型は TypeScript の推論でだけ共有される（同上）。

## `@hono/zod-openapi`

- 「OpenAPI に対応した Hono の拡張クラス」。Zod で値と型を検証し、同時に OpenAPI の Swagger ドキュメントを生成する。内部は `@asteasolutions/zod-to-openapi`（依存に `@asteasolutions/zod-to-openapi ^9.1.0`、`@hono/zod-validator ^0.9.1`、`openapi3-ts ^4.5.0`）(honojs/middleware `packages/zod-openapi/README.md`、npm registry の 1.6.3 メタデータ)。
- peer は `hono >=4.10.0`、`zod ^4.0.0`（npm registry、1.6.3）。カタログの `hono ^4.13.13` は満たすが、Zod は未導入なので追加が要る。
- 使い方: `z`（`@hono/zod-openapi` から import）でスキーマ、`createRoute` でルート（`request`/`responses` を宣言）、`OpenAPIHono` の `app.openapi(route, handler)` でハンドラ。ドキュメントは `app.doc('/doc', {...})`（3.0）または `app.doc31('/docs', {...})` / `app.getOpenAPI31Document(...)`（3.1）で出す(README)。
- RPC モード対応。`app.openapi(...)` の戻りを `hc<typeof appRoutes>()` に渡せる。ルートが多いときは小さな `OpenAPIHono` に分けて `.route()` で mount すると型チェックが軽くなる(README "RPC Mode")。
- 制約: 素の `Hono` と混ぜると `OpenAPIHono` は素の `Hono` 側の定義を拾えない。ヘッダのキーはスキーマ上すべて小文字にする必要がある。`.route()` で子をマウントするとき親のパスは Hono の `:param` 記法にする(README "Limitations")。
- 応答とスキーマの実行時照合は標準機能として記載がない。`responses` の型と `c.json(data, 200)` のステータス明示で、型レベルの担保になる(README)。
- OpenAPI の commit: `app.doc`/`app.doc31` のエンドポイントを `app.request()` で叩いて JSON を書き出せる（Hono の `app.request` 一般、RPC ガイドでも使用）。これを Spectral・oasdiff に回す。

## hono-openapi

- 「バリデーションスキーマから Hono アプリの OpenAPI spec を自動生成する」ライブラリ。Standard Schema 準拠のバリデータすべてに対応（Zod、Valibot、ArkType、TypeBox、Effect）(rhinobase/hono-openapi README; 詳細版は tag `core@0.4.8` の README)。
- peer は `hono ^4.11.2`。依存に `@hono/standard-validator ^0.4.0`、`@standard-schema/spec ^1.0.0`、`@standard-community/standard-openapi`、`openapi-types`（npm registry、1.5.0）。カタログの `hono ^4.13.13` は満たす。
- 使い方: 素の `new Hono()` に `describeRoute({ description, responses })` をミドルウェアとして足し、`resolver(schema)` で応答スキーマ、`validator`（例: `hono-openapi/zod` から `zValidator`）で入力検証。spec は `openAPISpecs(app, { documentation: {...} })` をルートに生やすか、`generateSpecs(app, options)` で取り出す(tag `core@0.4.8` の README)。
- `generateSpecs(app, options)` の戻りを `fs.writeFileSync('openapi.json', JSON.stringify(spec, null, 2))` でファイルに書ける。OpenAPI を commit する用途にそのまま使える(同上 "Persisting OpenAPI Spec to a file")。注意: `node:fs` を直接使う例なので、ADR 0007 のルール（`apps/api/src` では Node 組み込みを import しない）に触れる。spec の書き出しはアプリの外（スクリプトや入口ファイル）で行う必要がある — 判断は別チケット。
- 応答とスキーマの実行時照合: `describeRoute({ validateResponse: true })`。ただし README に **Experimental** の警告がある(同上 "Validating Responses")。
- `hide: process.env.NODE_ENV === 'production'` で spec から特定ルートを除ける(同上)。
- README に「This package is still in development」の注記（rhinobase/hono-openapi README、2026-10-23 時点の npm 1.5.0 の README も同文）。

## 周辺ツール（3方式に共通して必要な成果物は OpenAPI の spec）

### Spectral（OpenAPI の lint）

- `@stoplight/spectral-cli` 6.17.0。OpenAPI v2/v3.0/v3.1/v3.2、AsyncAPI、Arazzo を lint する generic な YAML/JSON リンタ。`.spectral.yaml` の ruleset が要る（`extends: ["spectral:oas"]` で OpenAPI の既定ルール）(stoplightio/spectral `README.md`、npm registry のバージョン)。
- `spectral lint myapifile.yaml --ruleset myruleset.yaml` で実行。入力は OpenAPI のファイルなので、`@hono/zod-openapi` か hono-openapi が生成した spec が前提。

### oasdiff（破壊的変更の検出）

- `oasdiff breaking` は既存のクライアントを壊す変更だけを、`oasdiff changelog` は影響しうる変更を（破壊的も非破壊的も）出す。説明や example だけの編集は含まない（oasdiff `docs/BREAKING-CHANGES.md`）。
- チェックは `ERR`（確実な破壊的）/`WARN`（潜在的）/`INFO`（非破壊的）。`breaking` は `ERR` と `WARN` を検出。CI では `--fail-on ERR`（`ERR` で終了コード1）、`--fail-on WARN`、`--fail-on INFO` で止められる(同上)。
- サーバが実際に受け付けるかではなく、OpenAPI が宣言する契約に照らして破壊性を判断する。必須プロパティの追加は、default があっても破壊的(同上)。
- 出力は text/json/yaml/githubactions/junit/html/markdown/singleline。多数の spec を git ref と比較する用途は `BREAKING-FILES.md`（pre-commit hook 向け）(同上)。
- OpenAPI 3.1 は `v1.15.0` から GA。3.1 固有フィールド（`type: ["string","null"]` の nullable、数値 `exclusiveMinimum`、`const`、`prefixItems` など）の破壊的変更を検出。3.0 と 3.1 を跨ぐ比較は `--auto-upgrade` で方言差のノイズを消せる。3.2 も読める（oasdiff `docs/OPENAPI-31.md`）。最新は v1.34.1（git tags、2026-10-23 時点）。
- parser は kin-openapi。`$dynamicRef`/`$dynamicAnchor` と components の `pathItems` は未対応で diff に出ない(同上 "Caveats")。

### Schemathesis（API の fuzz）

- 4.32.4。OpenAPI か GraphQL の spec から入力を生成し、サーバの応答に適応して、実際にリクエストを投げるアダプティブな API テスト（property-based）。Python ツール（Hypothesis 上に構築）(schemathesis/schemathesis `README.md`、PyPI のバージョン)。
- 500 エラー、スキーマ違反（文書と違う応答）、検証バイパス、ステートフルなバグなどを探す(同上)。
- 実行には起動中の API が要る（`schemathesis run <openapi.json の URL>`）。spec だけでは動かず、本番ではなく dev/staging に向けること(同上)。
- CLI は `uv tool install schemathesis`。pytest 連携や `schemathesis/action@v3` の CI もある。`--report html` などのレポート、baseline で「新規の失敗だけ CI を落とす」運用も可能(同上)。

### Orval / MSW の handler 生成

- Orval 8.44.0。有効な OpenAPI v3 または Swagger v2（yaml/json）から型安全な TypeScript クライアントを生成。models/requests/hooks に加え MSW のモックも生成する。対応クライアントは React Query、SWR、Vue Query など(orval-labs/orval `README.md`、npm registry のバージョン)。
- 入力は OpenAPI の spec。したがって `@hono/zod-openapi` か hono-openapi の生成物が前提で、Hono RPC 単体とは組み合わせられない。
- 注記（判断の材料）: Orval の README は v8 で大きな変更ありとして Migration Guide を案内している(同上)。

## 判断（最終判断は別の grilling チケット）

- 判断: API の契約を「OpenAPI の成果物」に置きたいなら、候補は `@hono/zod-openapi` か hono-openapi の2つ。Spectral・oasdiff・Schemathesis・Orval はいずれも OpenAPI の spec を入力に取る標準的なツールで、Hono RPC 単体では spec が無く接続できない。出典: 各ツールの公式 README/docs（上記）。避けるアンチパターン: 型の共有（RPC）だけで「契約を検証している」と見なすこと。RPC はコンパイル時の型整合であって、実行時の応答検証や破壊的変更の検出、言語をまたぐクライアント生成はしない（honojs/website `docs/guides/rpc.md`）。
- 判断: RPC と OpenAPI 生成は排他ではない。`@hono/zod-openapi` は RPC モードを公式に持ち、hono-openapi は素の Hono にかぶせるので従来どおり `AppType` を export できる。TypeScript のクライアントは RPC、他言語や MSW は OpenAPI、という二刀流が取れる。出典: honojs/middleware `packages/zod-openapi/README.md`、rhinobase/hono-openapi README。
- 判断（ADR 0007 との整合）: hono-openapi の spec 書き出し例は `node:fs` を直接使う。`apps/api/src` は Web 標準 API だけというルール（ADR 0007）に触れるので、spec の生成・書き出しは入口ファイルかビルドスクリプト側に置く設計が要る。`@hono/zod-openapi` の `app.doc` 方式は `app.request()` でアプリ内から spec を取れるので、Node 組み込みに触れずに済む。出典: `docs/adr/0007-api-on-node-web-standard-app.md`、各 README。

## 未確認のこと

- hono-openapi 1.5.0 の最新 README（honohub.dev）に、`core@0.4.8` の README から変わった API があるかは未確認。honohub.dev は本マシンのネットワーク注意の対象外だが到達確認をしていない。詳細な使用例は tag `core@0.4.8` の README を根拠にした。
- `@hono/zod-openapi` の応答の実行時照合（spec と実レスポンスの自動突き合わせ）を標準機能として持つかは、README に記載が無く「無い」と判断した。ミドルウェアで自作する余地は未確認。
- Schemathesis を Nx のタスクとして回す場合の、API の起動と teardown の具体的な配線（`vp dev` との組み合わせ）は未調査。
- Orval が Hono の生成する OpenAPI 3.1 spec（`type: ["string","null"]` など）を問題なく読めるかの実地確認はしていない。Orval の README は v3/v2 対応と記載。
- zod v4 を catalog に入れる影響（他パッケージとの相性、`@hono/zod-validator ^0.9.1` との整合）は本調査の範囲外。

## 出典

- `apps/api/src/app.ts`、`apps/api/package.json`、`pnpm-workspace.yaml`（この worktree、2026-10-23）
- `docs/adr/0007-api-on-node-web-standard-app.md`（この worktree）
- Hono RPC ガイド: <https://raw.githubusercontent.com/honojs/website/main/docs/guides/rpc.md>
- `@hono/zod-openapi` README: <https://raw.githubusercontent.com/honojs/middleware/main/packages/zod-openapi/README.md>
- `@hono/zod-openapi` 1.6.3 メタデータ: <https://registry.npmjs.org/@hono/zod-openapi>
- hono-openapi README: <https://raw.githubusercontent.com/rhinobase/hono-openapi/main/README.md>
- hono-openapi 詳細 README（tag core@0.4.8）: <https://raw.githubusercontent.com/rhinobase/hono-openapi/core@0.4.8/README.md>
- hono-openapi 1.5.0 メタデータ: <https://registry.npmjs.org/hono-openapi>
- Spectral README: <https://raw.githubusercontent.com/stoplightio/spectral/develop/README.md>（`@stoplight/spectral-cli` 6.17.0: <https://registry.npmjs.org/@stoplight/spectral-cli>）
- oasdiff 破壊的変更: <https://raw.githubusercontent.com/oasdiff/oasdiff/main/docs/BREAKING-CHANGES.md>
- oasdiff OpenAPI 3.1: <https://raw.githubusercontent.com/oasdiff/oasdiff/main/docs/OPENAPI-31.md>
- Schemathesis README: <https://raw.githubusercontent.com/schemathesis/schemathesis/master/README.md>（4.32.4: <https://pypi.org/pypi/schemathesis/json>）
- Orval README: <https://raw.githubusercontent.com/orval-labs/orval/master/README.md>（8.44.0: <https://registry.npmjs.org/orval>）
