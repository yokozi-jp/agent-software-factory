---
type: ADR
title: "ADR 0057: Kiro CLI は mise の http backend で入れ、公式の index.json の sha256 を mise.lock に記録する"
description: Kiro CLI を mise.toml と mise.lock で固定して入れる決定。mise のレジストリに kiro がないので http backend で公式の zip を取り、公式の index.json の sha256 を mise.lock に記録する。PGP 署名は検証しない。版の更新は Renovate の regex manager で検出し、人が merge する。mise の http backend を使うとき、mise.toml の kiro-cli を変えるとき、CI で kiro-cli を動かすときに読む。
tags: [adr, tooling, mise, kiro, renovate]
---

# ADR 0057: Kiro CLI は mise の http backend で入れ、公式の index.json の sha256 を mise.lock に記録する

Kiro CLI は、開発者が手元で動かし、CI でも動かしたい道具です。入れ方は、公式のインストーラー (`curl -fsSL https://cli.kiro.dev/install | bash`) か `kiro-cli update` で、版を固定できず、開発者ごと、CI の実行ごとに版が変わります。agent の権限の hook や agent の設定 ([エージェントの権限](../tooling/agent-permissions.md)) は Kiro の版で動きが変わるので、開発環境と CI で同じ版にしたいと考えました。そこで、ほかの CLI ツールと同じく、`mise.toml` に版を書き、`mise.lock` に checksum を記録して入れます ([ADR 0009](0009-mise-for-pinned-cli-tools.md))。

mise 2026.11.0 の `mise registry` に `kiro` を含む行はなく、`mise ls-remote aqua:kiro` は `no aqua-registry found for kiro` で失敗します (2026-11-12 に確かめました)。そこで、mise の [http backend](https://mise.jdx.dev/dev-tools/backends/http.html) で、公式の配布元から zip を取ります。URL は公式のインストーラーが使うものと同じ `https://prod.download.cli.kiro.dev/stable/<版>/kirocli-x86_64-linux.zip` で、各版の sha256 は同じ配布元の `https://prod.download.cli.kiro.dev/stable/index.json` にあります。`mise.toml` の `checksum_url` と `checksum_expr` でその sha256 を読み、`mise lock` が `mise.lock` に記録します。`MISE_LOCKED=1` の `mise install` は、記録と違う zip を拒否します (`mise.lock` の sha256 を書き換えて、不一致で失敗することを確かめました)。この表は `[tools]` の中にあり、tasks や環境変数は書かないので、ADR 0009 の「`[tools]` の版だけ」の範囲に収まります。url と checksum の式を持つのは、registry にない道具だからです。

## Considered Options

- **公式のインストーラーを CI と手順書で実行する**: `--version` で版は指定できますが、checksum は実行のたびに配布元の `index.json` から読むので、リポジトリには記録されません。install の手順を自前で持たない方針 ([ADR 0009](0009-mise-for-pinned-cli-tools.md)) にも合いません。
- **`kiro-cli update` に任せる**: 常に最新になり、版を固定できません。
- **aqua backend に自前のレジストリを足す**: PGP を含む検証を使えますが、自前のレジストリを持ち続ける費用が、道具1つに対して大きすぎます。
- **`github:` backend**: 公式のインストーラーの配布元は `prod.download.cli.kiro.dev` で、Kiro の公式のインストールの案内 (2026-11-12) に GitHub Releases は出てきません (判断: 非公式の mirror に頼らない)。

## Consequences

- **署名は検証しません**: 配布元には `<zip>.asc` (PGP の分離署名) もあります (`https://prod.download.cli.kiro.dev/stable/3.2.1/kirocli-x86_64-linux.zip.asc` が 2026-11-12 に PGP 署名を返すことを確かめました)。mise の http backend の docs (2026-11-12) に署名を検証する項目はなく、使いません。信頼の根拠は、zip と同じホストの `index.json` の sha256 と、一度記録した後は `mise.lock` です。sha256 の取得元と zip の取得元が同じなので、配布元が侵害されると、最初に記録する時点の差し替えには気づけません。記録した後の差し替えには気づきます。検証したくなったら、PGP の鍵を信頼する手順を決めて、`mise lock` の後に確かめます (未実施)。
- **全 platform ではなく linux-x64 だけ**: `mise.toml` の url は `linux-x64` だけに書きます ([ADR 0009](0009-mise-for-pinned-cli-tools.md) の `mise.lock` と同じ方針です)。ほかの platform の開発者が `mise install` を実行すると、この道具だけ失敗します。macOS の zip は、公式の manifest (`stable/latest/manifest.json`) で `variant` が `standalone` で、Linux の `headless` と違います。中身は確かめていません。
- **CI の全 job に入ります**: `jdx/mise-action` は引数なしで `mise.toml` の道具をすべて入れるので、zip (3.2.1 は 139,054,258 byte。`index.json` の `size`) が mise-action を使う job の数だけ増えます。PR の CI では、`scripts` job の install は 2.8 秒でした。使わない job を外すには、job の `env` に `MISE_ENABLE_TOOLS` を置きます ([mise-action の README](https://github.com/jdx/mise-action#install-a-subset-of-configured-tools))。kiro-cli を動かす job を作るときに、使わない job を外すかを決めます。
- **版の更新は Renovate が検出し、人が merge します**: Renovate 44.198.0 の mise manager は `http:kiro-cli` を `unsupported-datasource` で飛ばす (`renovate --platform=local` のログ) ので、`renovate.jsonc` に regex manager と custom datasource (`index.json`) を足しました。`renovate --platform=local` で、3.1.0 から 3.2.1 への更新が `renovate/kiro-cli-3.x` として検出されることを確かめました。coding agent 自身の更新なので、リリースノートを読んでから merge します (自動 merge の対象から外す。判断)。Renovate が `mise.lock` も更新するかは、App で最初の PR が出るまで確かめられません。更新しない PR の手順は [Renovate](../tooling/renovate.md) にあります。
- **`mise exec` で呼びます**: セットアップの手順は `mise activate` を要求しません ([開発環境の構築](../local-env-setup/setup.md))。手元の `kiro-cli` が、`~/.local/bin` の公式のインストーラーのものか、mise のものかは、`PATH` の順で決まります。固定した版で動かすときは `mise exec -- kiro-cli` を使います。
- **自己更新は確かめていません**: mise の install 先にある `kiro-cli` が `kiro-cli update` で何を書き換えるかは、確かめていません。

## 出典

- mise の http backend の `url`、`bin_path`、`checksum_url`、`checksum_expr`: [http backend](https://mise.jdx.dev/dev-tools/backends/http.html)
- 公式のインストーラーが取る URL と、`index.json` から sha256 を読むこと: `https://cli.kiro.dev/install` (2026-11-12 に読んだ。`BASE_URL`、`get_checksum`、`download_and_verify`)
- 各版の package、sha256、size、variant: `https://prod.download.cli.kiro.dev/stable/index.json` と `https://prod.download.cli.kiro.dev/stable/latest/manifest.json` (2026-11-12 に読んだ)
- Kiro CLI の入れ方と更新: [Kiro のインストール](https://kiro.dev/docs/getting-started/installation/)
- Renovate の custom datasource と regex manager: [Custom Datasources](https://docs.renovatebot.com/modules/datasource/custom/)、[Custom Manager Support](https://docs.renovatebot.com/modules/manager/regex/)
