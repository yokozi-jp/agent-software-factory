---
type: ADR
title: "ADR 0046: 申請と審査を別のモジュールが持ち、モジュールをまたぐイベントのスキーマは送る側の events の package に置き、届く順序は版の比較で守る"
description: サンプル機能（経費精算）の、申請と審査の状態の分け方とイベントの置き場所の決定。申請のモジュールは下書きと明細と申請する操作を、承認のモジュールは申請 1 回ごとの審査（承認待ち、確認待ち、承認済み、差戻し、取下げ）を持ち、取下げは承認の操作にする。イベントのスキーマは送る側のモジュールの packages/<module>/events に置き、events は zod と shared にだけ依存し、モジュールはどの events にも依存できる。申請は状態の写しを (回, 審査の版) で更新し、古いイベントは捨てる。締めは審査だけを読む。標準キューのままで FIFO にしない。申請と審査の持ち分を変えるとき、モジュールをまたぐイベントを足すとき、events の package の依存を変えるとき、イベントの届く順序が逆になる問題を扱うとき、FIFO キューを足したくなったときに読む。
tags: [adr, architecture, modules, events, domain-model, ordering]
---

# ADR 0046: 申請と審査を別のモジュールが持ち、モジュールをまたぐイベントのスキーマは送る側の events の package に置き、届く順序は版の比較で守る

