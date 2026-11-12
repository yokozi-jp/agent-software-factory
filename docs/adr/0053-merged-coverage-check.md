---
type: ADR
title: "ADR 0053: 各 project の coverage の記録を CI で 1 つに合わせ、apps と packages のファイルごとの下限を検査する"
description: project ごとの coverage は自分の src だけを数えるので、他の project のテストが通すコード (shared-kernel の DB の関数、モジュールの infrastructure) に下限がなかった。各 project が他の project のファイルも記録し、CI が記録を合わせてファイルごとに 90% を検査する決定。対象の決め方、例外の表、project ごとの下限との関係、採らなかった案を書く。coverage の対象や下限を変えるとき、テストの置き場を決めるとき、coverage-policy.json に行を足すときに読む。
tags: [adr, ci, coverage, testing, nx, vitest]
---

# ADR 0053: 各 project の coverage の記録を CI で 1 つに合わせ、apps と packages のファイルごとの下限を検査する

状態: 決定 ([Issue #567](https://github.com/yokozi-jp/agent-software-factory/issues/567))。

## 背景

Nx は project ごとに `test` を流す ([ADR 0002](0002-nx-orchestrates-vite-plus.md))。Vitest の coverage は、その project の `src` だけを数える。DB の結合テストを apps に置く規約 ([ADR 0038](0038-db-package.md)) の下では、shared-kernel の `tenant-db`、`idempotency-db`、`messaging` を `apps/api/src/db/*.test.ts` が、`approval` の infrastructure を worker のテストが確かめるが、呼ぶ側の coverage には入らない。shared-kernel とモジュールには coverage の下限がなかった。

## 決定

- 各 project の `test` は、`coverage.allowExternal: true` と、自分の `src` に加えて `**/{apps,packages}/*/{,events/}src/**/*.{ts,tsx}` を `include` に書く。テストが読み込んだ他の project のファイルも、その project の `coverage/coverage-final.json` に入る。ディレクトリや package が増えても、`include` を手で足さない。
- coverage を出していなかった project (モジュール、`shared-kernel`、`i18n`、events の package、`ui`) も記録を出す。テストのない project は 0% の記録を出す (`passWithNoTests`)。
- CI の `nx` の job が、`nx affected -t check test build` の後に `node tools/scripts/src/checks/merged-coverage/cli.ts` を流し、記録を合わせて、`apps/*/src`、`packages/*/src`、`packages/*/events/src` の `.ts` と `.tsx` のファイルごとに lines と branches が 90% あることを確かめる。テスト、`__fixtures__`、`*.gen.ts`、`*.d.ts`、story は数えない。記録を出した (affected な) project のファイルだけが対象で、shared-kernel を変えると api と worker も affected になる。
- 外すファイルは、ルートの `coverage-policy.json` の `exceptions` に、パスと理由で書く。外すものだけを書くので、新しいファイルは黙って漏れない。どの記録にもないファイルは、例外にないと止まる。存在しない、測らない、または下限を超えたファイルの行も止まる。
- 各 project の下限 (api の全体 100% と `autoUpdate`、`perFile`) は残す。`thresholds["src/**"]` に移し、自分の `src` だけに掛ける。他の project のファイルが全体の値を下げない。
- pre-push にも pre-commit にも入れない。全 project の `test` を流した後でないと確かめられない。

## 採らなかった案

- 呼ぶ側の `coverage.include` に、他の project のディレクトリを手で足す案: ディレクトリや package が増えるたびに漏れる。
- Vitest の projects の形に変え、root の 1 回の実行で coverage を 1 つにまとめる案 ([Vitest の Test Projects](https://vitest.dev/guide/projects))。Nx が project ごとに流す形 ([ADR 0002](0002-nx-orchestrates-vite-plus.md)) と、`affected` と cache による再生を捨てることになる。
- 記録を合わせる道具 (`nyc merge`、`istanbul-lib-coverage`) を足す案: 依存が増える。必要なのは、文と分岐の位置を鍵にした足し算と、行と分岐の割合だけで、`rules.ts` の数十行で足りる。

## 結果と残る論点

- 入口のファイル (`server.ts` など) は、project ごとの `vite.config.ts` の `coverage.exclude` と `coverage-policy.json` の両方に書く。前者は project ごとの下限が 0% を数えないため、後者は合わせた検査のため。
- 初めて検査したとき、下限を割っていたファイルは、理由つきの例外の行にした (`packages/ui` の shadcn の部品 4 つ、`notification-mail.ts`、`db-call.ts`)。テストを足して行を消す。
- project 単位の取りこぼし (テストの target も記録もない package) は、この検査では見つからない。記録を出した project だけが対象だからである。
- 記録を書く project の `test` が affected でない変更 (docs だけ、`tools/scripts` だけの変更) は、記録が 1 件もできない。このときは `nx show projects --affected --with-target test` の答えのうち `apps/*`、`packages/*`、`packages/*/events` の project が 0 件であることを確かめて、検査せずに通す (docs だけの commit で CI が止まったため)。`--projects` を同じ問い合わせに付けると Nx 24 は `--affected` を無視するので、絞り込みは別の問い合わせとの突き合わせで行う (ツールの版だけを上げる Renovate の PR と main への push で CI が止まったため)。nx が答えられないときと、affected なのに記録がないときは、従来どおり検査できなかったとして止める。
- 検査の対象は、記録の有無ではなく affected の答えで決める ([Issue #579](https://github.com/yokozi-jp/agent-software-factory/issues/579))。affected でない project の `coverage/` に古い記録が残っていても (`nx run-many -t test` の後など) 読まず、名前を出力する。nx が答えられないときは、記録があっても終了コード 2 で止まる。記録の新旧を更新時刻で決める案は採らなかった。checkout や cache の再生で更新時刻がソースの新旧と合わず、Nx が使う入力のハッシュとも別の基準になるため。検査が `coverage/` を消す案は、利用者のファイルを黙って消すので採らなかった。affected な project の記録がソースより古い場合は見つけられない。CI の checkout では起きず、局所では先に `nx affected -t test` を流す。
- `vitest-coverage.ts` の設定が、他の project のテストが通したファイルを記録に入れることは、`vitest-coverage.tools.test.ts` が本物の Vitest で確かめる。`coverage-policy.json` に「この project の記録にはこのファイルが入る」と書く案は採らなかった。ファイルを改名するたびに壊れる、手で写した 2 つ目の一覧になるため。
- affected な project のうち一部だけが記録を書いていないとき (ほかの project に記録があるとき) は、この検査では見つけない。記録が 1 件もないときだけ、終了コード 2 で止まる。
