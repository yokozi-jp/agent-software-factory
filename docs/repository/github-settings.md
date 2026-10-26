---
type: Runbook
title: GitHub リポジトリの設定
description: squash merge だけを許可する設定、main を ruleset で保護する設定、private vulnerability reporting と CODEOWNERS を、管理者が gh で設定する手順と、設定を確かめる方法、緊急時に main を直す方法。リポジトリを作ったとき、merge の設定、main の保護、脆弱性の報告の受け付け、コードの所有者を変えるときに読む。
tags: [repository, runbook, github, ruleset, branch-protection, codeowners, security]
---

# GitHub リポジトリの設定

管理者がリポジトリを作ったときに1回だけ実行します。squash merge だけを許可し ([ADR 0004](../adr/0004-squash-merge-and-pr-title-lint.md))、main を ruleset で保護し、脆弱性の非公開の報告を受け付けます。
main を変えられるのは、必須チェックが通った PR の squash merge だけになります。
設定を変えたら、[コードレビューの前提条件](../code-review/prerequisites.md#事前設定github) の GitHub の設定の表も直します。

## 1. merge の方式

squash のコミットタイトルを PR タイトル、本文を PR の説明にします。

```sh
gh repo edit yokozi-jp/agent-software-factory \
  --enable-squash-merge \
  --squash-merge-commit-message pr-title-description \
  --enable-merge-commit=false \
  --enable-rebase-merge=false \
  --delete-branch-on-merge
```

## 2. main の保護 (ruleset)

ruleset の定義は `.github/rulesets/protect-main.json` にあります。リポジトリの root で実行します。

```sh
gh api --method POST repos/yokozi-jp/agent-software-factory/rulesets --input .github/rulesets/protect-main.json
```

既に `protect-main` がある場合は、id を調べて更新します。

```sh
id=$(gh api repos/yokozi-jp/agent-software-factory/rulesets --jq '.[] | select(.name == "protect-main") | .id')
gh api --method PUT "repos/yokozi-jp/agent-software-factory/rulesets/$id" --input .github/rulesets/protect-main.json
```

ruleset の内容:

| ルール                   | 効果                                                                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deletion`               | main を削除できない                                                                                                                                                                                                                                                                              |
| `non_fast_forward`       | main に force push できない                                                                                                                                                                                                                                                                      |
| `pull_request`           | main への直接の push を拒否し、PR からの squash merge だけを許可する。承認の数は 0 (1人で運用するため)                                                                                                                                                                                           |
| `required_status_checks` | `main` (CI)、`commitlint`、`betterleaks`、`dependency-review` の4つのチェックが GitHub Actions で通らないと merge できない。`integration_id` の `15368` は GitHub Actions アプリの ID で、同じ名前のチェックを他から送っても数えられない (`gh api /apps/github-actions --jq .id` で確かめられる) |
| `code_scanning`          | CodeQL が、エラーの alert か、重大度 high 以上のセキュリティの alert を PR で見つけたら merge できない。CodeQL の解析が終わっていないとき、CodeQL が設定されていないときも merge できない ([ADR 0021](../adr/0021-sast-and-dependency-scan.md))。先に「4. コードと依存の脆弱性」を設定する       |

bypass は、リポジトリの管理者に `pull_request` モードだけを許しています。管理者は、チェックが壊れたときなどに PR の merge で ruleset を飛ばせますが、main への直接の push はできません。
エージェントは利用者の認証情報で push するので、管理者に直接の push を許すと、エージェントの誤った push も通るためです。
ローカルでは、pre-push hook (`tools/scripts/sh/guard-push.sh`) も main への push を拒否します ([Git hook](../tooling/git-hooks.md))。

## 3. 脆弱性の報告 (private vulnerability reporting)

[SECURITY.md](../../SECURITY.md) は、脆弱性を GitHub の private vulnerability reporting で報告するよう案内しています。
有効にすると、リポジトリの Security タブの Advisories に「Report a vulnerability」のボタンが出て、報告者は非公開で報告を送れます ([GitHub の docs](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository))。
公開リポジトリでだけ使えます。

```sh
gh api --method PUT repos/yokozi-jp/agent-software-factory/private-vulnerability-reporting
```

新しい報告の通知は、リポジトリの管理者に届きます。届くのは、リポジトリを All Activity か Custom の Security alerts で Watch していて、リポジトリの通知を有効にしている場合です。

## 4. コードと依存の脆弱性

PR が新しく持ち込んだ脆弱性だけで merge を止め、すでにある脆弱性は Security タブの alert で扱います ([ADR 0021](../adr/0021-sast-and-dependency-scan.md))。public のリポジトリでは無料です。private のリポジトリでは GitHub Code Security の契約が要り、ない場合の代わりは ADR 0021 の Consequences にあります。

CodeQL の default setup を有効にします。workflow のファイルはなく、GitHub が PR と main の push と週1回の schedule で、言語 (TypeScript と GitHub Actions) を検出して解析します ([GitHub の docs](https://docs.github.com/en/code-security/how-tos/scan-code-for-vulnerabilities/configure-code-scanning/configuring-default-setup-for-code-scanning))。ruleset の `code_scanning` の規則は、CodeQL が設定されていないと全ての PR を止めるので、ruleset より先に有効にします。

```sh
gh api --method PATCH repos/yokozi-jp/agent-software-factory/code-scanning/default-setup -f state=configured -f query_suite=default
```

Dependabot alerts を有効にします。main の依存に脆弱性の advisory が出ると alert になります。依存を上げる PR は Renovate が出すので ([ADR 0018](../adr/0018-renovate-for-pinned-versions.md))、Dependabot security updates は有効にしません。

```sh
gh api --method PUT repos/yokozi-jp/agent-software-factory/vulnerability-alerts
```

Dependabot malware alerts (悪意のある npm パッケージの alert) は API で有効にできないので、Web で設定します。Settings → Advanced Security の「Dependabot malware alerts」で Enable を押します ([GitHub の docs](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-malware-alerts))。

## 5. CODEOWNERS

`.github/CODEOWNERS` で、全てのファイルの所有者を `@yokozi-jp` にしています ([GitHub の docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners))。
GitHub は、所有するファイルを変える PR が開かれると、所有者にレビューを依頼します。ただし PR を開いた人自身には依頼しません。エージェントは利用者の認証情報で PR を開くので、このリポジトリでは依頼はほとんど届かず、CODEOWNERS は所有者を記録し、ファイルの画面に表示するために置いています。
ruleset の `require_code_owner_review` は `false` のままにし、所有者の承認を merge の条件にしていません。1人で運用していて、承認の数も 0 にしているためです。

CODEOWNERS の設定は GitHub の側にはなく、ファイルを main に置くだけで有効になります。所有者には、リポジトリへの書き込みの権限が必要です。

## 6. 設定を確かめる

```sh
gh api repos/yokozi-jp/agent-software-factory --jq '{allow_squash_merge, allow_merge_commit, allow_rebase_merge, squash_merge_commit_title, squash_merge_commit_message, delete_branch_on_merge}'
gh api repos/yokozi-jp/agent-software-factory/rules/branches/main --jq '.[].type'
gh api repos/yokozi-jp/agent-software-factory/private-vulnerability-reporting
gh api repos/yokozi-jp/agent-software-factory/codeowners/errors
gh api repos/yokozi-jp/agent-software-factory/community/profile --jq '.files.contributing.html_url'
gh api repos/yokozi-jp/agent-software-factory/code-scanning/default-setup --jq .state
gh api repos/yokozi-jp/agent-software-factory/vulnerability-alerts -i
```

- 2つ目のコマンドで、`deletion`、`non_fast_forward`、`pull_request`、`required_status_checks`、`code_scanning` が表示されれば有効です。
- 3つ目で `{"enabled":true}` なら、private vulnerability reporting は有効です。
- 4つ目で `"errors":[]` なら、CODEOWNERS に書き間違いや、書き込みの権限がない所有者はありません。CODEOWNERS が main にないときは 404 を返します。
- 5つ目で URL が表示されれば、GitHub は CONTRIBUTING.md を認識しています。SECURITY.md はこの API に出ないので、Insights の Community Standards の「Security policy」で確かめます。
- 6つ目で `configured` なら CodeQL の default setup は有効です。7つ目で `204` なら Dependabot alerts は有効です (無効なら `404`)。malware alerts は API で確かめられないので、Settings → Advanced Security で確かめます。

## 緊急時に main を直す

main を force push で戻すなど、ruleset に反する操作がどうしても必要なときは、管理者が次の手順で行います。

1. ruleset を一時的に無効にします。

   ```sh
   id=$(gh api repos/yokozi-jp/agent-software-factory/rulesets --jq '.[] | select(.name == "protect-main") | .id')
   gh api --method PUT "repos/yokozi-jp/agent-software-factory/rulesets/$id" -f enforcement=disabled
   ```

2. 操作します。ローカルの pre-push hook も拒否するので、`ALLOW_PUSH_TO_MAIN=1` を付けます。force push には `--force-with-lease=main:<今の main の SHA>` を付け、他の人の push を消さないようにします。
3. ruleset を元に戻します (`-f enforcement=active`)。

## 既知の制約: Release workflow

[リリース](release.md) の workflow は `GITHUB_TOKEN` で `chore: release` コミットを main に直接 push します。
`GITHUB_TOKEN` (GitHub Actions) は ruleset の bypass に追加できないので、この ruleset を有効にすると、Release workflow の push は拒否されます。
リリースを始める前に、リリースのコミットを PR にする方式か、bypass に追加できる GitHub App のトークンを使う方式に変える必要があります ([#12](https://github.com/yokozi-jp/agent-software-factory/issues/12))。それまでは、Release workflow は dry-run ではない実行を最初のステップで止めます。
