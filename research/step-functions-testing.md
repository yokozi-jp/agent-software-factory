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

- Step Functions Local: AWS の文書の冒頭に「機能の同等性がなく、サポート対象外（unsupported）」とあり、代わりに TestState API を勧めている。最後の版は 2.0.0（ビルド 2024-05-18）で、Docker Hub の `amazon/aws-stepfunctions-local` の最終更新も同じ日。2026-10-29 までの 2 年 5 か月、版が出ていない。JSONata の発表（2024-11-22 の What's New）より 6 か月前の版で、Local の文書に JSONata の記述はない。LocalStack の文書は、JSONata と Variables に対応し、Step Functions Local の代わりに使えると書く。
- TestState API: 2025-11 に強化された。モック（`--mock`）で結果とエラーを差し込め、Map、Parallel、`.sync`、`.waitForTaskToken` も試せる。`stateName` で完全な定義の中の 1 つの状態を指定でき、`stateConfiguration.retrierRetryCount` で `Retry` の何回目かを指定できる。追加の料金はない。ただし既定では AWS の本物のエンドポイントを呼ぶので、CI には AWS の認証が要る。LocalStack が同じ API を提供する（Compute Blog の記述。LocalStack の文書では確かめていない）。
- ASL の検査: AWS の `ValidateStateMachineDefinition` API の診断コードは文書に一覧がある（警告 3 種、エラー 15 種）。到達できない状態にも、`States.ALL` の位置にも、専用のコードはない（`MISSING_TRANSITION_TARGET` は `Next` の宛先がない場合）。ただし文書は、コードは増減しうると書く。cfn-lint の `E3601` は JSON Schema と `StartAt` の存在を検査し、到達可能性は検査しない（ソースを読んだ）。CDK が出す `Fn::Join` の `DefinitionString` は検査を飛ばす（ソースを読んだ）。`asl-validator` 4.0.0 は `Orphan` 状態を検出できたが、`States.ALL` が `Retry` の最後にない誤りは検出できなかった（手元で実行）。
- CDK の assertions: `DefinitionString` は `Fn::Join` になり、`Match.serializedJson` は使えない（手元で失敗を確かめた）。`Fn::Join` の中の文字列片を `Match.stringLikeRegexp` などで見るか、`Ref` を置き換えて JSON にしてから検査する。`Retry` と `Catch` の中身の検査は、後者のほうが書きやすい。
- `.sync` の終了コード: Step Functions と CDK の文書に、非 0 の終了コードの扱いの記述はない。`Failures` が空でないときだけ `AmazonECS.Unknown` と書かれている。AWS の公式サンプル（`aws-samples/retryable-ecs-run-task-step-functions`）のテスト用データには、終了コード 2 のコンテナで `.sync` の state が失敗した出力が残っている。`Error` は `States.TaskFailed`、`Cause` は ECS の Task を JSON にした文字列で、`Containers[].ExitCode: 2`、`StopCode: EssentialContainerExited` を含む。これは文書ではなくサンプルのデータで、AWS 上で再現していない。
- redrive: Standard の失敗、中断、タイムアウトの実行を、失敗した状態からやり直す。Task 状態は新しく起動し直すので、ECS のタスクがもう 1 つ走る。Scheduler が起動した実行を対象外にする記述は、redrive の文書にも `RedriveExecution` API にもない。

## ADR 0013 と docs の食い違い

