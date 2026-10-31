---
type: ADR
title: "ADR 0050: lint で止める import と呼び出しと、その検出力を示す fixture の行を、ルートの JSON の禁止の表 1 つに並べる"
description: "Outbox と接続の迂回、生の SQL、withTables、ロールとテナントを変える SQL、OpenTelemetry の SDK、pino と console、packages/db の import の禁止を、ルートの lint-restrictions.json に並べる決定。vite.config.ts は表を JSON の import で読み、repo-policy は 1 つの検査で表と fixture を両方向に突き合わせる。表を TS にする案、vite.config.ts を文字列で読み続ける案を退けた理由と、#136 (item 8) の判断を置き換えた範囲を記す。lint の禁止の値か message を足す、変えるとき、その fixture を足す、動かすとき、override の files を変えるとき、新しい層や package に禁止を届けるとき、repo-policy が禁止の表で止まったときに読む。"
tags: [adr, lint, oxlint, repo-policy, fixture]
---

# ADR 0050: lint で止める import と呼び出しと、その検出力を示す fixture の行を、ルートの JSON の禁止の表 1 つに並べる

[Issue #550](https://github.com/yokozi-jp/agent-software-factory/issues/550) で決めました。

以前は、禁止の値 (`outboxPackages` など) と message が `vite.config.ts` の定数にあり、それを正規表現で文字列として読む guard が repo-policy に 6 つ (`bypassGuards`、`withTablesGuards`、`sessionSettingGuards`、`telemetryBoundaries`、`loggingBoundaries`、`dbBoundaries`) ありました。fixture の置き場所と、そこに要る行は、guard ごとに手で書いていました。禁止を 1 つ足すたびに guard が 1 つ増え (#416、#483、#494、#537)、guard ごとに fixture の名前と確かめ方が違いました。

## 決定

- **禁止の表**: ルートの `lint-restrictions.json` に、禁止ごとの欄 (キー) を置きます。欄は、止める値 (`values`)、Oxlint が出す message (`message`) と、message に要る語 (`mentions`)、ADR (`adr`)、fixture の行 (`rows`) を持ちます。行は、fixture のファイル (`files`)、規則 (`rule`)、文字列 (`text`)、止めるか通すか (`expect`)、理由 (`reason`) を持ちます。列の意味と行の足し方は [CI](../tooling/ci.md) の「禁止の表」に書きます。JSON にはコメントを書けない ([RFC 8259](https://www.rfc-editor.org/rfc/rfc8259)) ので、禁止の理由は行の `reason` に書きます。
- **vite.config.ts は表を import する**: `import restrictions from "./lint-restrictions.json" with { type: "json" }` (ECMA-262 に入った [JSON modules](https://github.com/tc39/proposal-json-modules)) で読み、override の `paths` と `patterns` を表の値と message から組みます。Vite+ 1.4.0 で、JSON の値が lint の設定に届くことを確かめました (#550 のコメント)。override の `files` (glob) と組み立て (`moduleImports`、`moduleOverrides`) は `vite.config.ts` に残します。override が fixture に届くかは、fixture 自身が `vp check` で確かめます。
- **fixture の名前は欄のキー**: 表の fixture は `<dir>/__fixtures__/<キー>.ts` (入口とテストの override には `<キー>.test.ts`) です。1 つのファイルが 1 つの禁止を示します。
- **repo-policy は 1 つの検査で両方向に突き合わせる** (`lint-restrictions.ts` の `lintRestrictionsAgree`): (1) 止める行は、`oxlint-disable-next-line <規則>` の次の行にその文字列がある。通す行は、その文字列があり、前の行に disable のコメントがない。(2) 表の fixture の、disable のコメントの次の行、import と re-export の行、欄の文字列を書いた行は、どれも表の行にある。(3) 止める値ごとに、止める行を持つファイルのそれぞれに、その値を書いた止める行がある。(4) message が `mentions` の語と ADR を書く。表の行を消しても、fixture の行を消しても、値を足しても、どれかが失敗します。失敗の message は 1 つのひな形から作り、ファイル、規則、文字列を挙げ、行の理由と ADR を続けます (「`<file>` に、`oxlint-disable-next-line <規則>` の次の行で `<文字列>` を書いた行がない。」に理由と ADR が続く)。
- **`import type` は区別しない**: 型の import に disable のコメントを書いても使われず、`vp check` が失敗するので、表の検査は区別しません。
- **OpenTelemetry の種類は文字列の前方一致**: 以前の正規表現の断片 (`resources$`) をやめ、値をパッケージ名の先頭の文字列にします。閉じの引用符で終わる値 (`@opentelemetry/resources"`) は名前の全体です。fixture の文字列も同じ形 (`"@opentelemetry/resources"`) で書きます。
- **#136 (item 8) の判断を、表の範囲で置き換える**: #136 は「`vite.config.ts` は parser なしで文字列として読む」と決めました。禁止の値、message、fixture の行は、この表で JSON の parser (`tree.parsed`) で読みます。repo-policy は index を検査するので、作業ツリーの `vite.config.ts` を import できないためです。規則の名前 (`lintRulesHaveFixtures`) と `layers` は、今も文字列として読みます。
- **Issue との違い**: #550 は、ADR と message の要件を行ごとに持たせ、行に fixture のファイルを 1 つ書くとしていました。実装では、ADR (`adr`) と message の要件 (`mentions`) は欄に 1 回だけ書き、行は複数のファイル (`files`) を持ちます。同じ ADR と要件が、1 つの欄の全行で同じだからです (`outbox` は 7 行 × 8 ファイル)。失敗の message は、止める行には Issue のひな形を、通す行には「disable のコメントを前に置かずに」と書いた同じ形を使います。表にない行、値の欠け、ファイルの名前、message、表の形の失敗は、それぞれ直し方を書いた別の文にしました (判断)。
- **表に入れないもの**: 規則の名前と `layers` から機械的に求まる検査 (lint の規則の fixture、tsconfig のフラグ、層の境界、domain の純粋さ、Effect) は、`lint-fixtures.ts` に残します。行を手で並べる必要がないためです。

## Considered Options

- **表を TypeScript (`lint-restrictions.ts`) にする**: コメントが書け、型が付きます。ただし repo-policy は index の内容を検査するので、作業ツリーのファイルを import できず、TS のソースを正規表現で読むことに戻ります。JSON なら `vite.config.ts` は import で、repo-policy は parser で、同じ値を読めます。
- **`vite.config.ts` を文字列で読み続け、guard を足していく**: 今の形です。禁止ごとに guard と、定数を読む正規表現と、fixture の置き場所の規則が増え、名前と確かめ方がそろいません。
- **表を YAML にする**: コメントが書けますが、ECMA-262 が `type` の import attributes で決めている形式は JSON だけで ([JSON modules](https://github.com/tc39/proposal-json-modules))、Node.js も JSON だけを読みます ([Node.js の JSON modules](https://nodejs.org/api/esm.html#json-modules))。そのため、`vite.config.ts` から YAML を読むには parser の依存を足すことになります (判断)。JSON なら、Vite+ 1.4.0 の config の読み込みがそのまま扱えます (#550 のコメント)。
- **override の `files` も表に入れる**: どの override がどこに届くかと、Oxlint が最後の override だけを使う規則 ([ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md)) は、`vite.config.ts` の組み立てと切り離せません。届くかどうかは fixture の `vp check` が確かめるので、表には入れません (判断)。

## Consequences

- 禁止の値か message を変えるときは、`lint-restrictions.json` を直します。`vite.config.ts` には値も message もありません。値を足すと、その欄の止める行を持つファイルのそれぞれに行が要る、と repo-policy が止めます。
- 新しい層や package に禁止を届けるときは、override の `files` を直し、その場所の `__fixtures__/<キー>.ts` と表の行を足します。以前の `bypassGuards` は `layers` から場所を求めていましたが、表は場所を行で並べるので、足し忘れを機械では止めません。[package を足す](../domain-model/add-package.md) の手順に書きます。
- fixture の名前を表のキーにそろえました。`bypass.ts` は `outbox.ts`、`connection.ts`、`raw-sql.ts` に分け、`logger-imports.ts` は `pino.ts`、`packages/db` の `imports.ts` は `db-imports.ts` にし、`runtime-apis.ts` の `console` の行は `console.ts` に、`apps/api` の `otel-sdk.ts` の Node 専用の入口の行は `telemetry-node.ts` に移しました。`packages/telemetry` の SQS の行は `outbox.ts` に移し、7 つの SDK すべてを並べ、telemetry の override の `files` に足しました。
- `lint-restrictions.json` は、Nx の `sharedGlobals` と lefthook の `repo-policy` の `glob` に入れます。表を変えると全 project が affected になります。
