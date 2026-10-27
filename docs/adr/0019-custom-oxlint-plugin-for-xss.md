---
type: ADR
title: "ADR 0019: XSS の入口になる書き方は、メッセージを指定できる自作の Oxlint plugin で止める"
description: "apps/web/src で dangerouslySetInnerHTML、javascript: の URL、eval などを Oxlint の自作 JS plugin (tools/lint-plugins/src/xss-plugin.ts) で禁止する決定。組み込みのルールではなく plugin にした理由、disable コメントに理由を求める方法、見つけられない書き方を記す。XSS の lint で止まったとき、規則を足すとき、組み込みのルールに戻したくなったときに読む。"
tags: [adr, tooling, oxlint, lint, security, web]
---

# ADR 0019: XSS の入口になる書き方は、メッセージを指定できる自作の Oxlint plugin で止める

React のコードで XSS の入口になる書き方 (`dangerouslySetInnerHTML`、`javascript:` の URL、`eval`、`new Function` など) を、`vp check` で止めます。Issue は [#60](https://github.com/yokozi-jp/agent-software-factory/issues/60) です。

- **決定**: `tools/lint-plugins/src/xss-plugin.ts` に Oxlint の JS plugin を置き ([ADR 0030](0030-lint-plugins-in-tools-lint-plugins.md) で `apps/web/lint/` から移しました)、ルートの `vite.config.ts` の `lint.overrides` で `apps/web/src/**` に有効にします。規則は `no-html-injection`、`no-javascript-url`、`no-dynamic-code`、`require-disable-reason` の 4 つです。禁止の一覧と理由は [静的解析](../web-frontend/static-analysis.md) にあります。
- **理由**: Issue は、直し方を書いたメッセージを求めています。Oxlint の `no-eval`、`no-new-func`、`no-script-url` の設定には、メッセージを指定する項目がありません。`react/forbid-dom-props` と `no-restricted-globals` は指定できますが、`javascript:` の URL と文字列を渡した `setTimeout` には使えません。plugin なら、4 つの規則すべてで「理由、代わりの書き方、docs の path」を 1 つのメッセージに書けます。plugin は Vite+ が公式にサポートする方法 (`vite-plus/lint/plugins`) で書き、`RuleTester` (`vite-plus/lint/plugins-dev`) でテストします。
- **disable コメント**: 禁止を外すときは、`// oxlint-disable-next-line web-xss/no-dynamic-code -- 理由` のように `--` に続けて理由を書きます。`require-disable-reason` が、理由のない disable コメントを `apps/web/src` 全体で止めます。規則名のない一括の disable (`/* oxlint-disable */`) は、Oxlint の `unicorn/no-abusive-eslint-disable` が止めます。
- **組み込みの `no-eval`**: 同じ書き方が 2 つのメッセージで報告されないよう、`apps/web/src` では `no-eval` を off にし、`web-xss/no-dynamic-code` に任せます。

## Considered Options

- **組み込みのルールだけにする (`react/no-danger`、`react/jsx-no-script-url`、`no-eval`、`no-new-func`)**: 自作のコードが要りません。ただ、メッセージが「何が危ないか」だけで、代わりの書き方を書けません。Issue の受け入れ条件を満たしません。
- **組み込みのうちメッセージを指定できるものと組み合わせる**: `dangerouslySetInnerHTML` (`react/forbid-dom-props`) と `eval` (`no-restricted-globals`) は直し方を書けます。`javascript:` の URL と、文字列を渡した `setTimeout` は組み込みのルールのメッセージのままになります。規則ごとにメッセージの出し方が変わるので、plugin 1 つにそろえました。これは判断です。
- **ast-grep や ESLint を足す**: Oxlint の外に検査が増えます。Oxlint の plugin で足りるので選びませんでした。

## Consequences

- plugin は Oxlint の alpha 機能です。API が変わったら、Vite+ を上げる PR で `tools/lint-plugins/` を直します。`RuleTester` のテストが `lint-plugins:test` で動くので、壊れれば CI で分かります。
- 見つけられない書き方があります (変数に入れた文字列、`el[name] = html`、別名を通した `eval`、HTML の文字参照で書いた `javascript:` など)。一覧は [静的解析](../web-frontend/static-analysis.md) にあります。サニタイズや CSP の代わりではありません。
- `require-disable-reason` を同じファイルの disable コメントで止められます。レビューで disable コメントの差分を見ます。
- 規則を足すときは、`xss-plugin.ts` に足し、`xss-plugin.test.ts` に禁止の例と通す例を足し、[静的解析](../web-frontend/static-analysis.md) の表を直します。