| docs の記述                                                                                                                                                                    | 一次資料                                                                                            | 扱い                                                                                                                                                             |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/batch/test.md`: 「ワークフローエンジンの実装は、一般にテストコードによる UT が困難」                                                                                     | 2025-11 の TestState API の強化で、Step Functions の定義の状態を単体で、モック付きで、CI から試せる | Step Functions に限っては、前提が古くなった。「ロジックは関数に分ける」の方針自体は、今も有効（「`docs/batch/test.md` との関係」の節）。docs は直していない      |
| `docs/batch/workflow-engine.md`: 依存関係がなければ EventBridge Scheduler から直接 ECS を起動する構成（1）を推奨し、将来の依存が分かっているときだけ Step Functions（2）を使う | ADR 0013 は Step Functions を経由する構成に決めている                                               | 食い違いというより、ADR が docs の推奨と別の選択をしている。理由が ADR に書かれているかは、ADR 0013 の該当行（20 行目）には見当たらない。#354 で触れる候補       |
| `docs/batch/workflow-engine.md` 114 行目の比較表: リランは「Step Functions のステートマシン（タスク）を再実行する」                                                            | 再実行（新しい実行）と redrive（同じ実行の続き）がある                                              | 87 行目の「個別タスクのリラン」の行は、2023 年のサポートを案内している（redrive のアナウンス）が、114 行目は redrive と新しい実行を分けていない。「redrive」の節 |
| docs に Step Functions Local、TestState の記述はない。「redrive」の語もない（`grep` で確認。87 行目はアナウンスへのリンクのみ）                                                | 同上                                                                                                | 空白                                                                                                                                                             |

### `docs/batch/test.md` が古い点（食い違いの報告。docs は直していない）

引用は `docs/batch/test.md` の 23 行目（単体テストの「全般」の行）。

> ・ワークフローエンジンでの実装（分岐やロジック）は可能な限り減らす。一般に、ワークフローエンジンの実装はテストコードによるUTが困難なため ・どうしても実装が必要な場合はfunctionとして分離し、テストコードによるUT可能な構成とする

| 点                                                                                                                                   | 一次資料                                                                                                                                                                                                                                                                                                                          | 食い違い                                                                                                                                       |
| :----------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| 23 行目「ワークフローエンジンの実装はテストコードによるUTが困難」                                                                    | TestState API は 2025-11 から、モック（`result` と `errorOutput`）、Map、Parallel、`.sync`、`.waitForTaskToken`、`Retry` の回数の指定（`retrierRetryCount`）に対応する。AWS CLI と SDK から呼べるので、テストコードで書ける（[TestState の文書](https://docs.aws.amazon.com/step-functions/latest/dg/test-state-isolation.html)） | Step Functions については、「困難」という前提が成り立たない。分岐（`Choice`）、`Retry`、`Catch` を、1 つの状態ごとにテストコードで確かめられる |
| 23 行目「どうしても実装が必要な場合は function として分離」                                                                          | 同上。分離せずに定義の中で試す手段ができた                                                                                                                                                                                                                                                                                        | 方針自体は否定されない。分離が「必須の回避策」ではなく「選択肢の 1 つ」になった（判断）                                                        |
| 前書きの出典（`test.md` のフロントマター `sources`）は、バッチ設計ガイドラインで、取り込んだ領域の `about.md` に 2023〜2025 年とある | TestState の強化は 2025-11                                                                                                                                                                                                                                                                                                        | 取り込んだ時期より後の変更の可能性が高い。ガイドラインの原文がいつ書かれたかは、確かめていない                                                 |

関連して、同じ領域の `docs/batch/workflow-engine.md` の 114 行目も、再実行と redrive を分けていない（上の表）。直す場合は、取り込んだ領域なので `docs/batch/about.md` の「原文からの変更点」に書く必要がある（`AGENTS.md` の規則）。

## Step Functions Local

### 確かめたこと

- 文書の冒頭: 「Step Functions Local does not provide feature parity and is unsupported」。サードパーティのエミュレータを検討するか、TestState API を使うよう書かれている（[Testing state machines with Step Functions Local (unsupported)](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local.html)）。
- 最終の版は `2.0.0`、ビルド 2024-05-18（同じ文書の `java -jar StepFunctionsLocal.jar -v` の出力）。Docker Hub の API で、`latest` と `2.0.0` のタグの更新日が 2024-05-18、その前が `1.14.0`（2024-03-27）だった（[Docker Hub](https://hub.docker.com/r/amazon/aws-stepfunctions-local)、API で確認）。
- 呼び先のエンドポイントとして、Lambda、Batch、DynamoDB、ECS、Glue、SageMaker、SQS、SNS、Step Functions を設定できる（同じ文書の設定の表）。`--ecs-endpoint` があるので、ECS の RunTask を、本物の ECS ではなく別のエンドポイントに向けることはできる。
- 既定では、ローカルのテスト用アカウントとリージョン `us-east-1` を使う。ロールの ARN は使われないが、書式の通りの値が要る（同じ文書）。
- JSONata との時期の比較: AWS の What's New「Variables and JSONata transformations」の公開日は 2024-11-22（検索結果の日付）。Local の最後の版 2.0.0 は 2024-05-18 なので、約 6 か月前に出た。Local の文書（`sfn-local.html`）を全文検索して、`JSONata`、`QueryLanguage`、`Variables` の語は 0 件だった。JSONata に対応する版が出たという記述は、文書にもリリース情報にも見つけていない。
- LocalStack の文書は、LocalStack を Step Functions Local の代わりに使え、「JSONata と Variables などの最新の機能」も使えると書く（[LocalStack の Step Functions](https://docs.localstack.cloud/aws/services/stepfunctions/)）。これはベンダーの記述で、AWS の一次資料ではない。
- モック設定ファイル（`MockConfigFile.json`）で、状態ごとに、テストケースごとの戻り値とエラーを決められる。モックはサービスの本当の API と同じ形かを検査しない（[Testing with mocked service integrations](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local-test-sm-exec.html)）。

### 判断

- 2 年 5 か月版が出ていないものに、その後に加わった ASL の機能（JSONata、`Arguments` など）への追従は期待できない。2.0.0 が JSONata を解釈できるかは、実際に動かして確かめていない（「確かめられなかったこと」）。AWS の文書自体が、`Arguments` と JSONata を使う例（connect-ecs の `runTask.sync`）を載せているので、Local でその定義が通らない可能性は高い（判断）。
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

## LocalStack の Step Functions

LocalStack の公式の記述だけを書く（[Step Functions](https://docs.localstack.cloud/aws/services/stepfunctions/)。API ごとの対応表は別ページにあるが、読んでいない）。ベンダーの記述で、AWS の一次資料ではない。実際に動かしてはいない。

- 作成、実行、更新、削除の API を提供すると書く。対応する API の範囲は、LocalStack の API coverage の節を見るよう案内している。
- 対応するサービス統合の表: ECS/Fargate の行にチェックが 3 つ付く（列は Request Response、`.sync`、`.sync2`、`.waitForTaskToken` の 4 つで、ページの取得結果では、どの 3 列かを区別できなかった）。Lambda、DynamoDB、SNS、SQS、API Gateway、EventBridge、Glue、Step Functions、Batch も表にある。
- モックした統合: `Return`（成功の出力）と `Throw`（`Error` と省略可の `Cause`）を、試行回数（`"0"`、`"1-2"`）ごとに決められる。`.sync`、`.sync2`、`.waitForTaskToken` に対応し、成功と失敗の両方を再現できる、と書く。
- Step Functions Local の設定との互換: 既存の Local のモック設定を使える、と書く。
- JSONata と Variables に対応する、と書く。
- TestState API を提供するかは、このページには書かれていない（この調査ファイルの前の版は、Compute Blog の記述から提供すると書いた。LocalStack 側の文書では確かめていない）。
- redrive と `ValidateStateMachineDefinition` への対応は、このページには書かれていない。
- 再現度（AWS の本物との一致）を数値や一覧で示す記述は、ページになかった。

## SAM と CDK での試験

### 確かめたこと

- SAM: Step Functions Local を、`sam local start-lambda` の Lambda と組み合わせる手順が文書にある。ただし文書は Step Functions Local が unsupported と書く（[Tutorial: Testing workflows using Step Functions and AWS SAM CLI Local](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local-lambda.html)）。この構成の ECS のタスクは Lambda ではないので、`sam local` で起動する対象にならない。
- SAM は `AWS::Serverless::StateMachine` で状態機械を書ける（[Using AWS SAM to build Step Functions workflows](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-sam-sfn.html)）。ただし ADR 0013 は IaC に CDK を選んでおり、SAM を足す理由は見つからなかった。
- cfn-lint のルール `E3601` の中身は「ASL の検査」の節に書いた（ソースを読んだ）。リポジトリは cfn-lint を使っていない（`docs/`、`mise.toml`、`package.json`、`lefthook.yml`、`.github/` を検索して 0 件。今回の調査ファイルを除く）。
- CDK: `EcsRunTask`（`aws-stepfunctions-tasks`）に `integrationPattern: RUN_JOB` を渡すと `ecs:runTask.sync` になる。`taskTimeout`、`addRetry`、`addCatch` がある。`taskTimeout` を付けない場合、`TimeoutSeconds` は定義に出ない（手元の synth で確認）。

### 判断

- 「SAM CLI で状態機械を手元で試す」道は、Step Functions Local の扱いが unsupported であることと、CDK を使うことから、この構成では選択肢にならない。

## ASL の検査

### 検査の層

| 層  | 道具                                                                                               | 構文                    | 到達できない状態               | `Retry` と `Catch` の規則                               | AWS の認証                  |
| :-- | :------------------------------------------------------------------------------------------------- | :---------------------- | :----------------------------- | :------------------------------------------------------ | :-------------------------- |
| 1   | `ValidateStateMachineDefinition` API（CLI: `aws stepfunctions validate-state-machine-definition`） | 検査する                | 専用のコードなし（文書の一覧） | 専用のコードなし。`NO_DOLLAR` など 3 種の警告のみ       | 要る                        |
| 2   | `asl-validator` 4.0.0（npm、手元で実行）                                                           | 検査する                | 検出した                       | 一部のみ（下記）                                        | 不要                        |
| 3   | cfn-lint の `E3601`                                                                                | 検査する（JSON Schema） | 検査しない（ソース）           | 検査しない（ソース。`States.ALL` の語はスキーマにない） | 不要                        |
| 4   | CDK の assertions                                                                                  | 定義の文字列の形で見る  | 自分で書く                     | 自分で書く                                              | 不要                        |
| 5   | TestState API                                                                                      | 1 つの状態の動き        | 範囲外                         | 動きを確かめる（`RETRIABLE`、`CAUGHT_ERROR`）           | 要る（LocalStack なら不要） |

### 確かめたこと

- `ValidateStateMachineDefinition`: 結果は `OK` か `FAIL`。`severity: WARNING` を渡すと、`NO_DOLLAR`、`PASS_RESULT_IS_STATIC`、`NO_PATH` などの警告も返す。文書は CI や pre-commit での利用を挙げ、診断の数や文言は変わりうるので `result` だけを頼るよう書く（[API reference](https://docs.aws.amazon.com/step-functions/latest/apireference/API_ValidateStateMachineDefinition.html)）。
- 診断コードの一覧（[ValidateStateMachineDefinitionDiagnostic](https://docs.aws.amazon.com/step-functions/latest/apireference/API_ValidateStateMachineDefinitionDiagnostic.html)）:
  - 重大度は `ERROR`（定義を作成、更新できない）と `WARNING`（作成、更新はできる）の 2 つ。`location` は `/States/<StateName>/<FieldName>` の形で、省略されることがある。
  - `WARNING` は 3 種: `NO_DOLLAR`（JSONPath や組み込み関数に見える値に `.$` がない）、`NO_PATH`（パスに見える値の項目名が `Path` で終わらない）、`PASS_RESULT_IS_STATIC`（Pass 状態の `Result` にパスを書いた）。
  - `ERROR` は 15 種: `INVALID_JSON_DESCRIPTION`、`MISSING_DESCRIPTION`、`SCHEMA_VALIDATION_FAILED`、`INVALID_RESOURCE`、`MISSING_END_STATE`、`DUPLICATE_STATE_NAME`、`INVALID_STATE_NAME`、`STATE_MACHINE_NAME_EMPTY`、`STATE_MACHINE_NAME_INVALID`、`STATE_MACHINE_NAME_TOO_LONG`、`STATE_MACHINE_NAME_ALREADY_EXISTS`、`DUPLICATE_LABEL_NAME`、`INVALID_LABEL_NAME`、`MISSING_TRANSITION_TARGET`（`Next` が既知の状態名に合わない）、`TOO_DEEPLY_NESTED`。
  - 到達できない状態を示すコードは一覧にない。`States.ALL` の位置を示すコードもない。ただし `SCHEMA_VALIDATION_FAILED` は理由が「スキーマの検査の失敗」としか書かれていないので、`States.ALL` の位置が含まれるかは、文書から分からない。
  - 文書は、診断を増減、変更しうるので、自動化は `result`（`OK`、`FAIL`）だけに頼るよう書く。コードの一覧を CI の判定に使うのは、文書の方針に反する（判断ではなく文書の記述）。
- cfn-lint（最新の版は v1.58.0、[ソース](https://github.com/aws-cloudformation/cfn-lint/blob/main/src/cfnlint/rules/resources/stepfunctions/StateMachineDefinition.py)を `main` で読んだ。実行はしていない）:
  - Step Functions のルールは `E3601` の 1 つだけ（`rules.md` と `rules/resources/stepfunctions/` の中身）。
  - `Definition` と `DefinitionString` を JSON Schema（`statemachine.json`、`QueryLanguage` が `JSONata` なら JSONata 用に変えたもの）で検査し、`StartAt` が `States` にあるかを Parallel と Map の中まで調べる。
  - 到達できない状態、`Next` の宛先の有無、`Retry` と `Catch` の順序を検査するコードは、このファイルにない。スキーマ（`statemachine.json`）に `States.ALL` の語もない。`Next` の宛先をスキーマが検査するかは、スキーマの全部を読んでいないので分からない。
  - `DefinitionString` が組み込み関数（`Fn::Join` など）のとき、検査を飛ばす（`is_function(value)` で `continue`）。CDK が `Ref` を含む定義に出す `Fn::Join` の形は、飛ばされる側だと読める（判断。実行して確かめていない）。
  - `sam validate --lint` が cfn-lint を使うことは、文書で確かめていない。
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

### コンテナが 0 以外の終了コードで終わったとき

問い: `ecs:runTask.sync` の state は失敗するか。エラー名と `Cause` の形は何か。

結論: 一次の文書には、直接答える記述が見つからなかった。AWS の公式サンプルのテスト用データに、失敗した実例の形がある。AWS 上での再現はしていない。

#### 探した範囲と結果

| 資料                                                                                                                                                                                     | 非 0 の終了コードの記述                                                                                                                                                                                     |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Run Amazon ECS or Fargate tasks with Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html)（全文を読んだ）                                             | なし。失敗の記述は `Failures` が空でないときの `AmazonECS.Unknown` だけ                                                                                                                                     |
| [Integrating services](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)（Run a Job の節）                                                                  | なし。`.sync` は「ジョブの完了を待つ」とだけある。失敗の条件は書かれていない                                                                                                                                |
| [Handling errors](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)                                                                                     | `States.TaskFailed` は `States.Timeout` 以外のすべてのエラーに合うワイルドカード。ECS の終了コードとの対応はなし                                                                                            |
| [Manage a container task with Amazon ECS and Amazon SNS](https://docs.aws.amazon.com/step-functions/latest/dg/sample-project-container-task-notification.html)（開発者ガイドのサンプル） | 「タスクが成功か失敗するまで待ち、結果を SNS に送る」とあるが、定義と失敗の出力は載っていない（コンソールのテンプレートで開く形）                                                                           |
| ECS API の [Container](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_Container.html)                                                                                     | `exitCode`: 「コンテナが返した終了コード」（Integer、省略可）。`DescribeTasks` の `tasks[].containers[].exitCode` の項目                                                                                    |
| ECS API の [Task](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_Task.html)                                                                                               | `stopCode` は `TaskFailedToStart` `EssentialContainerExited` `UserInitiated` `ServiceSchedulerInitiated` `SpotInterruption` `TerminationNotice` `InfrastructureHealth` のいずれか。`stoppedReason` は文字列 |
| ECS API の [ContainerDefinition](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html)                                                                 | `essential` が true（省略時も true）のコンテナが「何らかの理由で止まる」と、残りのコンテナも止まる。false のコンテナの失敗は、他に影響しない                                                                |
| `aws-cdk-lib` 2.275.0 の `aws-stepfunctions-tasks` の README と型定義（`lib/ecs/*.d.ts`）                                                                                                | `exit` の語は 0 件。ECS の節は RunTask の起動の設定の説明だけ                                                                                                                                               |
| [aws-samples/aws-ecs-stepfunctions-synchronous-runtask](https://github.com/aws-samples/aws-ecs-stepfunctions-synchronous-runtask)（AWS の公式サンプル）                                  | `RunTask.sync` の `Catch` で「起動したタスクが返す失敗」を受ける、と README に書く。`Retry` と `Catch` は `States.ALL`。終了コードの語はなし                                                                |
| [aws-samples/retryable-ecs-run-task-step-functions](https://github.com/aws-samples/retryable-ecs-run-task-step-functions)（AWS の公式サンプル）                                          | README に「`Run a Job` では、Step Functions がタスクの終了を待ち、停止の理由とコンテナの終了コードを含む結果を返す」とある。テスト用データに実例がある（下記）                                              |

AWS の文書の中では、CDK の `EcsRunTask` にも、TestState の文書にも、ECS の `.sync` が内部でどの API をポーリングするかの記述はなかった。

#### 実例の形（AWS の公式サンプルのテスト用データ）

出典は `aws-samples/retryable-ecs-run-task-step-functions` の `lambda/error_handler/event.json` と `index.py`（`main` ブランチを 2026-10-29 に読んだ）。`RunTask`（`integrationPattern: RUN_JOB`、つまり `ecs:runTask.sync`）に `Catch` を付け、`resultPath: "$.RunTaskError"` でエラー出力を受ける構成。`app/main.py` に、終了コード 2 で終わらせるための行（`sys.exit(2)`）がコメントで入っている。

`event.json` の `RunTaskError` を、読みやすいように要点だけ抜く。

```json
{
  "RunTaskError": {
    "Error": "States.TaskFailed",
    "Cause": "<JSON を文字列にしたもの>"
  }
}
```

`Cause` を JSON として読むと、ECS の Task を PascalCase にした形で、次の値を含む。

| 項目                           | 値                                   |
| :----------------------------- | :----------------------------------- |
| `Containers[0].ExitCode`       | `2`                                  |
| `Containers[0].LastStatus`     | `STOPPED`                            |
| `StopCode`                     | `EssentialContainerExited`           |
| `StoppedReason`                | `Essential container in task exited` |
| `LastStatus` / `DesiredStatus` | `STOPPED` / `STOPPED`                |
| `StartedBy`                    | `AWS Step Functions`                 |

サンプルの `index.py` は、`json.loads(event['RunTaskError']['Cause'])` で文字列を JSON に戻し、`cause['StoppedReason']` と `cause['Containers'][0].get('ExitCode', 0)` を読む。`ExitCode` の有無を `get` で扱っているので、コンテナが起動できず終了コードがないときも想定している。

#### ここから言えること、言えないこと

- 確かめた事実: 終了コード 2 のコンテナでは、`Catch` が受ける `Error` が `States.TaskFailed` で、`Cause` は ECS の Task の JSON 文字列で、終了コードは `Containers[].ExitCode`、止めた理由は `StopCode` と `StoppedReason` に入る（サンプルのデータ上）。
- 判断: `Catch` が働いたので、非 0 の終了で state は失敗する、と読める。ただしテスト用データで、AWS の文書の記述ではない。実際に取った出力かどうかは、リポジトリに書かれていない（ARN やタイムスタンプは実際の値に見え、アカウント ID は `123456789012` に置き換えてある）。
- 確かめられなかったこと: (a) 終了コード 0 の `essential` コンテナで state が成功する、という記述（`essential` の文書は「何らかの理由で止まる」と書き、0 も含むように読める）。(b) `essential: false` のコンテナが非 0 で終わったときの扱い。(c) `Error` が常に `States.TaskFailed` か。`Failures` が空でないときは `AmazonECS.Unknown`（文書）で、別のエラー名になる。起動できないときの `Cause` の形は、サンプルの `index.py` が `StoppedReason` を `CannotPullContainerError` や `ResourceInitializationError` で始まる文字列として扱っていることから、`Cause` の `StoppedReason` に入ると読めるだけで、実例は見ていない。(d) `Retry` を `States.TaskFailed` に付けたときの挙動の実例。

#### 第三者の資料（一次ではない）

- [mcattarinussi/step-functions-runtask-retry](https://github.com/mcattarinussi/step-functions-runtask-retry): 失敗のエラー名は常に `States.TaskFailed` で、終了コードは `Cause` の文字列を読んで取るしかない、と書く。AWS のサンプルのデータと同じ形だが、別の裏づけにはならない（個人のリポジトリ）。
- Stack Overflow などの質問は、今回は読んでいない。読んだとしても一次ではない。

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
- Scheduler が起動した実行（StartExecution が対象）の redrive:
  - 確かめた事実: redrive の文書と `RedriveExecution` API の文書の対象外の条件は、Standard 以外（Express は非対応）、上の 5 つの条件、定義を変えた後、だけで、起動元（Scheduler、API、コンソール）による区別は書かれていない。[Scheduler の templated target](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-templated.html) は Step Functions の `StartExecution` を対象に挙げ、redrive との関係を書いていない。
  - 判断: Scheduler が起動した実行も Standard の通常の実行なので、条件を満たせば redrive できる。ただし、Scheduler の起動で作った実行を実際に redrive した例は、見ていない。
  - API の詳細: `clientToken` は冪等のためのトークンで、同じ実行に対して直近 10 個、最初の使用から 15 分間、同じ応答を返す。`ExecutionNotRedrivable`（条件を満たさない）、`ExecutionLimitExceeded`（実行中の数の上限）のエラーがある。
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

| 層                                                  | 確かめられること                                                     | 確かめられないこと                    | AWS の認証 | 費用                                                                            | 実行の目安 |
| :-------------------------------------------------- | :------------------------------------------------------------------- | :------------------------------------ | :--------- | :------------------------------------------------------------------------------ | :--------- |
| ジョブを直接起動（`node`、`docker run`）            | 業務のロジック、終了コード、冪等性、0 件                             | ワークフロー、IAM、network            | 不要       | なし                                                                            | 数秒〜     |
| CDK の assertions（synth だけ）                     | `.sync` の指定、`Retry`、`Catch`、`TimeoutSeconds`、IAM の方針の有無 | 実行時の動き                          | 不要       | なし                                                                            | 数秒       |
| `asl-validator`（cfn-lint は構文と `StartAt` のみ） | 構文、到達できない状態、遷移先の不足（`asl-validator`）              | 実行時の動き、一部の規則              | 不要       | なし                                                                            | 1 秒未満   |
| `ValidateStateMachineDefinition`                    | AWS の構文検査と静的解析の警告                                       | 実行時の動き                          | 要る       | なし                                                                            | 数秒       |
| TestState（モック、AWS のエンドポイント）           | 1 状態の入出力、`Retry` と `Catch` の遷移、`Next`                    | 状態をつないだ実行、ECS、redrive      | 要る       | 追加なし                                                                        | 数秒       |
| TestState（LocalStack）                             | 同上、ネットワークなし                                               | 同上。LocalStack の追従の程度は未確認 | 不要       | LocalStack の条件による                                                         | 数秒       |
| Step Functions Local                                | モックでの実行全体の経路                                             | unsupported。新機能に追従しない       | 不要       | なし                                                                            | 数秒       |
| 検証環境の E2E（#88）                               | ECS の起動、非 0 の終了、IAM、Scheduler からの起動、redrive          | なし（費用と時間が大きい）            | 要る       | 1 回およそ 0.5 ドル（ブランチ `research/verification-env-cd` の調査の見積もり） | 数十分     |

## 決めるべき論点

[#354](https://github.com/yokozi-jp/agent-software-factory/issues/354) で決める候補。決定は下していない。

1. 状態機械の試験に TestState を使うか。使う場合、CI から AWS の API を呼ぶか（OIDC のロールと `states:TestState` の権限が要る）、LocalStack に向けるか、`asl-validator` と CDK の assertions だけにして TestState は検証環境の E2E に回すか。
2. ASL の静的検査を、`asl-validator`（AWS の認証が不要。到達できない状態は検出するが、`States.ALL` の位置は検出しない）、`ValidateStateMachineDefinition`（認証が要る。到達できない状態と `States.ALL` の位置の専用コードは文書にない。`result` だけを頼る方針）、cfn-lint（`StartAt` まで。CDK の `Fn::Join` の定義は飛ばす。リポジトリでは未使用）、の組み合わせのどれにするか。
3. CDK の assertions で、どこまでを固定するか。例: `.sync` の指定、`TimeoutSeconds` の有無、`Retry` の対象のエラー、`Catch` の行き先。細かく固定すると、定義を変えるたびに試験を直す。
4. `taskTimeout`（`TimeoutSeconds`）を必須にするか。付けないと、ECS のタスクが固まったとき、実行が最長 1 年まで待つ可能性がある（実行の上限は文書の 1 年。`.sync` の既定のタイムアウトは文書で確かめていない）。
5. `Retry` を付けるか。付ける場合、対象のエラー（`States.TaskFailed` 全部か、`AmazonECS.Unknown` や ECS の一時的な失敗だけか）と、ジョブの冪等性の保証（`docs/batch/test.md`）。
6. redrive を運用の手順にするか、新しい実行を始める手順にするか。前者なら、ジョブが同じ営業日の入力で再度起動されて安全か、入力に営業日を入れるかを決める必要がある。redrive の条件（14 日以内、定義を変えていない）を運用手順に書くか。
7. コンテナの終了コードと実行の失敗の対応を、検証環境の E2E の必須の観点にするか。AWS の公式サンプルのデータは、非 0 で `States.TaskFailed` と `Cause`（ECS の Task の JSON）になることを示すが、文書の記述ではない。非 0 の `essential` コンテナ、`essential: false` のコンテナ、起動失敗（`Failures` と `StoppedReason`）の 3 通りを 1 回ずつ流して、`Error` と `Cause` の形を記録する案がある。
8. ローカルの標準を「ジョブを直接起動」にするなら、その入口（`docs/batch/test.md` の観点との対応）と、ワークフローの定義の試験の置き場所（`apps/` のどこか、`infra` のどこか）。
9. `docs/batch/test.md` の「ワークフローエンジンの UT が困難」と `docs/batch/workflow-engine.md` の Scheduler 直接起動の推奨を、この調査を受けて直すか（docs の取り込みの規則により、`about.md` の「原文からの変更点」に書く対象）。この調査では直していない。
10. EventBridge Scheduler の起動から Step Functions の実行までの経路（Scheduler のターゲット、リトライ、DLQ）の試験を、この調査の外として別に扱うか。この調査では読んでいない。
11. 失敗の通知（`Catch` の先）が `Cause` の JSON 文字列から終了コードを取り出すか（`States.StringToJson` で解くか、通知に `Cause` をそのまま載せるか）。サンプルは Lambda で `json.loads` している。

## 確かめられなかったこと

AWS の上での実行は、すべて未実行（AWS アカウントがない）。以下は、そのうえで残った点。

- ECS の `.sync`:
  - 非 0 の終了コードで state が失敗することの、AWS の文書の記述。AWS の公式サンプルのテスト用データ（`event.json`）には実例があるが、実際に取った出力かは分からない。
  - 検索した範囲: Step Functions の connect-ecs、service integration patterns、Integrating services、Handling errors、開発者ガイドのサンプル（Manage a container task with Amazon ECS and Amazon SNS。定義は文書に載っていない）、ECS の `Container`、`Task`、`ContainerDefinition`、stopped task error codes、`aws-cdk-lib` 2.275.0 の README と型定義、`aws-samples` の 2 つのサンプル。Stack Overflow などの第三者の質問は読んでいない。
  - `essential: false` のコンテナが非 0 で終わったとき、終了コード 0 の `essential` コンテナで成功すること、起動できなかったとき（`Failures` が空のとき）の `Error` と `Cause` の形。
  - ECS の `runTask.sync` が、どの API をポーリングするか（`DescribeTasks` と推測できるが、文書にない）。TestState の `.sync` のモックの形も、ECS では文書にない。
  - `.sync` の `TimeoutSeconds` がないときの既定の待ち時間。
- TestState、`ValidateStateMachineDefinition` の実際の応答。文書とブログの例からの理解で、手元で呼んでいない。
- `States.ALL` を `Retry` の最後以外に置いた定義を、AWS が実際に拒否するか。`ValidateStateMachineDefinition` が到達できない状態を診断するか（一覧にコードがないだけで、`SCHEMA_VALIDATION_FAILED` に含まれるかは不明）。
- cfn-lint を実行していない。ソースを読んだだけ。`Fn::Join` の `DefinitionString` を飛ばす点と、スキーマ全体が `Next` の宛先を検査するかは、実行して確かめていない。`sam validate --lint` が cfn-lint を使うことも確かめていない。
- Step Functions Local 2.0.0 が JSONata の定義を受け付けるか。Docker のコンテナを起動して試そうとしたが、実行環境の制限で起動できなかった。リリースノートは見つけられなかった。
- LocalStack の再現度（TestState の実装、redrive、ライセンス、費用、CI での使い方）。公式の記述に再現度の一覧がない。
- TestState を CI から呼ぶときの IAM の最小の形（文書の `states:TestState` と、モックなしの場合の `iam:PassRole` だけを確認）。
- Scheduler が起動した実行を、実際に redrive できるか。redrive 後に前の ECS のタスクが残るか。
- EventBridge Scheduler のターゲットのリトライと DLQ。この調査では読んでいない。
- `docs/batch/test.md` の出典（Future Architect のガイドライン）の、原文の更新日。

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
- 追加（2026-10-29）: [ValidateStateMachineDefinitionDiagnostic](https://docs.aws.amazon.com/step-functions/latest/apireference/API_ValidateStateMachineDefinitionDiagnostic.html)、[RedriveExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_RedriveExecution.html)、[Scheduler の templated target](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-templated.html)、[Manage a container task with Amazon ECS and Amazon SNS](https://docs.aws.amazon.com/step-functions/latest/dg/sample-project-container-task-notification.html)
- 追加: ECS API の [Container](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_Container.html)、[Task](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_Task.html)、[ContainerDefinition](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html)、[stopped task error codes](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/stopped-task-error-codes.html)
- 追加: AWS の公式サンプル [aws-samples/retryable-ecs-run-task-step-functions](https://github.com/aws-samples/retryable-ecs-run-task-step-functions)（`README.md`、`lambda/error_handler/event.json`、`lambda/error_handler/index.py`、`lib/construct/retryable-run-task.ts`）、[aws-samples/aws-ecs-stepfunctions-synchronous-runtask](https://github.com/aws-samples/aws-ecs-stepfunctions-synchronous-runtask)
- 追加: [Simplifying developer experience with variables and JSONata](https://aws.amazon.com/blogs/compute/simplifying-developer-experience-with-variables-and-jsonata-in-aws-step-functions/)、[What's New 2024-11（Variables と JSONata）](https://aws.amazon.com/about-aws/whats-new/2024/11/aws-step-functions-variables-jsonata-transformations/)、[LocalStack: Step Functions](https://docs.localstack.cloud/aws/services/stepfunctions/)（ベンダーの文書）
- 追加: cfn-lint の [statemachine.json](https://github.com/aws-cloudformation/cfn-lint/blob/main/src/cfnlint/data/schemas/other/step_functions/statemachine.json)
- このリポジトリ（引用の行番号）: `docs/batch/test.md` 23 行目、`docs/batch/workflow-engine.md` 87、114 行目、`docs/batch/about.md` 33 行目
