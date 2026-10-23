---
type: Convention
title: "設計ドキュメントの図とシステム構成図"
description: "設計ドキュメントの図を何で作るか (PlantUML/Mermaid.js、diagrams.net) を定める文書。構成図やシーケンス図を設計書に載せるときに読む。"
tags: [markdown-design-docs, convention, diagram, plantuml]
sources:
  - resource: https://future-architect.github.io/arch-guidelines/documents/forMarkdown/markdown_design_document.html
    title: Markdown設計ドキュメント規約
    author: フューチャー株式会社
---

# 設計ドキュメントの図とシステム構成図

図は Git と差分の相性が良い PlantUML (テーマは `toy`) または Mermaid.js で作る。
システム構成図などは PlantUML で対応しにくいため diagrams.net (draw.io) で作り、拡張子は `.drawio.png`、`.drawio.jpg`、`.drawio.svg` のいずれかにする。
出典は [Markdown設計ドキュメント規約](about.md) (CC BY 4.0) で、OKF の形式に合わせて分割、変更している。

## システム構成図

図は基本的に変更差分がGitと相性が良い、PlantUML（またはMermaid.js）で作成すること。PlantUMLの場合、テーマは `toy` を指定すること。

```plantuml
@startuml
!theme toy

participant Participant as Foo
note over Foo: Event
actor       Actor       as Foo1
boundary    Boundary    as Foo2
control     Control     as Foo3
entity      Entity      as Foo4
database    Database    as Foo5
collections Collections as Foo6
queue       Queue       as Foo7
Foo -> Foo1 : To actor
Foo -> Foo2 : To boundary
Foo -> Foo3 : To control
Foo -> Foo4 : To entity
Foo -> Foo5 : To database
Foo -> Foo6 : To collections
Foo -> Foo7: To queue

@enduml
```

システム構成図などは上記では対応しにくいことが多いため、diagrams.net（draw.io）で作成する。

diagrams.netの場合は、拡張子は以下のいずれかで作成する。

- `.drawio.png`
- `.drawio.jpg`
- `.drawio.svg`
