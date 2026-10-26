---
type: Convention
title: steering の書き方
description: .kiro/steering/ のファイルの frontmatter (inclusion、name、description、fileMatchPattern) と、本文の 1 行の形式を定める規約。steering を追加、変更するときに読む。
tags: [knowledge, convention, steering]
---

# steering の書き方

`.kiro/steering/` のファイルには、`docs/` の文書へのポインタだけを書きます。
内容は `docs/` に書き、steering には「いつ」「どの文書を」読むかを書きます ([役割分担](knowledge-architecture.md))。
frontmatter で読み込み方を決め、repo-policy (`tools/scripts/src/checks/repo-policy/cli.ts`) (pre-commit と CI) が検査します。

## frontmatter

すべてのファイルに `inclusion`、`name`、`description` を書きます。
この節の動きは Kiro CLI のエンジン (KAS) 2.32.0 で確かめました。Kiro を更新したら、`~/.local/share/kiro-cli/kas/<版>/node_modules/@kiro/agent/dist/server/acp-server.js` の `inclusion:A.enum` で、値と扱いが変わっていないかを確かめます。

```yaml
---
inclusion: fileMatch
fileMatchPattern: ["**/{Dockerfile,Dockerfile.*,*.Dockerfile,*.dockerfile}", "**/.dockerignore"]
name: container
description: Dockerfile や .dockerignore を新規作成または編集するときに、どの docs の規約を読むかを示す。
---
```

- `inclusion`: 次から選びます。

  | 値          | 読み込まれ方                                                | 使うとき                                      |
  | ----------- | ----------------------------------------------------------- | --------------------------------------------- |
  | `fileMatch` | 作業中のファイルが `fileMatchPattern` に一致したとき        | 特定のファイルを作成、編集するときの規約      |
  | `auto`      | 毎回 `description` だけを読み込み、必要になったら本文を読む | ファイルと結び付かない作業 (調査、運用の手順) |
  | `always`    | 毎回、本文まで読み込む                                      | どの作業でも必ず必要なもの                    |
  | `manual`    | `/context add` で足したときだけ                             | ほとんど使わないもの                          |

  `always` と `manual` は使いません。`always` は毎回、本文まで読み込むので文脈を圧迫します。`manual` は人が `/context add` で足したときだけ読まれ、自律実行 (Kiro Web や ready-for-agent の Issue を進めるエージェント) では読まれません。

  Kiro Web は、リポジトリに commit した `.kiro/steering/` を Kiro CLI と同じエンジンで読みます。`always`、`auto`、`fileMatch` は CLI と同じに効きます ([Introducing Kiro Web](https://kiro.dev/blog/introducing-kiro-web/)、KAS 2.34.0 の `parseSteeringFile` と `matchDocumentsForFile`)。Kiro Web に専用の書き方はありません。Kiro Web の設定画面からアップロードした steering は、`auto` を持たない別のスキーマで読まれる可能性があります。確かめていないので、steering はリポジトリに commit します。

- `name`: ファイル名から `.md` を除いたものにします。
- `description`: 「いつ」「どの docs を読むかを示すか」を書きます。`auto` では、この 1 行で読むかどうかが決まります。
- `fileMatchPattern`: `inclusion: fileMatch` のときだけ、1 行の配列で書きます。複数のパターンは配列の要素に分けるか、`{a,b}` のブレースで書きます。パターンの中のカンマは「または」と解釈されません。

## 本文

- 1 つのファイルに 1 つの領域を書きます。ファイル名は領域の名前にします (例: `external-docs.md`)。
- 本文は H1 と、次の形式の行だけにします。

  ```markdown
  <いつ読むか>は、`docs/<領域>/<文書>.md` を読む。
  ```

- 「いつ読むか」は、作業や状況を先頭に書きます (例:「AWS や Hono のドキュメントを web で調べるとき」)。
- 1 つの行には 1 つの状況だけを書きます。同じ状況の言い換えは足しません。
