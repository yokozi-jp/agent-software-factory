---
type: ADR
title: "ADR 0015: タスクの区切りで、エージェントが retro skill を実行する規則を AGENTS.md と docs に置く"
description: retro skill を、利用者が /retro と打つのを待たずに、タスクの区切りでエージェントが実行する規則を、AGENTS.md の短い案内と docs/agents/retro.md に置く決定。上流の skill を変える案、自前の skill、Kiro の hook を選ばなかった理由も書く。振り返りの規則や retro skill の扱いを変えるとき、規則が守られないので hook を足したくなったときに読む。
tags: [adr, agents, skills, retro]
---

# ADR 0015: タスクの区切りで、エージェントが retro skill を実行する規則を AGENTS.md と docs に置く

`retro` skill (mattpocock/skills) は frontmatter に `disable-model-invocation: true` を持ち、利用者が `/retro` と打つ前提で書かれています。打ち忘れると、セッションでの誤りが環境の改善に戻りません。
そこで、タスクの区切りでエージェントが `retro` を実行する規則を、`AGENTS.md` の短い案内と [タスクの区切りでの振り返り](../agents/retro.md) に置きます。
`retro` は改善候補を出すだけで、反映するのは利用者が選んだ候補だけなので、エージェントが自分で実行しても、利用者の知らない変更は入りません。

- **Kiro**: Kiro 2.33.1 は SKILL.md の frontmatter のうち `name`、`description`、`license`、`compatibility`、`metadata` だけを schema に持ち、`disable-model-invocation` を読みません。エージェントは `retro` を skill として読み込めます。足りないのは、いつ実行するかの根拠です。
- **Claude Code**: `disable-model-invocation: true` の skill は、description が context に入らず、Claude が自分では呼べません。規則では、skill として読み込めないときは `.agents/skills/retro/SKILL.md` を読んで手順に従う、とします。このフラグは、エージェントが自分の判断で実行するのを防ぐためのものです。ここでは、いつ実行するかをリポジトリの規則が決めるので、フラグの意図に反しないと判断しました。
- **Codex**: `.agents/skills/retro/agents/openai.yaml` の `allow_implicit_invocation: false` で、暗黙の呼び出しが止まります。Claude Code と同じく、ファイルを読んで手順に従います。

## Considered Options

- **上流の skill から `disable-model-invocation` を外す**: どの実行環境でもエージェントが skill として呼べます。ただ、`.agents/skills/retro` が `skills-lock.json` と一致しなくなり、CI の `Agent skills match skills-lock.json` で止まります。`skills update` でも元に戻ります。
- **自前の skill を足す**: description が毎回 context に入り、区切りの判断を skill に持たせられます。ただ、中身は `retro` の手順と重なり、`AGENTS.md` の 1 行と同じ量の context を使って skill の一覧を 1 つ増やします。これは判断です。
- **Kiro の Stop hook (agent の action) で毎ターン思い出させる**: Stop は毎ターンの終わりに走るので、区切りでないターンにも案内が出ます。
- **Kiro の PostToolUse hook で、`gh pr create` の後に案内を出す**: 区切りの 1 つを確実に捉えられますが、Kiro でしか効きません。[#23](https://github.com/yokozi-jp/agent-software-factory/issues/23) の前提で、`AGENTS.md`、skill、docs はほかの実行環境でも使える形に保つので、規則を正本にします。規則が守られないと分かったら、この hook を足すことを、この ADR を直して決めます。
- **今までどおり利用者が `/retro` と打つ**: 打ち忘れたセッションの誤りが残ります。

## Consequences

- 区切りごとに改善候補の提示が入り、利用者が選ぶ手間が増えます。
- 振り返りの反映は、元のタスクとは別の PR になります。
- 規則が守られたかを確かめる検査はありません。守られないと分かったら、上の Kiro の hook を検討します。
- 規則は `retro` skill を読み込むだけなので、上流で skill の手順が変わっても、規則を直さずに済みます。

## 出典

- Kiro が読む SKILL.md の frontmatter: Kiro 2.33.1 のエンジン (`~/.local/share/kiro-cli/kas/<版>/node_modules/@kiro/agent/dist/server/acp-server.js`) の skill の schema (`name`、`description`、`license`、`compatibility`、`metadata`)。`disable-model-invocation` を読むコードはない
- `disable-model-invocation: true` の skill は Claude が自分で呼べず、description も context に入らないこと: [Claude Code の Skills](https://code.claude.com/docs/en/skills) ("Control who invokes a skill")
- `allow_implicit_invocation: false` で、Codex が暗黙には呼ばず、明示した呼び出しだけが効くこと: [Codex の Build skills](https://learn.chatgpt.com/docs/build-skills)
