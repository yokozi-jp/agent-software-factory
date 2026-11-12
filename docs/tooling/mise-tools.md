---
type: Runbook
title: mise の道具を足すとき
description: mise.toml に CLI ツールを足す、版を上げる、registry にない道具を足すときに直す場所の一覧と、足した後の確かめ方。mise.toml、mise.lock、Renovate、セットアップの手順、CI、ADR の順に確かめる。mise の道具を足す、替えるとき、Renovate が mise の道具を更新しないときに読む。
tags: [tooling, runbook, mise, renovate]
---

# mise の道具を足すとき

mise で入れる CLI ツールは、`mise.toml` に版を書き、`mise.lock` に checksum を記録します ([ADR 0009](../adr/0009-mise-for-pinned-cli-tools.md))。
道具を 1 つ足すと、次の場所を全部直します。`ci.yml` の検査を足すときの一覧は [CI](ci.md) の「検査を足すとき」にあります。

## 直す場所

1. **backend を選ぶ**: `mise registry | grep <名前>` で registry にあるかを見ます。ない道具は、`mise ls-remote aqua:<名前>` で aqua のレジストリを確かめます。どちらにもなければ、配布元の URL で `http` backend を使います ([mise の http backend](https://mise.jdx.dev/dev-tools/backends/http.html))。`http` backend は、`checksum_url` で公式の checksum を読ませ、署名の検証がないことを ADR に書きます。
2. **`mise.toml`**: `[tools]` に、固定した版を書きます。tasks と環境変数は書きません (ADR 0009)。
3. **`mise.lock`**: `mise lock <道具> --platform linux-x64` を実行して commit します。記録するのは `linux-x64` だけです。ほかの platform が増えると repo-policy が失敗します。
4. **Renovate**: 版の更新を出せるかを確かめます (下の「Renovate が読むかを確かめる」)。読まない道具は、`renovate.jsonc` に custom datasource と regex manager を足します。自動 merge の範囲は [Renovate](renovate.md) の表と `renovate.jsonc` の `packageRules` で決めます。更新の対象の表 ([Renovate](renovate.md) の「更新の対象」) にも 1 行足します。
5. **開発環境の構築**: [開発環境の構築](../local-env-setup/setup.md) の「各ツールを入れる理由」に 1 行足します。`mise install --locked` が入れるので、手順のコマンドは増えません。`mise activate` を使わないので、手で呼ぶ道具は `mise exec -- <道具>` で呼ぶと書きます。
6. **CI**: `jdx/mise-action` は引数なしで `mise.toml` の道具をすべて入れるので、足した道具は mise-action を使う全 job に入ります。大きい道具は、使わない job で `MISE_ENABLE_TOOLS` を置いて外せます ([mise-action の README](https://github.com/jdx/mise-action#install-a-subset-of-configured-tools))。
7. **ADR**: registry にない道具、署名を検証しない道具、更新を自動にしない道具のように、意外な選択をしたときは ADR を書きます ([docs の書き方](../knowledge/documentation-authoring.md) の「ADR を書くかどうか」)。番号は `node tools/scripts/src/checks/check-adr-number/cli.ts` で決めます。

## 足した後の確かめ方

- **lock のとおりに入る**: 空の `MISE_DATA_DIR` と `MISE_CACHE_DIR` を使い、`MISE_LOCKED=1 mise install <道具>` と `mise exec <道具> -- <道具> --version` を実行します。
- **checksum の不一致で止まる**: `mise.lock` の checksum を 1 文字書き換えて `MISE_LOCKED=1 mise install <道具>` が失敗することを確かめ、元に戻します。
- **道具を使うテスト**: `pnpm exec nx test-tools scripts` を実行します。変更を commit する前は、`nx affected` に `--uncommitted` を付けます。`--base` と `--head=HEAD` では、commit していない変更が対象になりません。
- **repo-policy**: `node tools/scripts/src/checks/repo-policy/cli.ts` を実行します。新しい ADR は、`git add` した後でないと、存在するものとして数えられません。

## Renovate が読むかを確かめる

`tools/scripts/sh/renovate.sh preview` は、PR になる更新だけを出します。更新がないときは何も出さず (終了コード 0)、道具を読めたのか、読まずに飛ばしたのかは分かりません。

読めたかどうかは、Renovate を debug のログで直接動かして確かめます。

```sh
LOG_LEVEL=debug LOG_FORMAT=json pnpm dlx --allow-build=re2 --package=renovate@<tools/scripts/sh/renovate.sh の renovate_version> renovate --platform=local > renovate.log
```

ログの `config.mise` の各依存に `skipReason` があれば、mise の manager は飛ばしています。たとえば `http:` の道具は `unsupported-datasource` です (Renovate 44.198.0、2026-11-12)。custom manager を足したら、その道具の `depName` と `updates` がログにあることを見ます。更新の検出は、`mise.toml` の版を 1 つ前の版に一時的に下げて、`updates` に新しい版が出ることで確かめ、確かめたら戻します。
エージェントは、`gh auth token` を自分で実行しません ([エージェントの権限](agent-permissions.md))。GitHub の datasource が rate limit で止まったら、利用者に `GITHUB_COM_TOKEN` を設定して実行するよう頼みます。
