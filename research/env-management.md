# monorepo の .env と環境変数の、置き方、読み方、起動時の検査、lint、本番への渡し方、エージェントの制限を比べる

## 問い

[Issue #215](https://github.com/yokozi-jp/agent-software-factory/issues/215) の調査。この monorepo（`apps/api`、`apps/web`、`packages/*`、`tools/scripts`）で、`.env` と環境変数をどう置き、どう読み、どう検査するかの選択肢を、一次情報で比べる。結果は [#216 .env と環境変数の置き方、読み方、検査を決める](https://github.com/yokozi-jp/agent-software-factory/issues/216) の材料にする。この文書は決定を下さない。

調べる点は 6 つ。

1. 置き方（ルートかアプリごとか、`.env.example`、mise の `[env]` と `_.file`）。
2. 読み方（Node.js の `--env-file` と `process.loadEnvFile`、Vite、dotenv、dotenvx、varlock、Nx の cache）。
3. 起動時の検査（schema で検査して、足りなければ起動を止める。Hono の `c.env` と ADR 0007）。
4. `.env` の lint（dotenv-linter、betterleaks、Knip との重なり）。
5. 本番と検証環境への渡し方（ECS と Lambda で Secrets Manager、SSM Parameter Store、環境変数）。
6. エージェントに `.env` を読ませない、書かせない設定。

調べた日は 2026-10-26。作業は Linux、Node.js 24.22.1、mise 2026.10.17。web の情報は版と日付を添えた。実際にコマンドを動かして確かめた事実は「実行して確認」と書く。AWS の上では何も実行していない。

## 要約

- 現状（実行して確認、リポジトリを読んだ結果）: `.env` を読むコードはリポジトリにまだ無い。`apps/api/src/server.ts` が `process.env` を直接読み、必須の 6 つの変数（`AUTH_DATABASE_URL`、`PUBLIC_ORIGIN`、`AUTH_SECRET`、`OIDC_DISCOVERY_URL`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`）を自作の `requireEnv` で検査して、空なら例外で止める。型の検査は無い。`.env.example` はまだ無い。
- ADR 0007 と食い違う点: ADR 0007 は「環境変数は `c.env` で受け取る」と書く。しかし `@hono/node-server` の `c.env` は `{ incoming, outgoing }`（Node.js の request と response）で、環境変数は入らない。Lambda Web Functions も普通の HTTP サーバーを起動するので、同じ入口（`@hono/node-server`）になる。実際の `apps/api/src/server.ts` は `process.env` を読み、`createApp({ auth })` に引数で渡している。この「入口で読み、引数で渡す」形は ADR の趣旨（`src` に `process` を持ち込まない）と合うが、文言の `c.env` とは違う。
- Node.js 24 は `--env-file`、`--env-file-if-exists`、`process.loadEnvFile` を標準で持つ（v24.10.0 から stable）。シェルの環境変数が file に勝つ。同じ key が file に 2 つあると後が勝つ（実行して確認）。dotenv などを足さなくても、`.env` は読める。
- Vite は `.env` の読み込みを自分で持つ（`envDir` の既定は project の root）。`VITE_` で始まる変数は client の bundle に埋め込まれるので、秘密を入れてはいけない。`apps/web` は今、環境変数を使っていない。
- Nx は task の実行時に、project の root と workspace の root の `.env` 系の file を自分で読み込む（`NX_LOAD_DOT_ENV_FILES=false` で止められる）。一方で cache の hash は、`.gitignore` された file を既定では見ない。`.env` を変えても、cache は無効にならない。値を hash に入れるには `{ "env": "NAME" }` の入力を宣言する。
- 起動時の検査は schema（zod など）を入口に 1 つ置く形が標準。zod 4.6.7 で、`z.coerce.boolean()` が文字列 `"false"` を `true` にすること、`z.coerce.number()` が空文字を `0` にすることを実行して確認した。真偽は `z.stringbool()` を使う。
- `.env` の lint: dotenv-linter 4.0.0（実行して確認）は、重複した key、小文字の key、`=` の前後の空白、key の順序を見つける。`dotenv-linter diff` は 2 つの file の key の過不足を出す。値の中身（秘密かどうか）は見ない。betterleaks は `git` モード（commit した内容）では `.gitignore` 済みの `.env` を見ず、`dir` モードでは見つけた（実行して確認）。Knip は `.env` を扱わない（判断、未実行）。
- 本番: ECS は task definition の `secrets` で Secrets Manager か Parameter Store の値を環境変数に注入できる（注入は task の起動時の 1 回で、更新は自動では届かない）。Lambda Web Functions の文書は、秘密を環境変数に入れず、Secrets Manager か Parameter Store から実行時に取るよう書く。環境変数は revision ごとに固定で、変えるには新しい revision を作る。
- エージェントの制限: Kiro の v3 engine（2.34.0）の権限の規則は `capability`（`fs_read`、`fs_write`、`shell` など）、`match`、`exclude`、`effect`（`allow`、`deny`、`ask`）で書く。user 用は `~/.kiro/settings/permissions.yaml|json`、workspace 用は `~/.kiro/workspace-roots/<id>/` の下にあり、リポジトリには入らない。リポジトリに commit できるのは、custom agent の `permissions` と PreToolUse hook。今ある hook の `matcher` は書き込みと shell だけで、read は対象外。
- 「標準」と言える出典がある点: 設定を環境変数に置く（The Twelve-Factor App）、`.env.example` を commit して `.env` を ignore する、起動時に schema で検査して fail closed にする。出典が無く、選択肢のどれも「標準」と呼べない点: monorepo でルートに置くかアプリごとに置くか、`.env.example` と schema のどちらを正本にするか。

## 現状のリポジトリ（事実）

- `.gitignore` は `.env` と `.env.*` を除外し、`!.env.example` だけを残す（`.gitignore` の 16〜18 行目）。`*.local` も除外している。そのため、`.env.schema`（varlock）や `.env.vault` のような名前の file は、否定の規則を足さない限り commit できない。
- `docs/tooling/secret-scan.md`: 本物の秘密は、コードから外して `.env`（commit しない）に移し、必要な変数の一覧を `.env.example` に書いて commit する。
- `mise.toml` に `[env]` は無い。`[tools]` と `[settings]` だけ。
- `nx.json` の `namedInputs` に環境変数の入力は無い。`test` の `inputs` は `["default", "^production"]`。
- `apps/api/src/server.ts`（入口）だけが `process.env` を読む。`apps/api/vite.config.ts` の dev server の入口は `src/index.ts`（認証なし）。`vite.config.ts`（ルート）の Oxlint の規則が、`apps/api/src` の `process` に「Read environment variables from `c.env`.」のメッセージを出す。入口とテストは対象外。
- `apps/web` は `import.meta.env` も `process.env` も使っていない。

## 1. 置き方

### 選択肢

| 置き方                                                     | 内容                                                                                                                                      | 出典                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. アプリごとに `apps/<app>/.env`                          | Vite の `envDir` の既定は project の root なので、`apps/web/.env` がそのまま読まれる。Nx も project の root の `.env` を読む              | [Vite: envDir](https://raw.githubusercontent.com/vitejs/vite/main/docs/config/shared-options.md)、[Nx: Define Environment Variables](https://nx.dev/docs/guides/tips-n-tricks/define-environment-variables) |
| B. ルートに 1 つの `.env`                                  | Nx は workspace の root の `.env` も読む。Vite は `envDir` をルートにしないと読まない。mise は `_.file = ".env"` で子ディレクトリにも効く | 同上、[mise: Environments](https://raw.githubusercontent.com/jdx/mise/main/docs/environments/index.md)                                                                                                      |
| C. ルートに置き、mise の `[env]` と `_.file` で読み込む    | `mise exec` と `mise run` の中のすべての process に環境変数が入る。親ディレクトリの `mise.toml` は子ディレクトリでも効く（実行して確認）  | 同上                                                                                                                                                                                                        |
| D. `.env` を使わず、`mise.local.toml`（ignore 済み）に書く | mise の `[env]` に直接書く。形式は TOML。`mise.local.toml` が `mise.toml` に勝つ                                                          | 同上                                                                                                                                                                                                        |

### 確かめた事実

- mise の `_.file` は、相対パスを project のディレクトリから解決し、path に合う file が無ければ error にせず skip する。`.env.*` のような glob も使える。`find_up = true` で、親ディレクトリの `.env` も探す。mise は 2026.10.17 で動かした。
- 実行して確認: ルートの `mise.toml` に `_.file = [".env", ...]` と `FOO = "from-mise"` を書き、`.env` に `FOO=file` を書くと、`mise x -- sh -c 'echo $FOO'` は `from-mise` を出した。`[env]` の直接の値が `_.file` の値に勝った。子ディレクトリで `mise x` を動かしても、親の `.env` の値が見えた。
- 実行して確認: `mise env` は `.env` の値を平文で出力する（`redact` を付けない entry）。`redact = true` は task の出力のマスクに効く。`mise env` の出力が隠れるかは確かめていない。
- mise は `required = true` で、他で設定されるべき変数の有無を `mise exec`、`mise run`、`mise env` で検査できる（値の型は見ない）。
- ADR 0009 の方針（版を固定する CLI ツールは mise で入れる）と、`[env]` に変数を置くことは別の話。`mise.toml` の先頭のコメントは「Only `[tools]` with exact versions」と書くので、`[env]` を足すなら、このコメントと、`tools/scripts/src/checks/repo-policy/cli.ts` の検査が `[env]` を許すかを確かめる必要がある（未確認）。

### 標準の慣行と出典

- 設定は環境変数に置く。設定の file を repo に commit しない理由は「うっかり commit しやすい、置き場所と形式がばらつく」。[The Twelve-Factor App: III. Config](https://12factor.net/config)。
- `.env.example` を commit して `.env` を ignore する書き方は、dotenv-linter の `diff` コマンドが前提にする形で、`.env` と `.env.example` の key を比べる。[dotenv-linter の README](https://raw.githubusercontent.com/dotenv-linter/dotenv-linter/master/README.md)。Vite も `.env.local` と `.env.*.local` を ignore するよう書く（[Env Variables and Modes](https://raw.githubusercontent.com/vitejs/vite/main/docs/guide/env-and-mode.md)）。
- monorepo でルートに置くかアプリごとに置くかを決める公式の標準は、確認できなかった。Nx は両方を読む。Vite は `envDir` で選ぶ。

### 避けるアンチパターン

- 環境ごとに `.env.production`、`.env.staging` と file を増やし、環境の名前でグループ化する。12-factor は、環境の名前でまとめると、`joes-staging` のような環境が増えて組み合わせが爆発すると書く（同上）。Vite の `.env.[mode]` はこの形を前提にしているので、使うなら `NODE_ENV` と mode が別物であることに注意する（[Vite: NODE_ENV and Modes](https://raw.githubusercontent.com/vitejs/vite/main/docs/guide/env-and-mode.md)）。
- 秘密を入れた `.env.production` を repo に置く（`.gitignore` の `!.env.example` 以外は commit しない）。

## 2. 読み方

### Node.js

実行して確認（Node.js 24.22.1）。`.env` は次の内容。

```dotenv
A=1
A=2
B="x y" # c
export C=3
EMPTY=
Q='a b'
M="l1
l2"
```

- `node --env-file=.env t.mjs` は `A=2`（同じ key が 2 つあると後が勝つ）、`B=x y`（コメントと引用符を除く）、`C=3`（`export` を無視）、`EMPTY` は空文字、`M` は改行を含む値を読んだ。
- `A=shell node --env-file=.env t.mjs` は `A=shell`。シェルの環境変数が file に勝つ。
- file が無いと、`--env-file=.nope` は error（終了コード 9、`.nope: not found`）。`--env-file-if-exists=.nope` は `.nope not found. Continuing without it.` を出して続ける。
- `process.loadEnvFile(".env")` は `process.env` に読み込む。`util.parseEnv("X=1\nX=2")` は `{ X: '2' }`。

出典: [Node.js v24 CLI: --env-file](https://nodejs.org/docs/latest-v24.x/api/cli.html)（`--env-file` と `--env-file-if-exists` は v24.10.0 から stable、複数回指定でき、後の file が前の file を上書き、環境の値が file に勝つ）、[process.loadEnvFile](https://nodejs.org/docs/latest-v24.x/api/process.html#processloadenvfilepath)。

注意（判断）: `--env-file` は、`node tools/scripts/src/.../cli.ts` のように node を直接起動する経路にしか効かない。`vp`、`nx`、`pnpm exec` などのツールが node を子 process として起動する場合は、ツール側の process が `.env` を読んだかが別に決まる。Nx は自分で `.env` を読む（下記）。

### Vite

- Vite は dotenv で `.env`、`.env.local`、`.env.[mode]`、`.env.[mode].local` を読む。`envDir` の既定は `root`。`false` で読み込みを止められる。起動前に既にある環境変数は、`.env` に上書きされない。
- `VITE_` で始まる変数だけが `import.meta.env` に出て、client の source に埋め込まれる。公式は「`VITE_*` に API key などの秘密を入れてはいけない」と書く。値は文字列で、数や真偽に自動では変わらない。
- `envPrefix` を `''` にすると全部が露出するので、Vite は error にする。
- `.env` の読み込みは起動時の 1 回。変更したら dev server を再起動する。
- Bun を使うと、Bun が先に `.env` を `process.env` に入れて、Vite の動きに干渉する（公式の警告）。このリポジトリは ADR 0007 で Node.js のまま。

出典: [Env Variables and Modes](https://raw.githubusercontent.com/vitejs/vite/main/docs/guide/env-and-mode.md)、[shared-options: envDir, envPrefix](https://raw.githubusercontent.com/vitejs/vite/main/docs/config/shared-options.md)。

このリポジトリでは、`apps/web` が Vite の SPA。client が使う値（例: API の origin）は `VITE_` の変数か、同じ origin の相対パスにするかを決める必要がある（Cookie の BFF なので相対パスで足りる可能性が高い。ADR 0022。判断）。`apps/api` の秘密を `apps/web/.env` に置かない。

### dotenv、dotenvx、varlock

| 道具    | 版（npm、確認日 2026-10-26） | 役割                                                                                                                                                          | 注意                                                                                                                                                                     |
| ------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| dotenv  | 18.0.9（2026-10-22 更新）    | `.env` を `process.env` に読む library。Vite が内部で使う                                                                                                     | Node.js 24 は同じことを標準で持つ。重複 key の扱いなど、細部は Node.js と違う可能性があるが、比べていない                                                                |
| dotenvx | 2.38.2（2026-10-20 更新）    | `dotenvx run -- <cmd>` で任意のコマンドに注入。`dotenvx encrypt` で `.env` の値を暗号文にして commit できる。秘密鍵（`DOTENV_PRIVATE_KEY`）は環境に置く       | 暗号化した `.env` を commit する運用は、リポジトリの `.gitignore` 方針（`.env*` を除外）と betterleaks の検査と衝突する。鍵の保管先が別に要る（判断）                    |
| varlock | 1.23.0（2026-10-14 更新）    | `.env.schema` に型、必須、sensitive を書く。`varlock load` で検査、`varlock run -- <cmd>` で注入、`varlock scan` で leak 検査。1Password や AWS などの plugin | `.env.schema` は `.gitignore` の `.env.*` に当たる（否定の規則が要る）。README は「agents read your schema, never your secrets」をうたう。実運用の成熟度は確かめていない |

出典: [dotenv](https://github.com/motdotla/dotenv)（tag v18.0.9）、[dotenvx の README](https://raw.githubusercontent.com/dotenvx/dotenvx/main/README.md)（tag v2.38.2）、[varlock の README](https://raw.githubusercontent.com/dmno-dev/varlock/main/README.md)。版と更新日は `npm view <package> version time.modified`、tag は `git ls-remote --tags` で確認した。

### Nx の task の cache と `.env`

- Nx は、task を実行するとき、`[project-root]/.env.[target].[config].local` から `.env` まで、この順で `.env` 系の file を読む。workspace の root の同名 file も読む。`NX_LOAD_DOT_ENV_FILES=false` で止められる。独自の file（`.qa.env` など）は、`env-cmd`、`dotenvx run`、`run-commands` の `envFile` で読む。出典: [Define Environment Variables](https://nx.dev/docs/guides/tips-n-tricks/define-environment-variables)。
- cache の hash の入力は、file の内容、環境変数の値（`{ "env": "API_KEY" }`）、runtime のコマンド、外部依存など。file の入力（fileset）は `.gitignore` と `.nxignore` が除く file を見ない。ignore 済みの file を入れるには `"includeIgnored": true` を付ける。出典: [Nx: inputs](https://nx.dev/docs/reference/inputs)。
- 結論（出典からの推論、Nx の cache は動かして確かめていない）: `.gitignore` 済みの `.env` の中身を変えても、`test` や `build` の cache は既定では無効にならない。task の結果が環境変数の値で変わるなら、その変数を `{ "env": "NAME" }` で `inputs` に足すか、`.env` を `includeIgnored` の fileset にする。値そのものが hash の入力になるので、秘密を入れるときは、cache の key に秘密が入る点を確かめる必要がある（Nx がどう保存するかは確かめていない）。
- このリポジトリの `apps/api` の統合テストは testcontainers でコンテナを起動する（`apps/api/test/global-setup.ts`）。テストが `.env` の値に依存するかは確かめていない。依存しないなら、今の cache の設計に環境変数の入力は要らない（判断）。
- 変数を `inputs` に宣言しない限り、環境変数の違いは cache に反映されない。これを「cache が環境変数に影響されない」と読むと、`.env` の値の違いで結果が変わる task で、古い cache の結果が返る。

### 比較表（読み方）

| 方式                  | 標準で入っているか   | 重複 key               | 環境の値との優先 | 型・必須の検査           | 暗号化                 | `VITE_` 型の露出の管理 |
| --------------------- | -------------------- | ---------------------- | ---------------- | ------------------------ | ---------------------- | ---------------------- |
| Node.js `--env-file`  | はい（Node.js 24）   | 後が勝つ（実行で確認） | 環境が勝つ       | なし                     | なし                   | なし                   |
| `process.loadEnvFile` | はい                 | 同上                   | 同上             | なし                     | なし                   | なし                   |
| mise `_.file`         | 既に導入済み         | 未確認                 | `[env]` が勝つ   | `required` の有無だけ    | SOPS（JSON/YAML/TOML） | なし                   |
| Vite の `.env`        | はい（Vite 内蔵）    | 未確認                 | 環境が勝つ       | `ImportMetaEnv` の型だけ | なし                   | `VITE_` の接頭辞       |
| Nx の `.env` 読み込み | はい（Nx 内蔵）      | 未確認                 | 未確認           | なし                     | なし                   | なし                   |
| dotenv                | いいえ（依存を足す） | 未確認                 | 既定は環境が勝つ | なし                     | なし                   | なし                   |
| dotenvx               | いいえ               | 未確認                 | 未確認           | なし                     | あり（secp256k1）      | なし                   |
| varlock               | いいえ               | schema で検査          | 未確認           | あり（型、必須、範囲）   | plugin で外部に委ねる  | sensitive の指定       |

## 3. 起動時の検査

### いまの形

`apps/api/src/server.ts` は、`requireEnv(name)` で `process.env[name]` を読み、`undefined` か空文字なら `環境変数 NAME が必要` の例外を出して起動を止める（fail closed）。6 つの変数を 1 つずつ読む。まとめて足りない変数を報告する形ではなく、最初の 1 つで止まる。型の検査（`PUBLIC_ORIGIN` が URL か、`AUTH_SECRET` が十分に長いか）は無い。`PORT` は `Number(process.env.PORT ?? 3000)` で、`abc` を渡すと `NaN` になる。

### schema で検査する形（標準）

実行して確認（zod 4.6.7）。

```ts
const S = z.object({
  PORT: z.coerce.number().int().default(3000),
  AUTH_SECRET: z.string().min(32),
  PUBLIC_ORIGIN: z.url(),
  FLAG: z.stringbool().default(false),
});
S.safeParse({ AUTH_SECRET: "short", PUBLIC_ORIGIN: "x", FLAG: "false" });
```

- `AUTH_SECRET` は `too_small`、`PUBLIC_ORIGIN` は `invalid_format` として、複数の問題を 1 回で返した。`FLAG: "false"` は `z.stringbool()` で `false` になった。
- `z.coerce.boolean().parse("false")` は `true` を返した。環境変数の真偽に `coerce.boolean` を使うと、`"false"` が真になる。
- `z.coerce.number().parse("")` は `0`。空文字の `PORT=` が 0 番ポートになる。`z.string().min(1)` は空文字を拒否する。

選択肢:

| 方式                                          | 内容                                                                             | 版（npm、2026-10-26）            |
| --------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------- |
| 自作の `requireEnv`（今）                     | 追加の依存なし。型の検査なし。最初の欠落で止まる                                 | なし                             |
| zod の schema を入口に 1 つ置く（依存を足す） | `safeParse(process.env)` の結果を、型付きの設定 object にして `createApp` に渡す | zod 4.6.7（2026-10-12 更新）     |
| valibot                                       | zod と同じ役割。bundle が小さい                                                  | valibot 1.5.0（2026-09-09 更新） |
| envalid                                       | 環境変数専用の検査 library                                                       | envalid 9.0.0（2026-10-23 更新） |
| `@t3-oss/env-core`                            | zod などの schema を包む。client と server の変数の分離を型で守る                | 0.13.11（2026-03-22 更新）       |
| varlock の `.env.schema`                      | schema を `.env` の形式で書き、CLI で検査する。型は IntelliSense に出る          | 1.23.0                           |

出典: 各 package の npm の page と `npm view`。zod の挙動は実行して確認した。

標準かどうか: 「起動時に設定を検査して、足りなければ止める」は 12-factor の config の考え方と整合するが、schema library の選択に公式の標準は無い。zod はこのリポジトリの依存にまだ無い（`apps`、`tools`、ルートの `package.json` を検索して確認）。足すかは #216 で決める。今の `requireEnv` は `string | undefined` を空文字も含めて検査する形で、型は `string` を返す。

### Hono の `c.env` と ADR 0007

- Hono は runtime ごとに「環境変数」の入り口が違う。Cloudflare Workers は `wrangler.toml` の bindings が `c.env` に入る。Node.js では `@hono/node-server` の `c.env` に入るのは `{ incoming: IncomingMessage, outgoing: ServerResponse }` だけで、環境変数は入らない。出典: [@hono/node-server の README: Accessing Node.js API](https://raw.githubusercontent.com/honojs/node-server/main/README.md)。
- Hono の `env(c)`（`hono/adapter`）は、runtime を見分けて、Node.js と Bun では `process.env` を返し、Cloudflare Workers では bindings を返し、AWS Lambda では Lambda の環境変数を返す。出典: [Adapter Helper](https://raw.githubusercontent.com/honojs/website/main/docs/helpers/adapter.md)。ADR 0007 の lint は `process` を `apps/api/src` で禁止するが、`hono/adapter` の import 自体は禁止していない（`src` の中で `env(c)` を呼べる。判断）。
- ADR 0007 の文言「環境変数は `c.env` で受け取る」を、Node.js の入口で満たす方法は 3 つある（判断）。(a) `app.fetch(request, env)` を入口が自分で呼び、`c.env` に設定を渡す。`@hono/node-server` の `serve({ fetch })` に包んだ関数を渡す形になる。(b) `hono/adapter` の `env(c)` を使う。(c) 今の `createApp({ auth })` のように、入口で読んだ値を引数（依存）として渡す。(c) は今の実装で、`c.env` を使わない。ADR の `c.env` の文言と実装の食い違いは、#216 で扱う論点にする。
- Lambda Web Functions は、アプリが `AWS_LAMBDA_HTTP_ENDPOINT`（`host:port`）で HTTP サーバーを起動する形で、Lambda が環境変数を入れる。出典: [Web Functions: Environment variables](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-env-vars.html)。入口は `@hono/node-server` のままで、`server.ts` と同じ形になる。つまり (a)(b)(c) のどれも ECS と Lambda で同じコードで使える。Cloudflare Workers に移すときは、入口が `fetch(request, env)` を直接受けるので (a) の形が自然になる。

## 4. `.env` の lint

### dotenv-linter

- 版: v4.0.0（`git ls-remote --tags` で確認。tag は v3.2.0、v3.3.0、v4.0.0）。リポジトリは 2026-02-05 が最後の push で、archive されていない（`gh api` で確認）。release の公開日は GitHub API が EOF で失敗し、確認できなかった。
- 見つけるもの（README の一覧）: Duplicated key、Ending blank line、Extra blank line、Incorrect delimiter、Key without value、Leading character、Lowercase key、Quote character、Schema violation、Space character、Substitution key、Trailing whitespace、Unordered key、Value without quotes。`check`、`fix`、`diff` の 3 つの命令がある。
- 実行して確認（`mise x aqua:dotenv-linter/dotenv-linter@4.0.0`）。次の `.env` と `.env.example` で動かした。

```dotenv
# .env
FOO=1
FOO=2
bar = 3
BAZ=
# .env.example
FOO=
QUX=
```

- `dotenv-linter check .env` は `DuplicatedKey`（`FOO`）、`LowercaseKey`（`bar`）、`SpaceCharacter`（`=` の前後）、`UnorderedKey`（`BAZ`）の 4 件を出した。
- `dotenv-linter diff .env .env.example` は `.env is missing keys: QUX` と `.env.example is missing keys: bar , BAZ` を出した（key の名前だけを出し、値は出さない）。
- 値が秘密かどうかは見ない（README の check の一覧に、値の中身を見るものは無い。秘密の値を入れて動かす確認はしていない）。
- mise では `aqua:dotenv-linter/dotenv-linter` として入る。ADR 0009 と同じ「mise で固定した CLI」の形に載せられる（判断）。

### 重なる道具との分担

| 道具          | 見る対象                      | `.env` に対して                                                                                                                                                 | 実行して確認した内容                                                                                                         |
| ------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| dotenv-linter | `.env` 系の file の書式と key | 書式、重複、`.env.example` との key の過不足                                                                                                                    | 上記                                                                                                                         |
| betterleaks   | 秘密らしい値（rule で検出）   | `git` モード（commit した内容）は ignore 済みの `.env` を見ない。`dir` モードは見る。hook の `staged` は `git --staged`、`all` は `git`（`rules.ts` の `plan`） | `.gitignore` 済みの `.env` に GitHub の token 形式の値を入れた repo で、`git` は `no leaks found`、`dir` は `leaks found: 1` |
| Knip          | 未使用の file、export、依存   | `.env` は対象外のはず（JS/TS の import と `package.json` を見る）。`.env.example` の key が使われているかは見ない                                               | 未実行（判断）                                                                                                               |
| zod の schema | process 起動時の値            | 実際に読んだ値の型と必須                                                                                                                                        | 上記                                                                                                                         |

- 実装の根拠: `tools/scripts/src/checks/secret-scan/rules.ts` の `betterleaks(mode, options)` は `git` と `dir` の 2 つの mode を持つ。手動の `worktree` が `dir`、`staged`、`pre-push`、`range`、`all` が `git` を使う（`rules.ts` の `plan`）。そのため、手動で `worktree` を動かす以外に、作業ツリーの ignore 済みの `.env` を見る経路は無い（`rules.ts` の `scan` 呼び出しを読んだ結果。全経路の確認はしていない）。
- 判断: `.env` の secret を commit 前に防ぐのは `.gitignore` が一次の防御で、`betterleaks dir` は「ignore 済みの file にうっかり実の秘密が入っていないか」を見る補助にはならない（`.env` の実の秘密は、そこに置く前提だから）。`.env.example` には実の秘密を入れず、betterleaks の `git` モードが `.env.example` の値を検査する。

## 5. 本番と検証環境への渡し方

構成は ADR 0013（ECS on Fargate、Lambda Web Functions と Event Functions、CDK）。

| 渡し方                                     | ECS（Fargate）                                                                                                                                                                     | Lambda Web Functions                                                                                                                   | 出典                                                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 非秘密の環境変数                           | task definition の `environment`                                                                                                                                                   | revision の `environmentVariables`。revision ごとに固定、変えるには新しい revision。「秘密は入れない」と書く                           | [Web Functions: Environment variables](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-env-vars.html)      |
| Secrets Manager の値                       | `secrets` の `valueFrom` に ARN。全体か JSON の key を指定。起動時の 1 回の注入で、更新は自動で届かず、新しい task（force new deployment）が要る。task execution role に権限が要る | 実行時に取得する。文書は「Secrets Manager か Parameter Store を使い、実行時に取る」と書く                                              | [ECS: Secrets Manager](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)         |
| Parameter Store の値                       | `secrets` の `valueFrom` に ARN か名前。同じ制約                                                                                                                                   | 同上                                                                                                                                   | [ECS: Parameter Store](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-ssm-paramstore.html)          |
| S3 の `.env` file                          | `environmentFiles`（`.env` 拡張子、UTF-8、1 task definition に 10 個まで）。公式は「秘密は Secrets Manager か Parameter Store に」と勧める。シェルの escape は効かない             | 該当なし                                                                                                                               | [ECS: environment file](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/use-environment-file.html)                  |
| Lambda extension（Parameters and Secrets） | 該当なし                                                                                                                                                                           | 文書は Event Functions 向け（HTTP の localhost 経由、既定の cache は 300 秒、最大 1,000 個）。Web Functions で使えるかは確認していない | [Use Secrets Manager secrets in Lambda Event Functions](https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html) |

- Event Functions の環境変数の合計は 4 KB まで。保存時に暗号化される。文書は「API key などは環境変数でなく Secrets Manager」と勧める。出典: [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)、[Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)。
- ECS の注意: 注入された秘密は、container の process、log、デバッグ用のツールから環境変数として見える（ECS の文書の注意書き）。interface VPC endpoint が Secrets Manager と SSM に要る。ADR 0013 は NAT Gateway と VPC endpoint を足したくなったときに読む対象としているので、この変更は ADR 0013 に触れる（判断）。
- 標準の形（判断、出典は上の表）: 非秘密の設定は環境変数、秘密は Secrets Manager か Parameter Store の SecureString から、ECS は task definition の `secrets` で注入、Lambda は実行時に取る。CDK の `ecs.Secret` で書ける（この文書では CDK の API を確認していない）。
- 検証環境（#99 の調査、`research/verification-env-cd.md`）: 作って消す環境では、秘密を毎回作る（例: ランダムな `AUTH_SECRET` を CDK が生成する Secrets Manager の secret）か、固定の検証用の値を残す stack に置くかを決める必要がある。作って消す stack に入れた Secrets Manager の secret は、削除時に回復の期間が残るかを #99 が未確認としている。
- Secrets Manager は secret ごとに月額、API 呼び出しごとに課金される（[料金のページ](https://aws.amazon.com/secrets-manager/pricing/)。単価は取得できなかった）。Parameter Store の単価は取得できなかった。数字を比べる必要があれば、Price List API で確かめる。

### 避けるアンチパターン

- 秘密を CDK のコードや context に平文で書く。synth した CloudFormation の template に値が出る（判断、Secrets Manager の動的参照を使う）。
- 秘密を Lambda の環境変数に入れる（文書が避けるよう書く）。
- `.env` をコンテナ image に焼き込む（`.dockerignore` の話はこの文書の範囲外）。

## 6. エージェントに `.env` を読ませない、書かせない

[#33](https://github.com/yokozi-jp/agent-software-factory/issues/33)（エージェントの権限の線引き）の本文は、この調査では取れなかった（`gh` が EOF）。ここでは Kiro の仕組みだけを、engine のコードで確かめる。Kiro の仕様は introspect の文書よりインストール済みの engine（`~/.local/share/kiro-cli/kas/2.34.0-.../acp-server.js`）を正とする、という前提に従った。

### 確かめた事実（engine 2.34.0 のコード）

- 権限の規則の形: `{ capability, match?: string[], exclude?: string[], effect: "allow" | "deny" | "ask" | "evaluate" }`。`capability` に使える名前: `all`、`builtin`、`filesystem`、`fs_read`、`fs_write`、`shell`、`web_fetch`、`web_search`、`mcp`、`subagent`、`skill`、`power`、`context`、`diagnostics`、`workflow`、`sandbox_network`。
- 規則の置き場所:
  - user: `~/.kiro/settings/permissions.yaml` か `permissions.json`。
  - workspace: `~/.kiro/workspace-roots/<workspace の id>/permissions.yaml|json`。リポジトリの外（home の下）にあり、commit できない。workspace の規則の pattern は workspace 相対のパスでなければならず、外のパスを指すと規則は捨てられる。
  - custom agent の front matter か JSON の `permissions`（`rules` と `policies`）。`.kiro/agents/` に置けば commit できる（置き場所の確認は engine の schema だけ。このリポジトリには `.kiro/agents/` が無い）。
  - 現在のこのリポジトリの `.kiro/` には `hooks`、`settings`（`cli.json`、`lsp.json`、`mcp.json`）、`skills`、`steering` がある。`.kiro/settings/permissions.*` は無い。
- engine は `.kiroignore` という名前を知っていて、その file への書き込みを保護している。`.kiroignore` が `fs_read` の対象外を決めるかは、コードからは確かめられなかった。
- PreToolUse hook: `.kiro/hooks/pre-tool-use.json` の `matcher` は `shell|execute_bash|@iwe*|fs_write|str_replace|fs_append|delete_file`。読み取りの tool（`read_file`、`grep_search` など）は対象外。`tools/scripts/src/hooks/pre-tool-use/cli.ts` は「読めないものは許可（fail-open）」で、予期しない error は exit 1（拒否ではない）。exit 2 が拒否。

### 選択肢（判断）

| 方式                                                                               | 効く範囲                | 注意                                                                                                                                             |
| ---------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| user か workspace の `permissions.yaml` に `fs_read` と `fs_write` の `deny`       | file の読み書きの tool  | リポジトリに commit できない。clone ごとに作る。`shell` の `cat .env` は別の capability なので、`shell` 側にも規則が要る                         |
| custom agent の `permissions`                                                      | その agent を使ったとき | 既定の agent で作業すると効かない                                                                                                                |
| PreToolUse hook の `matcher` に read 系の tool を足し、`.env` を拒否する（exit 2） | commit でき、全員に効く | ADR 0024（hook は TypeScript）に沿う。shell 経由の読み（`cat`、`grep`）は command の文字列を見る必要がある。fail-open の既存の設計との整合が要る |
| `.env` を持たない運用（varlock の schema をエージェントに見せ、値は渡さない）      | 設計で防ぐ              | varlock の主張で、検証していない。`.gitignore` の `.env.*` に `.env.schema` が当たる                                                             |
| secret を `.env` に置かず、`mise.local.toml` や外部の secret manager に置く        | file が減る             | `mise env` が平文で出す（実行して確認）ので、command 経由の漏れは残る                                                                            |

- どの方式でも、エージェントが `mise env` や `printenv`、`node -e "console.log(process.env)"` を shell で動かせば値は出る。file の read を止めるだけでは足りない（判断）。`shell` の `deny` や `ask` の規則を併用する。
- betterleaks の `dir` モードは、ignore 済みの `.env` の実の秘密を見つけた（上記）。ただしエージェントが値を読んだ後は遅い。

## 比較表（全体）

| 論点                | 現状                                                 | 選択肢 A（標準の部品だけ）                        | 選択肢 B（schema と lint を足す）                 | 選択肢 C（varlock などの統合ツール）                    |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| 置き方              | `.env` 系は ignore、`.env.example` は未作成          | ルートに `.env.example`、アプリごとに必要なら追加 | A に加えて mise の `_.file` で読む                | `.env.schema` を正本にする（`.gitignore` の否定が要る） |
| 読み方（api）       | `process.env` を直接                                 | `node --env-file-if-exists=.env`                  | mise の `_.file` か `--env-file`                  | `varlock run --`                                        |
| 読み方（web）       | 使っていない                                         | Vite の内蔵（`VITE_` だけ露出）                   | 同左                                              | varlock の Vite integration（未検証）                   |
| 起動時の検査        | `requireEnv`（必須だけ、最初の欠落で停止）           | 現状のまま                                        | zod などの schema を入口に 1 つ                   | `.env.schema` と CLI                                    |
| `c.env`（ADR 0007） | 文言と実装が食い違う                                 | 同左                                              | 入口で検査した設定を `c.env` か引数で渡す         | 同左                                                    |
| `.env` の lint      | なし                                                 | なし                                              | dotenv-linter の `check` と `diff`（mise で固定） | varlock の `load` と `scan`                             |
| Nx の cache         | `.env` は hash に入らない                            | 必要な変数だけ `{ "env": ... }` を宣言            | 同左                                              | 同左                                                    |
| 本番の渡し方        | 未実装                                               | ECS は `secrets`、Lambda は実行時に取得           | 同左                                              | varlock の AWS plugin（未検証）                         |
| エージェントの制限  | hook は書き込みと shell だけ。権限の規則は commit 外 | user の `permissions.yaml` に deny                | A に加えて PreToolUse hook に read を足す         | schema だけを見せる運用                                 |
| 追加の依存          | なし                                                 | なし                                              | zod（dotenv-linter は mise）                      | varlock                                                 |

## #216 で決める論点

1. `.env` を、ルートに 1 つ置くか、アプリごと（`apps/api`、`apps/web`）に置くか。Vite の `envDir` と Nx の読み込みの規則は、どちらでも動く。
2. `.env` を誰が読み込むか。Node.js の `--env-file-if-exists`、mise の `_.file`、Nx の組み込み、のどれを正にするか。複数が同時に読むと優先順位が重なる（Nx は task に自動で入れる）。`NX_LOAD_DOT_ENV_FILES` を止めるか。
3. `.env.example` と schema（zod など）の、どちらを必須変数の正本にするか。両方を持つなら、ずれを何で検査するか（`dotenv-linter diff` か、テストか）。
4. 起動時の検査を zod などの schema にするか、今の `requireEnv` のままにするか。zod は今の依存に無い。真偽と数値の変換の規則（`coerce.boolean` を使わない）。
5. ADR 0007 の `c.env` の文言をどう扱うか。実装（入口で読み、`createApp` に引数で渡す）に合わせて ADR を直すか、`c.env` に渡す形に実装を寄せるか。
6. dotenv-linter を足すか。足すなら、対象（`.env.example` だけか、ignore 済みの `.env` も見るか）と、ADR 0009 に沿った mise での固定、hook と CI のどこで動かすか。ADR が要るか。
7. dotenvx と varlock を採用するか。採用しない場合、`.gitignore` の方針と衝突するもの（暗号化した `.env` の commit、`.env.schema`）を明示的に外すか。
8. `apps/web` が使う値を `VITE_` で渡すか、同じ origin の相対パスにするか。`VITE_` に秘密を入れない規則を lint で止めるか（ADR 0019 の自作 plugin の対象にするか）。
9. Nx の cache に環境変数の値を入れる変数があるか。ある場合、`inputs` に `{ "env": ... }` を宣言し、秘密が cache key に入らないようにする。
10. 本番と検証環境で、秘密を Secrets Manager と Parameter Store のどちらに置くか。ECS は task definition の `secrets`、Lambda Web Functions は実行時取得にするか。コード側に取得の層を置くか。VPC endpoint の追加は ADR 0013 に触れる。
11. 作って消す検証環境の秘密を、毎回生成するか、残す stack に固定で置くか（#99 との関係）。
12. エージェントの制限を、user 側の `permissions.yaml`（commit できない）、custom agent、hook のどれで実装するか。read 系の tool を hook の `matcher` に足すか。shell 経由（`cat .env`、`mise env`、`printenv`）を同時に防ぐ規則を書くか。
13. mise の `[env]` を足す場合、`mise.toml` の先頭のコメント（`[tools]` だけ）と repo-policy の検査を直すか。`mise env` の平文出力を許容するか。

## 確かめられなかった点

- Nx の cache が `.env` の変更で無効にならないこと（文書からの推論で、実機で動かしていない）。
- dotenv の重複 key と優先順位の細部（Node.js との差）。Vite の dotenv-expand の挙動（文書の記述だけ）。
- dotenv-linter 4.0.0 の公開日と、v3 からの変更点（GitHub API が EOF で取得できなかった）。
- `.kiroignore` が `fs_read` を制限するか。workspace の権限の規則の `<id>` の決まり方（home の下の id で、リポジトリの path から作る。生成の方法は読んでいない）。
- Lambda Web Functions で Parameters and Secrets の extension が使えるか。
- Secrets Manager と Parameter Store の現在の単価（Price List を引いていない）。
- varlock と dotenvx の実運用での成熟度。varlock の Vite integration、AWS plugin の動作。
- Knip が `.env` を扱わないこと（未実行）。
- Issue #33 の本文（エージェントの権限の表）。取得に失敗した。

## 出典

- 12-factor: [III. Config](https://12factor.net/config)
- Node.js: [CLI（`--env-file`、`--env-file-if-exists`）](https://nodejs.org/docs/latest-v24.x/api/cli.html)、[process.loadEnvFile](https://nodejs.org/docs/latest-v24.x/api/process.html#processloadenvfilepath)
- Vite: [Env Variables and Modes](https://raw.githubusercontent.com/vitejs/vite/main/docs/guide/env-and-mode.md)、[Shared Options（envDir、envPrefix）](https://raw.githubusercontent.com/vitejs/vite/main/docs/config/shared-options.md)
- Nx: [Define Environment Variables](https://nx.dev/docs/guides/tips-n-tricks/define-environment-variables)、[Inputs](https://nx.dev/docs/reference/inputs)
- mise: [Environments](https://raw.githubusercontent.com/jdx/mise/main/docs/environments/index.md)
- dotenv、dotenvx、varlock: [dotenv](https://github.com/motdotla/dotenv)、[dotenvx の README](https://raw.githubusercontent.com/dotenvx/dotenvx/main/README.md)、[varlock の README](https://raw.githubusercontent.com/dmno-dev/varlock/main/README.md)
- lint と scan: [dotenv-linter の README](https://raw.githubusercontent.com/dotenv-linter/dotenv-linter/master/README.md)、[betterleaks の README](https://raw.githubusercontent.com/betterleaks/betterleaks/main/README.md)
- Hono: [@hono/node-server の README](https://raw.githubusercontent.com/honojs/node-server/main/README.md)、[Adapter Helper](https://raw.githubusercontent.com/honojs/website/main/docs/helpers/adapter.md)
- AWS: [ECS: Secrets Manager](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)、[ECS: Parameter Store](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-ssm-paramstore.html)、[ECS: environment file](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/use-environment-file.html)、[Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)、[Web Functions: Environment variables](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-env-vars.html)、[Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)、[Secrets Manager in Lambda Event Functions](https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html)、[Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/)
- Kiro: インストール済みの engine（`~/.local/share/kiro-cli/kas/2.34.0-ebe18effa96beb10df3ebf937d9f21d9af258b320653258e0c0848acdc7b2fda/node_modules/@kiro/agent/dist/server/acp-server.js`）のコード。公開文書の URL は確認していない。
- このリポジトリ: `apps/api/src/server.ts`、`vite.config.ts`、`nx.json`、`mise.toml`、`.gitignore`、`.kiro/hooks/pre-tool-use.json`、`tools/scripts/src/hooks/pre-tool-use/cli.ts`、`tools/scripts/src/checks/secret-scan/rules.ts`、`docs/tooling/secret-scan.md`、ADR 0003、0007、0009、0013、0019、0020、0022、0024
- 同じ形式の調査: `research/verification-env-cd.md`（ブランチ `research/verification-env-cd`）
