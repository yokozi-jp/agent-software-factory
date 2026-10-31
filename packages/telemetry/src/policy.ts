// 計装が取る属性の方針 (docs/adr/0048)。startTelemetry がそのまま計装に渡し、policy.test.ts が確かめる。
// 機密になりうるもの (ヘッダー、body、SQL のパラメータ) は、既定で取らないだけでなく、取る設定を書かないことで守る。
import type { AwsSdkInstrumentationConfig } from "@opentelemetry/instrumentation-aws-sdk";
import type { PgInstrumentationConfig } from "@opentelemetry/instrumentation-pg";
import type { UndiciInstrumentationConfig } from "@opentelemetry/instrumentation-undici";

import { urlWithoutQuery } from "./index.ts";

/** `pg`: クエリは `$1` のままの文だけを載せる。値 (`db.postgresql.values`) は載せず、接続の span も切る。 */
export const pgInstrumentationConfig = {
  enhancedDatabaseReporting: false,
  // pg-pool.connect の span は、リクエストの span の中でほとんど時間を持たず、数だけ増える。
  ignoreConnectSpans: true,
  // 次の 2 つは計装の既定でも false。既定が変わっても、文へのコメントと、DB への traceparent の送信が入らないよう明示する。
  // 文にトレースの情報をコメントで足さない。DB のログと突き合わせたくなったら、そのとき決める。
  addSqlCommenterCommentToQueries: false,
  enableTraceContextPropagation: false,
} satisfies PgInstrumentationConfig;

/**
 * `fetch` (undici): 送り先、メソッド、ステータスだけ。リクエストとレスポンスのヘッダーを属性にする
 * `headersToSpanAttributes` は書かない。
 *
 * `url.full` と `url.query` の既定はクエリ文字列を含み、`api_key` や `code` のような値が載る。span の開始後に
 * クエリを落とし、送り先のオリジンとパスだけにする。
 */
export const undiciInstrumentationConfig = {
  requestHook: (span, request) => {
    span.setAttribute("url.full", urlWithoutQuery(request.path, request.origin));
    span.setAttribute("url.query", "");
  },
} satisfies UndiciInstrumentationConfig;

/** AWS SDK: 呼び出した操作とリクエスト ID だけ。入力と応答を属性にする hook は書かない。 */
export const awsSdkInstrumentationConfig = {
  // SDK の内部の HTTP の span を、操作の span の下に重ねない。
  suppressInternalInstrumentation: true,
} satisfies AwsSdkInstrumentationConfig;
