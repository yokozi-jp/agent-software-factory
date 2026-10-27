---
type: ADR
title: "ADR 0026: モジュールは packages/ の Nx project にし、方向と層は Oxlint の no-restricted-imports で止める"
description: サンプル機能のモジュール (申請、承認、締め) と共有コード (shared) を packages/ の Nx project にし、package.json の exports で公開 API を index.ts だけにし、モジュールの間の依存の方向、package 名での import、モジュールの中の層の方向を、ルートの vite.config.ts の no-restricted-imports で止める決定。規則ごとの fixture と repo-policy で検出力と書き忘れを確かめる。モジュールや層を足すとき、モジュールの境界の lint で止まったとき、`packages/` に project を足すとき、Nx の enforce-module-boundaries や dependency-cruiser を使いたくなったとき、lint の fixture を足すときに読む。
tags: [adr, architecture, modules, nx, oxlint, lint]
---

# ADR 0026: モジュールは packages/ の Nx project にし、方向と層は Oxlint の no-restricted-imports で止める

サンプル機能 (経費精算) はモジュラーモノリスにし、機能ごとのモジュールに分けます。エージェントが逆向きの import や深い import を書いても、`vp check` (pre-commit と CI) で止まるようにします。道具と配置は [モジュール境界と禁止 API の検査の道具を決める](https://github.com/yokozi-jp/agent-software-factory/issues/145) の解決コメントで決め、[Issue #179](https://github.com/yokozi-jp/agent-software-factory/issues/179) で入れました。

## ルール

- **配置**: モジュールは `packages/` の直下に、1つずつ Nx project (pnpm workspace の package) として置きます。申請は `packages/claim`、承認は `packages/approval`、締めは `packages/closing`、モジュールが共有するコードは `packages/shared` です。`apps/api` は入口のファイルと、モジュールの route を組み立てる `app.ts` だけを持つ薄い入口にし、モジュールを `workspace:*` の依存として持ちます。
- **公開 API**: 各 package の `package.json` の `exports` は `"."` (`src/index.ts`) だけです。`@agent-software-factory/claim/src/...` のような深い import は解決できません。
- **モジュールの間の方向**: 依存は「締め → 承認 → 申請」の一方向です。申請は承認と締めを、承認は締めを import しません。`shared` はどのモジュールも import しません。`apps/api` はどのモジュールの `index.ts` も import できます。
- **層**: 各モジュールの `src/` を `domain`、`application`、`infrastructure`、`http` に分けます。`domain` は何も import しません (`shared` の型の `import type` だけを許します)。`application` は `domain` だけを、`infrastructure` と `http` は `application` と `domain` を import し、互いには import しません。モジュールの外から `infrastructure` と `http` の中は、公開 API の規則で import できません。
- **`domain` の書き方の規則**: `domain` の中身の書き方 (純粋な関数、判別可能な union、自作の `Result`) は [ADR 0027](0027-domain-model-as-pure-functions-and-unions.md) で、Effect を使う層 (`application` と `infrastructure` だけ) は [ADR 0028](0028-effect-in-application-and-infrastructure.md) で決めました。`domain` の override には、import の規則に加えて、`Date` の値と `Math.random` を止める `no-restricted-globals` と `no-restricted-properties`、`throw` を止める自作の規則を足します。`application` と `infrastructure` の override には、Effect の実行の関数を止める `no-restricted-properties` を足します。実装は [Issue #259](https://github.com/yokozi-jp/agent-software-factory/issues/259) と [Issue #260](https://github.com/yokozi-jp/agent-software-factory/issues/260) です。どちらも、下の「override の組み立て」のとおり、各 override が持つ制限に足します。
- **規則**: ルートの `vite.config.ts` の `modules` (モジュールと、import してよいモジュール) と `layers` (層と、import してよい層) から、`lint.overrides` の `no-restricted-imports` を組み立てます。止めるものは次のとおりで、どのメッセージにも直し方とこの ADR のパスを書きます。
  - 許していないモジュールの package 名 (`paths`)。
  - package 名の後に続く subpath と、`<package>/src` に入る相対パス (`patterns` の `regex`)。`packages/` と `apps/api/src` のすべてのファイルにかけます。
  - `domain` では、`shared` の値の import、`.` で始まらない import (ライブラリと Node.js の組み込み)、`shared` 以外の scope 付きの package。
  - 許していない層への相対パス (`../application/...` など)。
- **override の組み立て**: Oxlint は1つのファイルに同じ規則を設定する override が複数あると、最後のものだけを使います。そのため、各 override (モジュールの `src/**` と、各層の `src/<layer>/**`) が、そのファイルにかかる制限を全部持ちます。`apps/api/src/**` の override も、[ADR 0007](0007-api-on-node-web-standard-app.md) のランタイムの制限と、深い import の制限を両方持ちます。入口のファイルとテストの override は、ランタイムの制限を外し、深い import の制限だけを残します。
- **`domain` の pattern の順序**: Oxlint 1.89.0 は `patterns` を順に調べ、否定 (`!`) を含む `group` が一致すると、その import の検査をやめます。そのため、`shared` の値の import を止める pattern を、`["@*/*", "!@agent-software-factory/shared"]` の `group` より前に置きます。順序を逆にすると、`shared` の値の import が止まりません (2026-10-26 に確かめました)。Oxlint の `regex` は先読み (`(?!...)`) を使えないので、否定の `group` で書いています。
- **検出力 ([Issue #43](https://github.com/yokozi-jp/agent-software-factory/issues/43))**: override ごとに、その override の `files` が届く場所に fixture を1つ置きます。置き場所は `<dir>/__fixtures__/boundaries.ts` です (`<dir>` は `packages/<package>/src`、`packages/<module>/src/<layer>`、`apps/api/src`)。違反の行に `oxlint-disable-next-line no-restricted-imports -- 理由` を付けるので、規則が外れたり、`files` が届かなくなったりすると、使われない disable のコメントで `vp check` が失敗します。入口のファイルとテストの override の fixture は、テストの glob に一致するように `apps/api/src/__fixtures__/boundaries.test.ts` にします。
  - 解決できない import (依存にない package、`exports` にない subpath) は、disable のコメントの上に `@ts-expect-error -- 理由` を書きます。TypeScript は、エラーの行から上に向かって `//` のコメントの行を飛ばして指示を探すので、2つのコメントを重ねられます。
  - `__fixtures__/` は、jscpd (`.jscpd.json` の `ignore`)、Knip (`knip.jsonc` の `ignoreFiles`)、Nx の `production` の入力 (`nx.json`)、`apps/api` の Vitest (`exclude`) の対象から外します。`index.ts` から import しないので、build の成果物にも入りません。
- **書き忘れ**: repo-policy (`tools/scripts/src/checks/repo-policy/rules.ts`) が、`packages/` の `shared` 以外の package が `vite.config.ts` の `modules` にあること、各 package の `src/` と各モジュールの各層の `__fixtures__/` に `oxlint-disable-next-line no-restricted-imports` のある fixture があることを確かめます。
- **Nx の graph は package.json から作る**: `nx.json` の `pluginsConfig["@nx/js"].analyzeSourceFiles` を `false` にします。fixture は依存にない package を意図して import します。Nx 24.0.0 は、package.json から解決できない import を TypeScript の JS API (`readConfigFile` など) で解決しようとします。TypeScript 7.0.2 の `typescript` package はその API を持たない (export は `version` と `versionMajorMinor` だけ) ので、graph の作成が `tsModule.readConfigFile is not a function` で失敗しました。モジュールが import できるのは `package.json` に書いた package だけなので、graph の辺も `package.json` の依存と一致します。pnpm の workspace で `workspace:*` を書くリポジトリでは、ソースの解析を切るのは Nx が案内している設定です ([Disable Graph Links Created from Analyzing Source Files](https://nx.dev/docs/guides/tips-n-tricks/analyze-source-files))。

## Nx の標準との違い

- Nx の [Folder Structure](https://nx.dev/docs/kb/folder-structure) は、どちらも必須ではない慣習として、2つの配置を挙げています。すべての project を1つのフォルダ (ふつうは `packages/`) の直下に置く flat な配置は、package manager の workspace の既定の形です。`apps/` と `libs/` に分ける grouped な配置では、アプリを入口と設定と機能の組み立てだけにし、機能を library に置くことを勧めています。ここでは、`pnpm-workspace.yaml` がすでに `packages/*` を持つので flat な配置にし、アプリを薄くする考え方は grouped な配置の節から取りました。数十の project を超えたら、grouped な配置を考えます。
- Nx はさらに、library を種類 (`feature`、`ui`、`data-access`、`util`) ごとに別の project に分け、種類と scope の tag で依存を縛ることを勧めています。ここでは、1つのモジュールを1つの project にし、層は project の中のディレクトリにしました。[Project Size](https://nx.dev/docs/kb/project-size) の「いつも一緒に変わるものは分けない」に当たり、1つの業務の変更はふつう全部の層に及ぶからです (判断)。層を project に分けると、3つのモジュールで12の project になります。
- 避けるアンチパターンは、大きな1つの project に全部を入れ、`nx affected` と `nx graph` を効かなくすることです。

## Considered Options

- **Nx の `@nx/enforce-module-boundaries` と tag**: Nx の標準の方法です。Oxlint 版 (`@nx/oxlint`) は Experimental で、Oxlint の JS plugin の API に依存します ([Nx with Oxlint](https://nx.dev/docs/technologies/oxlint/introduction))。Nx に lint を任せない [ADR 0002](0002-nx-orchestrates-vite-plus.md) との整合も確かめていません。tag は project の単位の規則なので、project の中のディレクトリである層の方向は書けません。
- **dependency-cruiser**: import を解決したうえで判定できます。再 export 経由の抜け道のように、文字列の照合では見逃す違反が実際に出たら足します。足すときは mise で版を固定します ([ADR 0009](0009-mise-for-pinned-cli-tools.md))。
- **ast-grep**: 規則を自由に書けますが、`no-restricted-imports` で書けることのために道具と規則の言語が1つ増えます。
- **`apps/api` の中のディレクトリに分ける**: 最初の案です。Nx の標準から外れ、ワーカーやバッチの入口 ([ADR 0013](0013-api-on-ecs-and-lambda-web-functions.md)) が同じモジュールを使えず、`exports` で深い import を解決できなくすることもできません。

## Consequences

- モジュールを足すときは、`packages/<name>/` (`package.json` の `exports` と `nx.name`、`tsconfig.json`、`src/index.ts`)、`vite.config.ts` の `modules`、`src/` と各層の fixture を足します。どれかを忘れると repo-policy が止めます。層を足すときは `layers` と、各モジュールの fixture を足します。
- 判定は import の文字列の照合だけです。解決した先は見ないので、許されたモジュールを経由した再 export、文字列を組み立てた動的な `import()`、`require` は見逃します。層の規則は、相対パスの `../` の並びの直後の名前だけを見ます。`domain/sub/x.ts` から `../../infrastructure/...` は止まりますが、層のファイルからモジュールの `src/index.ts` への import (`domain/x.ts` の `../index.ts`) は止まりません。`domain/sub/x.ts` の `../index.ts` (`domain/index.ts`) と文字列で見分けられないためです。`index.ts` が層を再 export すると、そこから層の方向を飛び越えられます。層の中に層と同じ名前のディレクトリ (`domain/http/` など) を作ると、そこへの `../http` も止まります。
- 他のモジュールの表を直接読み書きしないこと (DB の表の所有) は、import の検査では見つけられません。サンプル機能の仕様で決めます。
- `packages/*/src` のランタイムの制限 ([ADR 0007](0007-api-on-node-web-standard-app.md)、[Issue #178](https://github.com/yokozi-jp/agent-software-factory/issues/178)) のうち、import の制限は別の override ではなく、`vite.config.ts` の `moduleImports` と `shared` の override に足しました。別の override にすると、最後の override だけが使われ、どちらかの制限が消えます。グローバルの制限は `no-restricted-imports` と別の規則なので、ADR 0007 の override が `packages/*/src/**` にも届きます。
- 保証カタログには、「モジュール境界」(方向、package 名での import、層) と「禁止 API」([ADR 0007](0007-api-on-node-web-standard-app.md)) の2行を足します。ゲートはどちらも `vp check` です。カタログはまだなく、作る Issue ([保証カタログを置き、カタログと設定のずれを repo-policy で検出する](https://github.com/yokozi-jp/agent-software-factory/issues/139)) の Implementation Decisions に、作るべき行として2行を足しました。

## 出典

- Oxlint の `no-restricted-imports` の `paths`、`patterns` (`group`、`regex`、`allowTypeImports`) と、override の扱い、pattern の順序: Oxlint 1.89.0 (Vite+ 1.4.0) で確かめた (2026-10-26)
- Nx 24.0.0 の `pluginsConfig["@nx/js"]` の既定値: `nx/dist/src/plugins/js/utils/config.js`。graph の作成の失敗と、TypeScript 7.0.2 の `typescript` package の export: このリポジトリで確かめた (2026-10-26)
