---
type: ADR
title: "ADR 0031: mutation test は PR の CI から外し、1日1回の workflow で実行する"
description: tools/scripts の Stryker (mutation target) を、PR の nx の job の nx affected から外し、mutation.yml の1日1回の schedule と手動の実行にする決定。PR では Stryker の初回の実行 (mutation-dry-run) だけを流し、定期実行の失敗は Issue にする。break の 100 は変えず、保証には数えない。比べた案は PR のゲートのまま cache を足す案、変更したファイルだけを PR で変異させる案、main への push ごとに実行する案、初回の実行も PR で流さない案。mutation の実行時間が重いとき、Stryker の設定や target を変えるとき、mutation を merge のゲートに戻したくなったときに読む。
tags: [adr, ci, testing, mutation, stryker]
---

# ADR 0031: mutation test は PR の CI から外し、1日1回の workflow で実行する

`tools/scripts` の `mutation` target (Stryker) を、PR の CI (`ci.yml` の `nx affected -t check test build mutation`) から外します。`mutation.yml` が毎日と手動で実行します。`break` の 100 (生き残った mutant が 1 つでもあれば失敗) は変えません。PR では、mutant を走らせない初回の実行 (`mutation-dry-run`) だけを流します。

## 背景

[ADR 0024](0024-scripts-and-hooks-in-typescript.md) の導入時、`mutation` は約 50 秒で、`tools/scripts` を変えた PR で毎回すべての mutant を回しました。そのとき「遅くなったら cache を置くかを決める」としていました。

2026-10-28 に `repo-policy/rules.ts` だけを変異させると、893 個の mutant で初回が 13〜19 分かかりました (他のセッションが動いていて load average が 20 前後)。同じファイルでテストを 1 つ足した後の incremental は約 1 分でした。コードが増えると、さらに長くなります。CI の `nx` の job は `timeout-minutes: 20` で、`check test build` と同じ job の中で動いていました。

## ルール

- **実行**: `mutation.yml` が毎日 03:00 UTC と `workflow_dispatch` で `pnpm exec nx mutation scripts` を実行します。必須チェックにせず、`ci.yml` の `main` の `needs` にも入れません。
- **手元**: `rules.ts` を変えた人 (エージェント) は、push の前にそのファイルだけを変異させます ([CI](../tooling/ci.md))。手順は変えません。
- **初回の実行だけは PR で流す**: `ci.yml` と pre-push が `nx affected -t mutation-dry-run` (`stryker run --dryRunOnly`) を流します。mutant は走らせず、`unit` のテストが Stryker の sandbox で通るかだけを確かめます。実ワークスペースを読む `unit` のテストは、PR の `test` では通り、Stryker の初回の実行で落ちます。定期実行は 2026-10-28 から 2026-11-11 まで一度も成功しませんでした。2026-10-30 は score 99.14 で `break` の 100 に届かず、2026-10-31 から 2026-11-11 までは `migration-compat` のテスト 1 つが初回の実行で落ちて止まりました ([Issue #570](https://github.com/yokozi-jp/agent-software-factory/issues/570))。
- **保証**: merge のゲートでなくなるので、mutation の score は [保証カタログ](../tooling/assurance-catalog.md) の保証に数えません (初回の実行の step は数えます)。1日1回の実行が失敗したら、`mutation.yml` の `report` job が Issue を作ります (開いている同名の Issue があればコメントします)。GitHub は定期実行の失敗を、cron の行を最後に変えた人にだけメールするので ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows))、メールには頼りません。Issue を受け取ったら、初回の実行の失敗はテストを `*.tools.test.ts` に移し、生き残った mutant はそれを殺すテストを足します。

## Considered Options

- **PR のゲートのまま、incremental の結果を CI の cache に置く**: 2 回目以降は速くなります。ただし最初の実行と、cache が消えた後の実行は重いままで、PR を待たせます。cache の復元が検証されない問題 ([ADR 0009](0009-mise-for-pinned-cli-tools.md) と同じ考え方) も増えます。
- **PR では変更したファイルだけを変異させる**: PR の時間は短くなります。ただし `--mutate` のファイルを CI で求める仕組みが要り、変更していないファイルのテストが弱くなっても検出が遅れます。
- **main への push ごとに実行する**: 検出は速くなります。ただし `tools/scripts` を変える merge のたびに重い job が走り、問題の先送りになります。
- **初回の実行も PR で流さず、毎日の実行だけにする**: PR は速いままです。ただし sandbox の外を読む `unit` のテストが入っても、翌日の定期実行まで気づけません。2026-10-31 からの 12 日間がその例で、定期実行の失敗が読まれないと、直るまで日数がかかります。初回の実行だけなら 16 秒 (2026-11-12 の CI) で、この案より検出が早いので採りませんでした。

## Consequences

- mutation の退行 (テストの弱まり) は、最大で 1 日後に Issue で分かります。それまでの間、PR の coverage の下限 ([Issue #30](https://github.com/yokozi-jp/agent-software-factory/issues/30)) とレビューが防ぎます。
- 実行時間が 90 分 (`timeout-minutes`) を超えたら、対象のファイルを分けるか、incremental の cache を足すかを、この ADR を見直して決めます。
- `ci.yml` の step の名前が `Check, test and build (nx affected)` に変わります。保証カタログの行も同じ名前にしました。
