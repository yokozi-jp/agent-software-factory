---
type: Reference
title: "Issue tracker: GitHub"
description: How skills create, read, label and link GitHub issues with the gh CLI. Read when a skill touches the issue tracker.
tags: [agents, skills, github, issues]
---

# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
  - `api.github.com` への通信は `Post "https://api.github.com/graphql": EOF` で失敗することがある。失敗しても作られている場合があるので、再実行する前に `gh issue list --state open --search "<題名の一部>"` で作成済みかを確かめる。
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`
- **Retry transient failures**: `api.github.com` sometimes fails with `EOF` or `SSL_ERROR_SYSCALL`. Repeat the same request: `for i in 1 2 3 4 5; do gh issue view 45 --json title && break; sleep 3; done`. A write (`gh issue comment`, `gh issue edit`) that failed with `EOF` may still have reached GitHub, so read the issue before repeating it.

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Issue forms (issues created on the web)

Issues created from the GitHub web UI go through the issue forms in `.github/ISSUE_TEMPLATE/`, modelled on the ones in `mattpocock/skills`. Each form applies one category role and the `needs-triage` state role ([Triage Labels](triage-labels.md)), so `/triage` finds them in the `needs-triage` bucket:

| Form                         | Labels                        |
| ---------------------------- | ----------------------------- |
| `bug.yml` (バグ)             | `bug`, `needs-triage`         |
| `enhancement.yml` (機能要望) | `enhancement`, `needs-triage` |

`config.yml` sets `blank_issues_enabled: false`, which hides the blank issue from users with the Read or Triage role; users with Write or above still see it as "Maintainers only" ([GitHub docs](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository#configuring-the-template-chooser)). It also links vulnerability reports to private vulnerability reporting.
`gh issue create --title ... --body ...` does not go through the forms (`--template` only supplies starting body text, see the [gh manual](https://cli.github.com/manual/gh_issue_create)), so issues that skills create are unaffected and carry only the labels passed with `--label`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
  - 本文の先頭に `Blocked by:` の行を書いたら (地図の子でも作業の Issue でも)、その行の Issue ごとにネイティブの辺も張る。本文の行だけでは、frontier の問い合わせにも GitHub の画面にも出ない。本文に「X の後」と前提を書いたときも、辺にするか、前提ではないと書き分ける。経緯を示すだけの Issue は、`（決定は [#75](…)）` のように全角の括弧に入れる (検査が blocker に数えない)。
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins. 実行するコマンドは次のとおり。`--paginate` を付けないと、子の最初の 30 件で切れて、後ろの open の子を見落とす。`api.github.com` が `EOF` で失敗したら、同じコマンドを繰り返す。

  ```sh
  gh api --paginate repos/<owner>/<repo>/issues/<map>/sub_issues \
    --jq '.[] | select(.state=="open" and (.assignees|length)==0 and .issue_dependencies_summary.blocked_by==0) | "#\(.number) \(.title)"'
  ```

  `Blocked by` の行で依存を書いた子は、この条件では見分けられないので、本文の先頭を読む。

- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
- **Edit the map body**: `gh issue edit <map> --body-file` replaces the whole body, and other sessions edit the same map concurrently. Re-read the body (`gh issue view <map> --json body --jq .body`) right before writing; if it differs from the copy you edited, reapply your change on top of the fresh body, so another session's lines survive.

## 検査

`node tools/scripts/src/checks/issue-tracker/cli.ts` が、Issue のずれのうち機械的に見つかる 3 つを報告します (exit 1)。`.github/workflows/issue-tracker.yml` が毎週月曜に実行し、失敗はメールで届きます。Issue は PR の外で変わるので、必須チェックにはしません。`/implement` で Issue を取る前と、ファイルを移す PR を merge した後にも手で実行します。

- **消えたパス**: open な Issue のインラインコードに、git の履歴で消えたパスがある。ファイルを移す PR ([Issue #158](https://github.com/yokozi-jp/agent-software-factory/issues/158) の `scripts/`) の後、古いパスを指したままの Issue をエージェントが古い形で作るのを防ぎます。履歴の全部が要るので、shallow clone では exit 2 で止まります。
- **実施の Issue の漏れ**: 地図の判断のチケット (`wayfinder:grilling`、`wayfinder:prototype`) が completed で閉じたのに、Decisions so far の行にも解決コメントにも「実施」がない。地図の Notes の「実施の Issue を漏らさない」の規則を確かめます。地図 #23 の、この規則より前に閉じた 11 件は `cli.ts` の `closedBeforeTheRule` で外しています。
- **張り忘れた辺**: 本文の `Blocked by:` の行が名指しする Issue に、ネイティブの辺がない (上の「Wayfinding operations」の **Blocking**)。

規則は `tools/scripts/src/checks/issue-tracker/rules.ts` にあります。
