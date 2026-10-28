# 締めのワークフロー（EventBridge Scheduler → Step Functions → ECS RunTask）を、ローカルと CI で試す方法を調べる

## 問い

[Issue #349](https://github.com/yokozi-jp/agent-software-factory/issues/349) の調査。締めのバッチは ECS のタスクだけで動かし、EventBridge Scheduler が Step Functions を起動し、Step Functions が ECS の RunTask を呼ぶ（ADR 0013）。この流れを、ローカルと CI でどう試せるかを一次資料で調べる。[#354](https://github.com/yokozi-jp/agent-software-factory/issues/354) が前提にする事実を集める。

- Step Functions Local の今の扱い（サポートの状況、最新の機能への追従）と、TestState API、AWS SAM や CDK の試験の手段。
- ステートマシンの定義（ASL）の検査: 構文、到達できない状態、`Retry` と `Catch`。CDK の assertions でどこまで確かめられるか。
- ECS RunTask の `.sync` の連携で、タスクの終了コードや失敗がステートマシンにどう伝わるか。途中からの再開（redrive）を Step Functions がどう扱うか。
- `docs/batch/test.md` の「ワークフローエンジンの実装は減らし、ロジックは関数に分ける」との関係。ローカルではワークフローを通さずにジョブを直接起動する形が標準か。

決定は下さず、比較と、決めるべき論点で終える。

調べた日は 2026-10-29。AWS アカウントはまだないので、AWS の上ではなにも実行していない。実際に動かしたのは、`/tmp` に入れた `aws-cdk-lib` 2.275.0 での synth と assertions、`asl-validator` 4.0.0 での検査だけで、`node_modules` はリポジトリの中に作っていない。「確かめた」と書いたものは、文書、ソース、この手元の実行で確かめたこと。「判断」と書いたものは、私の見立てである。

## 要約

- Step Functions Local: AWS の文書の冒頭に「機能の同等性がなく、サポート対象外（unsupported）」とあり、代わりに TestState API を勧めている。最後の版は 2.0.0（ビルド 2024-05-18）で、Docker Hub の `amazon/aws-stepfunctions-local` の最終更新も同じ日。2026-10-29 までの 2 年 5 か月、版が出ていない。
- TestState API: 2025-11 に強化された。モック（`--mock`）で結果とエラーを差し込め、Map、Parallel、`.sync`、`.waitForTaskToken` も試せる。`stateName` で完全な定義の中の 1 つの状態を指定でき、`stateConfiguration.retrierRetryCount` で `Retry` の何回目かを指定できる。追加の料金はない。ただし既定では AWS の本物のエンドポイントを呼ぶので、CI には AWS の認証が要る。LocalStack が同じ API を提供する。
- ASL の検査: AWS の `ValidateStateMachineDefinition` API は構文を検査し、`WARNING` で静的解析の診断（`NO_DOLLAR` など）も返す。到達できない状態は、この API の文書に例がなく、`asl-validator` 4.0.0 で `Orphan` 状態を検出できたことを手元で確かめた。`States.ALL` が `Retry` の最後にない誤りは、`asl-validator` では検出できなかった（AWS の文書では、これは誤りと書かれている）。
- CDK の assertions: `DefinitionString` は `Fn::Join` になり、`Match.serializedJson` は使えない（手元で失敗を確かめた）。`Fn::Join` の中の文字列片を `Match.stringLikeRegexp` などで見るか、`Ref` を置き換えて JSON にしてから検査する。`Retry` と `Catch` の中身の検査は、後者のほうが書きやすい。
- `.sync` と redrive: `ecs:runTask.sync` は、タスクが止まるまで待つ。`Failures` が空でないと `AmazonECS.Unknown` で失敗する（文書）。コンテナの終了コードの扱いは、一次資料の文書に書かれたものを見つけられなかった。第三者の例は、エラー名が常に `States.TaskFailed` で、終了コードは `Cause` の文字列の中にあると書く。redrive は Standard の失敗、中断、タイムアウトの実行を、失敗した状態からやり直す。Task 状態は新しく起動し直すので、ECS のタスクがもう 1 つ走る。

## ADR 0013 と docs の食い違い

| docs の記述                                                                                                                                                                    | 一次資料                                                                                            | 扱い                                                                                                                                                        |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/batch/test.md`: 「ワークフローエンジンの実装は、一般にテストコードによる UT が困難」                                                                                     | 2025-11 の TestState API の強化で、Step Functions の定義の状態を単体で、モック付きで、CI から試せる | Step Functions に限っては、前提が古くなった。「ロジックは関数に分ける」の方針自体は、今も有効（「`docs/batch/test.md` との関係」の節）。docs は直していない |
| `docs/batch/workflow-engine.md`: 依存関係がなければ EventBridge Scheduler から直接 ECS を起動する構成（1）を推奨し、将来の依存が分かっているときだけ Step Functions（2）を使う | ADR 0013 は Step Functions を経由する構成に決めている                                               | 食い違いというより、ADR が docs の推奨と別の選択をしている。理由が ADR に書かれているかは、ADR 0013 の該当行（20 行目）には見当たらない。#354 で触れる候補  |
| `docs/batch/workflow-engine.md` の比較表: リランは「Step Functions のステートマシンを再実行する」                                                                              | 再実行（新しい実行）と redrive（同じ実行の続き）がある                                              | 区別が docs にない。「redrive」の節                                                                                                                         |
| docs に Step Functions Local、TestState、redrive の記述はない（`grep` で確認）                                                                                                 | 同上                                                                                                | 空白                                                                                                                                                        |

## Step Functions Local

### 確かめたこと

- 文書の冒頭: 「Step Functions Local does not provide feature parity and is unsupported」。サードパーティのエミュレータを検討するか、TestState API を使うよう書かれている（[Testing state machines with Step Functions Local (unsupported)](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local.html)）。
- 最終の版は `2.0.0`、ビルド 2024-05-18（同じ文書の `java -jar StepFunctionsLocal.jar -v` の出力）。Docker Hub の API で、`latest` と `2.0.0` のタグの更新日が 2024-05-18、その前が `1.14.0`（2024-03-27）だった（[Docker Hub](https://hub.docker.com/r/amazon/aws-stepfunctions-local)、API で確認）。
- 呼び先のエンドポイントとして、Lambda、Batch、DynamoDB、ECS、Glue、SageMaker、SQS、SNS、Step Functions を設定できる（同じ文書の設定の表）。`--ecs-endpoint` があるので、ECS の RunTask を、本物の ECS ではなく別のエンドポイントに向けることはできる。
- 既定では、ローカルのテスト用アカウントとリージョン `us-east-1` を使う。ロールの ARN は使われないが、書式の通りの値が要る（同じ文書）。
- モック設定ファイル（`MockConfigFile.json`）で、状態ごとに、テストケースごとの戻り値とエラーを決められる。モックはサービスの本当の API と同じ形かを検査しない（[Testing with mocked service integrations](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local-test-sm-exec.html)）。

### 判断

- 2 年 5 か月版が出ていないものに、その後に加わった ASL の機能（JSONata、`Arguments` など）への追従は期待できない。ただし、JSONata の対応を Local が持つかは確かめていない（「確かめられなかったこと」）。
- 新しく採用する理由は薄い。AWS 自身が、代わりに TestState API を示している。

## TestState API

### 確かめたこと

- 2025-11 に強化された。モック、全部の状態の種類、`stateName` による 1 つの状態の指定が加わった（[AWS Blog](https://aws.amazon.com/blogs/aws/accelerate-workflow-development-with-enhanced-local-testing-in-aws-step-functions/)、[TestState の文書](https://docs.aws.amazon.com/step-functions/latest/dg/test-state-isolation.html)）。
- モックは `result`（成功の出力）か `errorOutput`（`error` と `cause`）のどちらか。両方を渡すと検証エラー。`fieldValidationMode` は `STRICT`（既定）、`PRESENT`、`NONE`。HTTP Task、API Gateway、EKS では、モックの検証は使えない（文書）。
- `.sync`、`.waitForTaskToken`、Activity、Map、Parallel は、モックを付けたときだけ試せる。モックなしで呼ぶと検証エラーになる。`.sync` のモックは、ポーリングする API の応答の形（例: `startExecution.sync:2` なら `DescribeExecution`）に合わせる（文書）。ECS の `runTask.sync` では、ポーリングの API がどれかを文書で確かめていない。
- `stateConfiguration.retrierRetryCount` で `Retry` の何回目かを指定でき、応答の `inspectionData.errorDetails` に `retryBackoffIntervalSeconds`、`retryIndex`、`catchIndex` が入る。`status` は `SUCCEEDED`、`FAILED`、`RETRIABLE`、`CAUGHT_ERROR`。`nextState` が次の状態の名前（文書、[Compute Blog](https://aws.amazon.com/blogs/compute/testing-step-functions-workflows-a-guide-to-the-enhanced-teststate-api/)）。
- `context` で `$$.Execution.Id`、`$$.State.Name` などの値を渡せる。
- 料金は追加なし。全リージョンで使える（AWS Blog）。コンソールの TestState は、モックと `.sync` の試験にまだ対応していない。CLI か SDK で呼ぶ（文書）。
- 既定では AWS の本物のエンドポイントに対して実行される。LocalStack のエンドポイント（`http://localhost.localstack.cloud:4566/`）に向けると、ネットワークから切り離して試せる（Compute Blog）。モックを使うときは、実行ロールが不要になる（AWS Blog）。ただし AWS API を呼ぶ認証は、LocalStack でない限り要ると考えられる（判断）。
- 試験の枠組みは任意で、Jest、pytest、JUnit で書ける（AWS Blog）。AWS の例は Python の pytest で、`.github/workflows` の CI の中で単体試験を流してから `sam deploy` する形（Compute Blog）。

### 判断

- 締めのワークフローは「RunTask.sync → 失敗なら通知して Fail」程度の小さい定義になるはずで、TestState は 3 つの観点（成功で次の状態へ進む、`Retry` が効く、`Catch` が通知の状態へ進む）を、モック付きで確かめるのに足りる。
- TestState は 1 つの状態ごとに呼ぶので、「状態をつないだ実行全体」の試験は、自分で `nextState` と `output` をつなぐ必要がある（Compute Blog の `get_output()` の例）。
- ECS のタスクが本当に走るか、IAM と network の設定が正しいかは、TestState では確かめられない。これは別の層（検証環境の E2E、[#88](https://github.com/yokozi-jp/agent-software-factory/issues/88)）の仕事になる。

## SAM と CDK での試験

### 確かめたこと

- SAM: Step Functions Local を、`sam local start-lambda` の Lambda と組み合わせる手順が文書にある。ただし文書は Step Functions Local が unsupported と書く（[Tutorial: Testing workflows using Step Functions and AWS SAM CLI Local](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local-lambda.html)）。この構成の ECS のタスクは Lambda ではないので、`sam local` で起動する対象にならない。
- SAM は `AWS::Serverless::StateMachine` で状態機械を書ける（[Using AWS SAM to build Step Functions workflows](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-sam-sfn.html)）。ただし ADR 0013 は IaC に CDK を選んでおり、SAM を足す理由は見つからなかった。
- cfn-lint には、`AWS::StepFunctions::StateMachine` の定義を検査するルール `E3601` がある。実装は JSON Schema に基づく（[ソース](https://github.com/aws-cloudformation/cfn-lint/blob/main/src/cfnlint/rules/resources/stepfunctions/StateMachineDefinition.py)）。到達できない状態を検査するかは、ソースを最後まで読んでいない。
- CDK: `EcsRunTask`（`aws-stepfunctions-tasks`）に `integrationPattern: RUN_JOB` を渡すと `ecs:runTask.sync` になる。`taskTimeout`、`addRetry`、`addCatch` がある。`taskTimeout` を付けない場合、`TimeoutSeconds` は定義に出ない（手元の synth で確認）。

### 判断

- 「SAM CLI で状態機械を手元で試す」道は、Step Functions Local の扱いが unsupported であることと、CDK を使うことから、この構成では選択肢にならない。

## ASL の検査

### 検査の層

| 層  | 道具                                                                                               | 構文                    | 到達できない状態 | `Retry` と `Catch` の規則                     | AWS の認証                  |
| :-- | :------------------------------------------------------------------------------------------------- | :---------------------- | :--------------- | :-------------------------------------------- | :-------------------------- |
| 1   | `ValidateStateMachineDefinition` API（CLI: `aws stepfunctions validate-state-machine-definition`） | 検査する                | 文書に例なし     | `WARNING` の診断の一部                        | 要る                        |
| 2   | `asl-validator` 4.0.0（npm、手元で実行）                                                           | 検査する                | 検出した         | 一部のみ（下記）                              | 不要                        |
| 3   | cfn-lint の `E3601`                                                                                | 検査する（JSON Schema） | 未確認           | 未確認                                        | 不要                        |
| 4   | CDK の assertions                                                                                  | 定義の文字列の形で見る  | 自分で書く       | 自分で書く                                    | 不要                        |
| 5   | TestState API                                                                                      | 1 つの状態の動き        | 範囲外           | 動きを確かめる（`RETRIABLE`、`CAUGHT_ERROR`） | 要る（LocalStack なら不要） |

### 確かめたこと

- `ValidateStateMachineDefinition`: 結果は `OK` か `FAIL`。`severity: WARNING` を渡すと、`NO_DOLLAR`、`PASS_RESULT_IS_STATIC`、`NO_PATH` などの警告も返す。文書は CI や pre-commit での利用を挙げ、診断の数や文言は変わりうるので `result` だけを頼るよう書く（[API reference](https://docs.aws.amazon.com/step-functions/latest/apireference/API_ValidateStateMachineDefinition.html)）。
- `asl-validator` 4.0.0 で、次を手元で確かめた（CDK で作った `EcsRunTask` 入りの定義に、1 つずつ誤りを足した）。

  | 誤り                                           | 結果                                                                                 |
  | :--------------------------------------------- | :----------------------------------------------------------------------------------- |
  | 誤りなし                                       | `isValid: true`                                                                      |
  | どこからも辿れない状態 `Orphan` を足す         | `State Orphan is not reachable`                                                      |
  | `Catch` の `Next` を存在しない名前にする       | `Missing 'StartAt'\|'Next'\|'Default' target: Nowhere` と、`Failed` が到達できない旨 |
  | `Retry` の `MaxAttempts` を `-1` にする        | `must be >= 0`                                                                       |
  | `States.ALL` を `Retry` の最後でない位置に置く | **検出しない**（`isValid: true`）                                                    |

- 最後の行について、AWS の文書は、`States.ALL` は単独で、`Retry` と `Catch` の配列の最後の要素に置くと書く（[Handling errors](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)）。実際に AWS がこの定義を拒否するかは、AWS 上で試していない。
- `States.TaskFailed` は、`States.Timeout` 以外のすべてのエラーに合う。`States.ALL` は `States.DataLimitExceeded` と `States.Runtime` に合わない（同じ文書）。

### CDK の assertions でできること

手元で、`EcsRunTask` に `addRetry`、`addCatch`、`taskTimeout` を付けた stack を `Template.fromStack` した。

- `DefinitionString` は `{"Fn::Join": ["", [...]]}` になる。文字列の片と `Ref`、`Fn::GetAtt` が交互に並ぶ。
- `Match.serializedJson(...)` は、「Expected JSON as a string but found object」で失敗した。この形の定義には使えない。
- `{ DefinitionString: { 'Fn::Join': ['', Match.arrayWith([Match.stringLikeRegexp('ecs:runTask.sync')])] } }` は通った。これで `.sync` の指定は確かめられる。ただし `Retry` の中身の細かい一致は、文字列片をまたぐので書きにくい。
- `Fn::Join` の文字列でない要素を `aws` などの文字に置き換えて `JSON.parse` し、オブジェクトとして検査する方法が書きやすい。この方法で上の `asl-validator` にも渡せた。
- 判断: `Retry` と `Catch` の検査は、置き換えた JSON に対して、状態の名前ごとの期待値（`ErrorEquals`、`MaxAttempts`、`Next`）を書くのがよい。置き換えるコードは、すべての `Ref` を同じ文字に変えるので、`Cluster` や `TaskDefinition` の値の検査はできなくなる。それは別の assertion（`Fn::Join` の要素や `AWS::ECS::TaskDefinition` のリソース）で見る。

## ECS RunTask の `.sync` の連携

### 確かめたこと（文書）

- ECS/Fargate の `.sync` は Standard で対応し、Express は対応しない（[Integrating services](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)）。
- `ecs:runTask` は HTTP 200 で `Failures` が空でないことがある。Request Response では、応答を返してタスクは失敗にしない。`.sync` と `.waitForTaskToken` では、`AmazonECS.Unknown` でタスクを失敗にする（[ECS/Fargate の連携](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html)）。
- 同じ場所の IAM の項に、`TaskId` が提出されるまで分からないので、Step Functions が `Resource: "*"` の方針を作るとある。止められるのは、Step Functions が起動したタスクだけ。タスク実行ロール、タスクロールがある場合は、呼び出し側に `iam:PassRole` が要る。
- `.sync` の同一アカウントでは、EventBridge のイベントと、指定した API のポーリングで監視する。実行が停止されたり、`Parallel` の別の枝や `Map` の反復が捕捉されないエラーで失敗したりすると、Step Functions はタスクの取り消しを試みるが、取り消せないことがあり、その場合は連携先のサービスに費用が出る（Integrating services）。
- ECS の連携の文書の `Failures` 以外に、「コンテナの終了コードが 0 でないときに何のエラー名で失敗するか」は、見つけられなかった。

### 第三者の資料（一次資料ではない）

- [mcattarinussi/step-functions-runtask-retry](https://github.com/mcattarinussi/step-functions-runtask-retry): `essential` なコンテナの 1 つが止まるまで待つ。失敗したときのエラー名は常に `States.TaskFailed`。理由は `Cause` の文字列を読んで終了コードを取るしかない。
- [aws-samples/retryable-ecs-run-task-step-functions](https://github.com/aws-samples/retryable-ecs-run-task-step-functions)（AWS のサンプル）: `ResourceInitializationError`、`CannotPullContainerError` など、RunTask の応答に出ない一時的な失敗は、`.sync` の結果に停止の理由とコンテナの終了コードが入って返る。それを見て Lambda が再試行するか判断する例。
- 判断: 締めのバッチでは、「コンテナが非 0 で終わったら実行を失敗にする」ことが要る。上の資料はそう動くことを示唆するが、AWS の文書の文言で裏を取れていない。検証環境の E2E で、非 0 の終了と、非 essential なコンテナの異常終了を 1 回ずつ流して確かめるべき（「確かめられなかったこと」）。

### 試験への影響

- TestState の `errorOutput` で `States.TaskFailed` や `AmazonECS.Unknown` を差し込み、`Retry`、`Catch` の動きを確かめられる。これは「Step Functions がエラーをどう扱うか」の試験で、「ECS が非 0 をどう報告するか」の試験ではない。後者は本物の ECS が要る。
- `Retry` を付けるなら、ジョブが冪等であること（`docs/batch/test.md` の冪等性の観点）が前提になる。

## redrive

### 確かめたこと（文書）

- redrive は、Standard の、失敗、中断、タイムアウトの実行を、同じ入力、同じ実行 ARN、同じ定義で、失敗した状態から続ける。成功済みの状態は再実行しない（[Restarting state machine executions with redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html)）。
- 条件: 2023-11-15 以降に始めた実行、`SUCCEEDED` でない、終了から 14 日以内、開いてから 1 年以内、イベント履歴が 24,999 件未満。
- Task 状態: もう一度スケジュールして起動する。`TimeoutSeconds` は 0 に戻る。`Retry` の試行回数も 0 に戻り、最大回数まで再試行できる。状態機械全体の `TimeoutSeconds` も 0 に戻る。
- 状態機械の定義を変えた後は、redrive できない。新しい実行を始める。
- API は `RedriveExecution`、CLI は `aws stepfunctions redrive-execution`。IAM は `states:RedriveExecution` が要る。redrive も状態の遷移として課金される。
- EventBridge Scheduler が起動した実行も Standard の実行なので、条件を満たせば redrive できる（判断。Scheduler の文書は読んでいない）。
- `docs/batch/workflow-engine.md` の比較表にある「Step Functions のステートマシンを再実行する」は、新しい実行を始めることとも、redrive とも読める。

### 判断

- 締めのバッチの失敗は、`Task`（RunTask）で起きる。redrive は ECS のタスクを新しく 1 つ起動し直す。ジョブが「同じ営業日の締めを 2 回起動されても結果が同じ」（冪等）でなければ、redrive は安全に使えない。
- 営業日（`docs/batch/business-date.md`）が実行の入力に入っている場合、redrive は同じ入力で続けるので、日付がずれない。入力を現在時刻から作る設計だと、新しい実行はずれる。この点を確かめるには、締めのジョブの入力をどう作るかが決まる必要がある（#354）。
- redrive を試験する手段は、TestState にない。TestState は 1 つの状態の動きを見るだけで、実行の履歴の続きを扱わない（文書にその記述がない）。redrive は検証環境で本物の失敗を作って試すことになる（判断）。

## `docs/batch/test.md` との関係

### 確かめたこと

- `test.md` の単体テストの観点: 「ワークフローエンジンでの実装（分岐やロジック）は可能な限り減らす。一般に、ワークフローエンジンの実装はテストコードによる UT が困難なため。どうしても実装が必要な場合は function として分離し、テストコードによる UT 可能な構成とする」。出典は Future Architect のバッチ設計ガイドライン（2023〜2025 年）。
- ADR 0013: 業務の処理は共通のコードにし、実行する場所の違いは入口のファイルで吸収する（ADR 0007 の方針の拡張）。

### 判断

- 2 つの方針は両立する。ワークフローには「どのジョブを、どの順で、失敗したらどうするか」だけを書き、業務の判断はジョブのコード（ECS のタスクの中）に置く。その上で、ワークフローの定義も TestState で単体試験できるので、「ワークフローは試せないから薄くする」という理由は弱くなった。「薄く保つ」理由は、別の観点（定義が増えると、冪等性と redrive の考慮が増える）に移る。
- ローカルでジョブを直接起動する形が標準かは、一次資料に「標準」と書かれたものはない。AWS の文書が示すのは、TestState によるワークフローの単体試験と、ECS のタスクをコンテナとして直接動かすこと（コンテナの標準的な使い方）だけ。ジョブを `node` や `docker run` で直接起動できることは、ADR 0013 の「ECS では 1 つのコンテナイメージ」から導ける（判断）。

## 試験の層の比較

| 層                                        | 確かめられること                                                     | 確かめられないこと                    | AWS の認証 | 費用                                                                            | 実行の目安 |
| :---------------------------------------- | :------------------------------------------------------------------- | :------------------------------------ | :--------- | :------------------------------------------------------------------------------ | :--------- |
| ジョブを直接起動（`node`、`docker run`）  | 業務のロジック、終了コード、冪等性、0 件                             | ワークフロー、IAM、network            | 不要       | なし                                                                            | 数秒〜     |
| CDK の assertions（synth だけ）           | `.sync` の指定、`Retry`、`Catch`、`TimeoutSeconds`、IAM の方針の有無 | 実行時の動き                          | 不要       | なし                                                                            | 数秒       |
| `asl-validator`（または cfn-lint）        | 構文、到達できない状態、遷移先の不足                                 | 実行時の動き、一部の規則              | 不要       | なし                                                                            | 1 秒未満   |
| `ValidateStateMachineDefinition`          | AWS の構文検査と静的解析の警告                                       | 実行時の動き                          | 要る       | なし                                                                            | 数秒       |
| TestState（モック、AWS のエンドポイント） | 1 状態の入出力、`Retry` と `Catch` の遷移、`Next`                    | 状態をつないだ実行、ECS、redrive      | 要る       | 追加なし                                                                        | 数秒       |
| TestState（LocalStack）                   | 同上、ネットワークなし                                               | 同上。LocalStack の追従の程度は未確認 | 不要       | LocalStack の条件による                                                         | 数秒       |
| Step Functions Local                      | モックでの実行全体の経路                                             | unsupported。新機能に追従しない       | 不要       | なし                                                                            | 数秒       |
| 検証環境の E2E（#88）                     | ECS の起動、非 0 の終了、IAM、Scheduler からの起動、redrive          | なし（費用と時間が大きい）            | 要る       | 1 回およそ 0.5 ドル（ブランチ `research/verification-env-cd` の調査の見積もり） | 数十分     |

## 決めるべき論点

[#354](https://github.com/yokozi-jp/agent-software-factory/issues/354) で決める候補。決定は下していない。

1. 状態機械の試験に TestState を使うか。使う場合、CI から AWS の API を呼ぶか（OIDC のロールと `states:TestState` の権限が要る）、LocalStack に向けるか、`asl-validator` と CDK の assertions だけにして TestState は検証環境の E2E に回すか。
2. ASL の静的検査を、`asl-validator`（AWS の認証が不要。`States.ALL` の位置などは検出しない）、`ValidateStateMachineDefinition`（認証が要る。到達できない状態の検出は未確認）、両方、のどれにするか。
3. CDK の assertions で、どこまでを固定するか。例: `.sync` の指定、`TimeoutSeconds` の有無、`Retry` の対象のエラー、`Catch` の行き先。細かく固定すると、定義を変えるたびに試験を直す。
4. `taskTimeout`（`TimeoutSeconds`）を必須にするか。付けないと、ECS のタスクが固まったとき、実行が最長 1 年まで待つ可能性がある（実行の上限は文書の 1 年。`.sync` の既定のタイムアウトは文書で確かめていない）。
5. `Retry` を付けるか。付ける場合、対象のエラー（`States.TaskFailed` 全部か、`AmazonECS.Unknown` や ECS の一時的な失敗だけか）と、ジョブの冪等性の保証（`docs/batch/test.md`）。
6. redrive を運用の手順にするか、新しい実行を始める手順にするか。前者なら、ジョブが同じ営業日の入力で再度起動されて安全か、入力に営業日を入れるかを決める必要がある。redrive の条件（14 日以内、定義を変えていない）を運用手順に書くか。
7. コンテナの終了コードと実行の失敗の対応を、検証環境の E2E の必須の観点にするか（「確かめられなかったこと」の 1 つ目）。
8. ローカルの標準を「ジョブを直接起動」にするなら、その入口（`docs/batch/test.md` の観点との対応）と、ワークフローの定義の試験の置き場所（`apps/` のどこか、`infra` のどこか）。
9. `docs/batch/test.md` の「ワークフローエンジンの UT が困難」と `docs/batch/workflow-engine.md` の Scheduler 直接起動の推奨を、この調査を受けて直すか（docs の取り込みの規則により、`about.md` の「原文からの変更点」に書く対象）。この調査では直していない。
10. EventBridge Scheduler の起動から Step Functions の実行までの経路（Scheduler のターゲット、リトライ、DLQ）の試験を、この調査の外として別に扱うか。この調査では読んでいない。

## 確かめられなかったこと

- AWS の上での実行はすべて未実行。AWS アカウントがない。TestState、`ValidateStateMachineDefinition`、`ecs:runTask.sync` の実際の応答は、文書とブログの例からの理解で、手元で呼んでいない。
- ECS のコンテナが非 0 で終了したときの `.sync` の実際のエラー名と `Cause` の中身、`essential` でないコンテナが異常終了したときの扱い。AWS の文書で見つけられず、第三者の資料だけ。
- ECS の `runTask.sync` が、どの API をポーリングするか。TestState の `.sync` のモックの形（`DescribeTasks` の形か）。
- `.sync` の `TimeoutSeconds` がないときの既定の待ち時間。
- Step Functions Local が JSONata と `Arguments` に対応するか。2.0.0 のリリースノートを見つけられなかった。
- AWS が `States.ALL` を `Retry` の最後以外に置いた定義を、本当に拒否するか。
- `ValidateStateMachineDefinition` が到達できない状態を診断するか。
- cfn-lint の `E3601` が到達できない状態、`Retry` と `Catch` の規則を検査するか、`Fn::Join` の `DefinitionString` を解決して検査するか。`sam validate --lint` が cfn-lint を使うことも、文書で確かめていない。
- LocalStack の TestState の実装が、AWS の本物とどこまで同じか。ライセンス、費用、CI での使い方。
- TestState を CI から呼ぶときに要る IAM の権限の最小の形（文書にある `states:TestState` と、モックなしの場合の `iam:PassRole` だけを確認した）。
- redrive が、EventBridge Scheduler が起動した実行に対して、実際に使えること。redrive 後に、ECS の前のタスクが残っていた場合の挙動。
- EventBridge Scheduler の文書（ターゲット、リトライ、DLQ）。この調査では読んでいない。
- `aws-cdk-lib` の `EcsRunTask` のソースと README のうち、`.sync` の失敗の扱いに触れる記述。README の `RUN_JOB` の例は読んだが、終了コードの記述はなかった。

## 出典

- [Testing state machines with Step Functions Local (unsupported)](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local.html)
- [Testing with mocked service integrations](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local-test-sm-exec.html)
- [Tutorial: Testing workflows using Step Functions and AWS SAM CLI Local](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local-lambda.html)
- [Docker Hub: amazon/aws-stepfunctions-local](https://hub.docker.com/r/amazon/aws-stepfunctions-local)（API で版と更新日を確認）
- [Testing state machines with TestState API](https://docs.aws.amazon.com/step-functions/latest/dg/test-state-isolation.html)
- [Accelerate workflow development with enhanced local testing in AWS Step Functions](https://aws.amazon.com/blogs/aws/accelerate-workflow-development-with-enhanced-local-testing-in-aws-step-functions/)
- [Testing Step Functions workflows: a guide to the enhanced TestState API](https://aws.amazon.com/blogs/compute/testing-step-functions-workflows-a-guide-to-the-enhanced-teststate-api/)
- [ValidateStateMachineDefinition](https://docs.aws.amazon.com/step-functions/latest/apireference/API_ValidateStateMachineDefinition.html)
- [Handling errors in Step Functions workflows](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
- [Integrating services with Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)
- [Run Amazon ECS or Fargate tasks with Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html)
- [Restarting state machine executions with redrive in Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html)
- [Using AWS SAM to build Step Functions workflows](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-sam-sfn.html)
- [cfn-lint のルール一覧](https://github.com/aws-cloudformation/cfn-lint/blob/main/docs/rules.md)、[E3601 のソース](https://github.com/aws-cloudformation/cfn-lint/blob/main/src/cfnlint/rules/resources/stepfunctions/StateMachineDefinition.py)
- [aws-cdk-lib](https://www.npmjs.com/package/aws-cdk-lib) 2.275.0 の `aws-stepfunctions-tasks`（`EcsRunTask`）と `assertions`（手元で synth と assertions を実行）
- [asl-validator](https://www.npmjs.com/package/asl-validator) 4.0.0（手元で実行）
- 第三者（一次資料ではない）: [mcattarinussi/step-functions-runtask-retry](https://github.com/mcattarinussi/step-functions-runtask-retry)、[aws-samples/retryable-ecs-run-task-step-functions](https://github.com/aws-samples/retryable-ecs-run-task-step-functions)、[LocalStack: Effective Unit Testing for AWS Step Functions](https://blog.localstack.cloud/effective-unit-testing-for-aws-step-functions/)（検索結果の要約のみ読んだ）
- このリポジトリ: `docs/adr/0013-api-on-ecs-and-lambda-web-functions.md`、`docs/batch/workflow-engine.md`、`docs/batch/workflow-design.md`、`docs/batch/test.md`、`research/verification-env-cd.md`（ブランチ `research/verification-env-cd`）
