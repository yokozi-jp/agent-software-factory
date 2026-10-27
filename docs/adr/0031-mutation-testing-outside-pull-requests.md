---
type: ADR
title: "ADR 0031: mutation test は PR の CI から外し、週に1回の workflow で実行する"
description: tools/scripts の Stryker (mutation target) を、PR の nx の job の nx affected から外し、mutation.yml の週に1回の schedule と手動の実行にする決定。break の 100 は変えず、保証には数えない。比べた案は PR のゲートのまま cache を足す案、変更したファイルだけを PR で変異させる案、main への push ごとに実行する案。mutation の実行時間が重いとき、Stryker の設定や target を変えるとき、mutation を merge のゲートに戻したくなったときに読む。
tags: [adr, ci, testing, mutation, stryker]
---

# ADR 0031: mutation test は PR の CI から外し、週に1回の workflow で実行する

`tools/scripts` の `mutation` target (Stryker) を、PR の CI (`ci.yml` の `nx affected -t check test build mutation`) から外します。`mutation.yml` が毎週月曜と手動で実行します。`break` の 100 (生き残った mutant が 1 つでもあれば失敗) は変えません。

## 背景

[ADR 0024](0024-scripts-and-hooks-in-typescript.md) の導入時、`mutation` は約 50 秒で、`tools/scripts` を変えた PR で毎回すべての mutant を回しました。そのとき「遅くなったら cache を置くかを決める」としていました。

2026-10-28 に `repo-policy/rules.ts` だけを変異させると、893 個の mutant で初回が 13〜19 分かかりました (他のセッションが動いていて load average が 20 前後)。同じファイルでテストを 1 つ足した後の incremental は約 1 分でした。コードが増えると、さらに長くなります。CI の `nx` の job は `timeout-minutes: 20` で、`check test build` と同じ job の中で動いていました。

## ルール

- **実行**: `mutation.yml` が毎週月曜の 03:00 UTC と `workflow_dispatch` で `pnpm exec nx mutation scripts` を実行します。必須チェックにせず、`ci.yml` の `main` の `needs` にも入れません。
- **手元**: `rules.ts` を変えた人 (エージェント) は、push の前にそのファイルだけを変異させます ([CI](../tooling/ci.md))。手順は変えません。
- **保証**: merge のゲートでなくなるので、[保証カタログ](../tooling/assurance-catalog.md) の保証には数えません。週に1回の実行が失敗したら、生き残った mutant を殺すテストを足す Issue にします。

## Considered Options

- **PR のゲートのまま、incremental の結果を CI の cache に置く**: 2 回目以降は速くなります。ただし最初の実行と、cache が消えた後の実行は重いままで、PR を待たせます。cache の復元が検証されない問題 ([ADR 0009](0009-mise-for-pinned-cli-tools.md) と同じ考え方) も増えます。
- **PR では変更したファイルだけを変異させる**: PR の時間は短くなります。ただし `--mutate` のファイルを CI で求める仕組みが要り、変更していないファイルのテストが弱くなっても検出が遅れます。
- **main への push ごとに実行する**: 検出は速くなります。ただし `tools/scripts` を変える merge のたびに重い job が走り、問題の先送りになります。

## Consequences

- mutation の退行 (テストの弱まり) は、最大で 1 週間後に分かります。それまでの間、PR の coverage の下限 ([Issue #30](https://github.com/yokozi-jp/agent-software-factory/issues/30)) とレビューが防ぎます。
- 実行時間が 90 分 (`timeout-minutes`) を超えたら、対象のファイルを分けるか、incremental の cache を足すかを、この ADR を見直して決めます。
- `ci.yml` の step の名前が `Check, test and build (nx affected)` に変わります。保証カタログの行も同じ名前にしました。