サンプル機能（経費精算）で、申請の状態の正をどのモジュールが持つか、モジュールをまたぐイベントのスキーマをどこに置くか、イベントが逆の順序で届いたときにどうするかを決めました。経緯と決定の詳細は [経費精算の集約とモジュールの境界、モジュール間のイベントを決める](https://github.com/yokozi-jp/agent-software-factory/issues/387) の解決コメントにあります。前提は [申請の状態と操作を決める](https://github.com/yokozi-jp/agent-software-factory/issues/384)、[ADR 0026](0026-modules-as-packages-with-oxlint-boundaries.md)、[ADR 0029](0029-module-data-ownership-and-shared-outbox.md)、[ADR 0041](0041-standard-queue-per-task-with-dlq.md)、[ADR 0042](0042-closing-batch-catches-up-daily-without-locks.md) です。events の package と検査の実装は [Issue #409](https://github.com/yokozi-jp/agent-software-factory/issues/409) で入れました。

## ルール

- **申請と審査の持ち分**:
  - 申請のモジュール（`claim`）は、下書き、明細、申請する操作を持ちます。申請した後は、申請の内容を変えられません。差戻しと取下げのイベントを受けて、再び編集できるようにします。
  - 承認のモジュール（`approval`）は、申請 1 回ごとの**審査**（[用語集](../../GLOSSARY.md)）を持ち、承認待ち、確認待ち、承認済み、差戻し、取下げの正にします。**取下げは承認のモジュールの操作**です。
  - 審査は申請 1 回ごとに 1 つ作り、再申請では新しく作ります。キー `(申請の id, 回)` を一意にして、「申請した」が 2 回届いても 1 つだけにします。
  - 審査の中身は、申請の id、回、申請者、承認する上長、明細の写し、合計、段、承認と確認と差戻しの記録（誰が、いつ、差戻しの理由）です。
  - 段は、承認待ち → 確認待ち → 承認済みです。承認待ちと確認待ちからは、差戻しか取下げで終わります。終わった審査は変わりません。取下げと確認が同時に来たときは、楽観排他で 1 つだけ通します。
  - 「申請した」のイベントには、申請のモジュールが申請のときに人事システムで決めた上長を載せます（[ADR 0045](0045-authorization-policy-in-application-with-permit-token.md)）。
- **申請の状態の写し**: 申請のモジュールが 6 つの状態（下書き、承認待ち、確認待ち、差戻し、承認済み、締め済み）の写しを持ち、申請者の一覧は申請のモジュールだけで返します。申請したときは自分で承認待ちにし、その後は審査と締めのイベントで更新します。取下げのボタンは申請の画面に出し、承認の API を呼びます。写しは結果整合で、確認の直後の数秒は確認待ちが残ってよいものとします。
- **イベントのスキーマの置き場所**:
  - モジュールをまたぐイベントは、依存の向きに関係なく、送る側のモジュールの events の package（`packages/<module>/events`）に置きます。zod のスキーマ、`version`、過去の版の fixture のテストもそこに置きます。
  - events の package は `zod` と `shared` にだけ依存します。モジュールは、どのモジュールの events の package にも依存できます。モジュール本体どうしの依存は、今のとおり「締め → 承認 → 申請」の一方向です。
  - events の package はモジュールではありません。`moduleOrder` に入れず、`type:module` の印を付けません。
  - 申請、承認、締めの events の package と、その依存の検査（repo-policy の `eventsPackages`）は Issue #409 で入れました。
- **届く順序**: 標準キューのままにし、FIFO にしません。
  - 申請のモジュールは、最後に反映した `(回, 審査の版)` を持ち、それより新しいイベントだけを反映します。古いものは何もせずに受け取り済みにします。
  - 締め済みは最後の状態にして、審査のイベントで上書きしません。
  - 申請したときは、申請のモジュールが自分で `(新しい回, 0)` を書きます。審査の版は、楽観排他の版を使います。
  - テストには、順序を逆にして届けるケースと、DLQ から戻すケースを入れます。
- **締めは審査だけを読む**: 締めは審査を読み、CSV の明細と合計は審査の写しから作ります。申請のモジュールとの結合と、その照合（ADR 0042 の結合落ちの検知）はやめます。件数と合計を `batch.stats` とマニフェストに出す部分は残します。確認していない内容が会計システムに渡ることを防ぎます。

## 決定ごとの理由

- **申請と審査を分ける**: 「取下げと確認は両立しない」と「承認と確認の対象は出した内容そのもの」の 2 つの不変条件が、審査の中で閉じます。集約は不変条件の境界にし、外とは結果整合にします（Vaughn Vernon の [Rule: Model True Invariants in Consistency Boundaries](https://www.informit.com/articles/article.aspx?p=2020371&seqNum=2)）。承認という言葉は上長の 1 つの行為を指すので、集約の名前には**審査**を使います。
- **イベントのスキーマを送る側に置く**: 受け手が依存の向きに逆らうたびに、送り手が受け手ごとに行を書き、送り手を直すことになるのを避けます。モジュールが増える先を考えての判断です。kgrzybek/modular-monolith-with-ddd は、各モジュールにイベントの契約だけの `IntegrationEvents` を置き、ほかのモジュールが依存してよいのはそこだけにしています（[3.1 High Level View](https://github.com/kgrzybek/modular-monolith-with-ddd#31-high-level-view)）。Spring Modulith は、モジュールの依存の循環を許しません（[Verifying Application Module Structure](https://docs.spring.io/spring-modulith/reference/verification.html)）。
- **events の依存を zod と shared に限る**: スキーマだけを持つ package が、モジュール本体を引き込むと、依存の向きが崩れます。
- **版の比較で順序を守る**: FIFO は、同じ送り手のメッセージがキューに入った後の順序しか守りません。DLQ から戻したメッセージと、承認と締めという別の送り手の間の順序は、FIFO でも守れません。そのため、版の比較はどちらにしても要ります。FIFO を足すと、送る処理の順序の制御と、処理できない 1 件で同じ申請の後ろが止まる費用だけが残ります。[順序保証](../async/ordering.md)の「順序制御を必要としない設計」に沿います。
- **締めが審査だけを読む**: 承認のモジュールから読んだ申請の id を申請のモジュールで探す結合は、依存の向きに反します。審査が明細の写しを持つので、締めに足りないものはありません。

## Considered Options

- **申請のモジュールが全部を持つ**: 承認のモジュールが空になり、申請のときに上長を決める処理が依存の向きに反します。
- **状態の正は申請に置き、判断をイベントで渡す**: 取下げと確認が別のトランザクションで両方通り、取り下げた申請が締めに入ります。
- **`packages/events` にまとめる**: 何でも入る package になり、どのイベントの変更でも全モジュールが affected になります。
- **受ける側が自分用のスキーマを書く**: スキーマが重複します。
- **`shared` に置く**: サンプル機能を消しても残る package に、サンプル機能の型が入ります。
- **受ける側が定めるメッセージ（EIP の Command Message）**: package は増えません。ただし、依存の向きに逆らう受け手が増えるたびに、送り手が受け手ごとに行を書き、送り手を直します。
- **FIFO キューで順序を守る**: 上の「決定ごとの理由」のとおり、別の送り手の間と DLQ からの戻しの順序は守れません。
- **締めが申請のモジュールと結合して照合する**: 依存の向きに反します。

## Consequences

- 申請の状態の写しは結果整合です。確認の直後は、申請の画面に確認待ちが残ることがあります。
- 審査の版を比べる処理は、イベントを受け取るすべての写しに要ります。
- 審査の集約、各イベントのスキーマ、状態の写しの処理は、サンプル機能の仕様で書きます。イベントのペイロードの契約は [Issue #299](https://github.com/yokozi-jp/agent-software-factory/issues/299) です。
- モジュールを足すときは、events の package も足します（[モジュールを足す手順](../domain-model/add-module.md)）。

## 出典

- Vernon の集約の設計: [Rule: Model True Invariants in Consistency Boundaries](https://www.informit.com/articles/article.aspx?p=2020371&seqNum=2)
- イベントの契約だけを他のモジュールに見せる形: [kgrzybek/modular-monolith-with-ddd](https://github.com/kgrzybek/modular-monolith-with-ddd#31-high-level-view)。モジュールの循環の禁止: [Spring Modulith の Verifying Application Module Structure](https://docs.spring.io/spring-modulith/reference/verification.html)
- 入れ子の events の package が Nx で別の project になること、外側のモジュールの cache の入力に混ざらないこと: このリポジトリで確かめた（2026-10-30、[Issue #409](https://github.com/yokozi-jp/agent-software-factory/issues/409)）
