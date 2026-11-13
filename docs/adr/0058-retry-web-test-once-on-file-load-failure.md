---
type: ADR
title: "ADR 0058: web:test がテストファイルを読み込めずに落ちたときだけ、CI で失敗した task を 1 回再実行する"
description: "web:test が CI で不安定に落ちる問題 (Issue #523) に対し、原因が分からないまま、テストの失敗と区別できる 2 つのエラー (iframe が用意できない、動的 import が読めない) で web:test だけが落ちたときに限り、同じ nx のコマンドを 1 回再実行し、再実行を警告の annotation に残す決定。再実行の条件、Nx の cache との関係、採らなかった案 (Vitest の retry、無条件の再実行、別の job、第三者の Action)、flaky の数え方、原因を絞る診断の記録と外す条件を書く。web:test が CI で落ちたとき、CI の再実行の仕組みを変えたいとき、Issue #523 を閉じるか決めるときに読む。"
tags: [adr, ci, testing, vitest, nx, flaky]
---

# ADR 0058: web:test がテストファイルを読み込めずに落ちたときだけ、CI で失敗した task を 1 回再実行する

状態: 決定 ([Issue #523](https://github.com/yokozi-jp/agent-software-factory/issues/523))。

## 背景

`web:test` (Vitest の browser mode の `unit` と `storybook`) は、CI でテストファイルを読み込めずに落ちることがあります。エラーは `The iframe ... did not become ready within 60000ms` か `Failed to fetch dynamically imported module` です。テストは 1 件も失敗しません。読み込めなかったファイルのテストが走らず、coverage の下限が割れて `web:test` が失敗します。

2026-11-11 から 11-12 の間に 6 回落ちました。どれも、`api:test` か `worker:test` (Testcontainers) の完了の前後 5〜13 秒に、`web:test` の読み込みが重なっています。最初の 4 回は、`web:test` の開始の 7〜13 秒後にそれらが終わりました。`web:test` を他の task と同時に流さない手当て (`parallelism: false`、PR #699) の後にも、2 回落ちました。この 2 回は、`web:test` がそれらの完了の 5 秒後と 8 秒後に始まっています。後者は 11-12 17:12 UTC の run [43266400536](https://github.com/yokozi-jp/agent-software-factory/actions/runs/43266400536) で、`pnpm-lock.yaml` だけを変えた Renovate の PR #752 が止まりました。原因は分かっていません。調べた記録は [CI](../tooling/ci.md) の「web:test が不安定に落ちるとき」にあります。

必須チェックの `main` が落ちると、PR は merge できません。Renovate の auto-merge は CI が通った PR だけを merge する ([ADR 0055](0055-renovate-automerge-by-ci.md)) ので、人が再実行するまで止まります。web のコードに触れない PR も止まります。

## 決定

- `nx` の job の `Check, test and build (nx affected)` の step は、`nx affected -t check test build` を `tools/scripts/src/checks/retry-web-test/cli.ts` 越しに実行する。この CLI は、コマンドの出力をそのまま流し、失敗したときだけ出力を読む。
- 次の 2 つがそろったときだけ、同じコマンドを 1 回再実行する。
  1. Nx が `Failed tasks:` に挙げた task が `web:test` だけである。
  2. 出力に `The iframe "…" did not become ready within …ms` か `Failed to fetch dynamically imported module` がある。
- 再実行は 1 回だけ。2 回目が失敗したら、その終了コードで失敗する。コマンドが成功した、条件に合わない、のどれかのときは再実行しない。
- Nx は成功した task を local cache から返す。再実行で動くのは失敗した `web:test` と、それに依存する task だけである。失敗した task は、既定では cache に入らない ([Nx の環境変数](https://nx.dev/docs/reference/environment-variables) の `NX_CACHE_FAILURES`。`true` にすると、成功に加えて失敗した task も cache に入る)。`test` の `outputs` に `coverage/coverage-final.json` があるので、cache から返した task の coverage の記録も戻り、続く merged-coverage の検査はそのまま動く。2026-11-13 に手元で、`nx run-many -t test` を 2 回流して 2 回目が `[local cache]` になること、記録を消してから流して `coverage-final.json` が戻ることを確かめた。
- 再実行したときは、`::warning title=web-test-flaky::` の annotation を残す。
- 同じ step が、`nx` の実行の間、`docker events` と `ip monitor address link` を記録し、実行の後に折りたたんだ group で出力する。`web:test` の開始の前後に、コンテナの片付けとネットワークの変化が重なっているかを、次の失敗のログから読むため。原因が分かったら外す。

## 採らなかった案

- **Vitest の `retry`**: 個々のテストを再実行する設定である ([Vitest の retry](https://vitest.dev/config/retry))。ファイルの読み込みの失敗は対象にならない (vitest 5.1.0、2026-11-12 に確かめた。[CI](../tooling/ci.md))。
- **失敗を条件なしに再実行する、`continue-on-error` で通す**: 本物の失敗を隠す。再実行の条件を、テストの失敗と区別できるエラーに絞った。E2E の retry を 1 回までにして、flaky を見える状態にする [ADR 0039](0039-e2e-playwright-gate-and-ai-for-authoring.md) と同じ考え方である。
- **第三者の再実行の Action (`nick-fields/retry` など)**: 条件 (失敗した task が `web:test` だけ) を出力から読めず、Action の依存も増える。Action の更新は人が merge する ([ADR 0055](0055-renovate-automerge-by-ci.md)) ので、手間も増える (判断)。
- **`web:test` を別の job に分ける**: Testcontainers の task と runner を共有しなくなる。ただし merged-coverage は、同じ job の各 project の記録を合わせる ([ADR 0053](0053-merged-coverage-check.md)) ので、記録の受け渡しが要る。変更が大きい割に、原因が Testcontainers の片付けかは確かめていない (判断)。
- **`VITEST_BROWSER_IFRAME_TIMEOUT` を短くする**: 失敗の確定を早めるだけで、失敗を防がない。再実行と組み合わせるなら、再実行の費用 (60 秒の待ち) が減る。今回は入れない (判断)。
- **`web:test` を必須チェックから外す**: Issue #523 で採らないと決めている。

## 影響

- 再実行はフレークをなくさない。数えて見えるようにする。再実行した run は、ログに `web:test failed to load a test file` の行を持つ。数え方は [CI](../tooling/ci.md) の「web:test が不安定に落ちるとき」にある。
- Issue #523 を閉じる条件は、「`web:test` の読み込みの失敗が出ない」から、「再実行の警告が、main の CI で 2 週間か 30 run のどちらか長いほうの間、出ない」に読み替える。再実行で通った run も失敗に数える。
- 失敗した run は、`web:test` の約 1 分と iframe の待ち 60 秒の分だけ長くなる。
- 診断の記録は、`nx` の step のログに折りたたんだ group を足す。通る run でも出る。
- `docker events` と `ip monitor` は、runner のホストで動く。`ip monitor` が見るのはホストのネットワークで、Docker の bridge の変化が出るかは CI で確かめる (手元では、Docker のデーモンが別のネットワーク名前空間にあり、確かめられなかった)。
