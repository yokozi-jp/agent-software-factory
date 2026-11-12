---
type: ADR
title: "ADR 0056: React Compiler は Rust 版 (oxc-transform-react) を @vitejs/plugin-react の compiler オプションで使い、テストでは止める"
description: apps/web のビルドと開発サーバーに React Compiler を入れる決定。公式の Babel 経由ではなく、実験的な Rust 版を plugin-react の compiler オプションで使い、oxc-transform-react を plugin-react の peer の範囲に固定し、Vitest の実行中は止める。React Compiler の設定や版を変えるとき、Babel 経由に替えたくなったとき、テストでもコンパイラを動かしたくなったとき、coverage の branches が下がったとき、oxc-transform-react の更新が止まっているときに読む。
tags: [adr, web, react, vite, coverage]
---

# ADR 0056: React Compiler は Rust 版 (oxc-transform-react) を @vitejs/plugin-react の compiler オプションで使い、テストでは止める

`apps/web` の部品は、`useMemo`、`useCallback`、`React.memo` を書かずに、再描画を React Compiler の自動のメモ化に任せられます。React 公式は、コンパイラを安定版で本番の実績があるとし、`infer` の既定の設定を標準としています ([Introduction](https://react.dev/learn/react-compiler/introduction)、[compilationMode](https://react.dev/reference/react-compiler/compilationMode))。

## 決定

- `apps/web/vite.config.ts` の `react()` に `compiler: { logDiagnostics: true }` を渡す。コンパイラは `oxc-transform-react` (Rust 版) で、`babel-plugin-react-compiler` と `@rolldown/plugin-babel` は入れない。
- `oxc-transform-react` は pnpm の catalog に `^0.156.0` で置く。`@vitejs/plugin-react` 6.3.0 の peer が `>=0.152.0 <0.157.0` だから。`0.x` の caret は次のマイナー版を含まないので、この範囲に収まる。Renovate も `renovate.jsonc` で `<0.157.0` を超える更新を出さない。
- `compilationMode` は既定の `infer` のままにする。`all` と `annotation` は使わない。
- Vitest の実行中 (`process.env["VITEST"]` がある) は、コンパイラを止める。
- 既存の `useMemo` と `useCallback` (`packages/ui` の `sidebar.tsx`) は消さない。コンパイラが飛ばす部品や、不具合の切り分けには `"use no memo"` を付ける ([Debugging](https://react.dev/learn/react-compiler/debugging))。

## 理由

テストでコンパイラを止めるのは、coverage の branches を守るためです。コンパイラは各部品に `if ($[0] !== dep) {…} else {…}` のキャッシュ判定を足します。テストはこの判定の片側しか通らず、v8 と Istanbul のどちらでも branches が下がります ([vitest#7843](https://github.com/vitest-dev/vitest/issues/7843)、[reactwg/react-compiler#78](https://github.com/reactwg/react-compiler/discussions/78))。生成コードには `/* v8 ignore */` を書く位置がありません。除外の hook を求める [vitest#11663](https://github.com/vitest-dev/vitest/issues/11663) は、提案の段階です。

このリポジトリで確かめた結果は次のとおりです (2026-11-12、`@vitejs/plugin-react` 6.3.0、`oxc-transform-react` 0.156.0、Vite+ 1.5.0)。

|             | コンパイラを止める                             | `compiler: { logDiagnostics: true }` を全体に掛ける                                                                               |
| ----------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `web:test`  | 21 ファイル、171 件が通る。coverage の違反なし | 171 件が通る。branches が `src/**` で 91.14% (下限 100%)。ファイルごとの下限 90% を 5 ファイルが割る                              |
| `web:build` | 通る                                           | 通る。診断の出力はなし。`dist/assets` が +1.6% (756,656 B → 768,590 B)。`compiler-runtime` のチャンクが増える (53 kB、gzip 17 kB) |

コンパイラ向けの lint は、Oxlint の correctness カテゴリにすでに入っています ([Oxc のブログ](https://oxc.rs/blog/2026-08-18-react-compiler-support.html))。`apps/web` と `packages/ui` に違反は 0 件で、`react(immutability)` が警告として出ることを確かめました。

## Considered Options

- **Babel 経由 (`reactCompilerPreset`)**: React 公式の Vite の手順で、標準です ([Installation](https://react.dev/learn/react-compiler/installation))。依存は `@rolldown/plugin-babel`、`@babel/core`、`babel-plugin-react-compiler` の3つで、Rust 版より遅い (Oxc の計測で 10 倍以上)。coverage の問題は同じ。Rust 版を使いたいという要望で採らなかった (判断)。
- **annotation モード**: `"use memo"` を付けた部品だけをコンパイルする。公式は段階導入向けとしている。付けた部品の branches は同じように下がるので、coverage の問題は解けない。新しい部品に付け忘れる。
- **coverage から外す、下限を下げる**: `docs/tooling/ci.md` が禁じている。ADR 0053 の趣旨にも反する。
- **`coverage.ignoreNode` で生成した分岐を外す**: Vitest にまだない ([vitest#11663](https://github.com/vitest-dev/vitest/issues/11663))。`@vitest/coverage-v8` にパッチを当てると、版ごとに壊れる。
- **導入しない**: React 公式は「React は最適化なしでも十分速いことが多い」と書く。この PR の時点で、再描画が遅いという計測はない (下の「影響」)。

## 影響

- **テストがコンパイル後のコードを通らない。** コンパイラが原因の不具合は、テストでは見つからない。公式は、不具合の多くは Rules of React の違反をコンパイラが検出できなかった場合に起きるとしている ([Debugging](https://react.dev/learn/react-compiler/debugging))。その検出は lint が担う。E2E ([ADR 0039](0039-e2e-playwright-gate-and-ai-for-authoring.md)) はまだ実装されておらず、ビルドした成果物で確かめる手段は、今はない。
- **実験的である。** plugin-react の README は、Rust 版のコンパイラ対応を experimental と警告している。Oxc も TODO の残りを認めている ([Oxc のブログ](https://oxc.rs/blog/2026-08-18-react-compiler-support.html))。不具合が出たら、`"use no memo"` で飛ばすか、`compiler` を外す。
- **効果は測っていない。** 再描画の回数や時間の計測はしていない。導入の効果は、ビルドの成果物でコンパイルされた部品の数 (`_c(` が約 11 箇所) までしか確かめていない。再描画が問題になる画面ができた時に計測する。
- **`oxc-transform-react` の更新は人が見る。** 0.x なので、[ADR 0055](0055-renovate-automerge-by-ci.md) の自動 merge の対象外。plugin-react が peer の範囲を広げたら、`renovate.jsonc` の `allowedVersions` の規則と catalog の範囲を直す。
- **止めるには**、`vite.config.ts` の `compiler` を外し、catalog と `apps/web/package.json` から `oxc-transform-react` を消す。
