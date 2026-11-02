// Node.js 専用の入口 (docs/adr/0007、docs/adr/0048)。OpenTelemetry の SDK と exporter を import してよい場所は、
// ここと、アプリの入口のファイル (apps/api/src/telemetry.ts) だけ。それ以外は @opentelemetry/api だけを import する。
import { AwsInstrumentation } from "@opentelemetry/instrumentation-aws-sdk";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { NodeSDK } from "@opentelemetry/sdk-node";

import {
  awsSdkInstrumentationConfig,
  pgInstrumentationConfig,
  undiciInstrumentationConfig,
} from "./policy.ts";

export interface StartTelemetryOptions {
  /** 入口が読んだ環境変数 (docs/adr/0032)。 */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** `OTEL_SERVICE_NAME` がないときの service.name。 */
  readonly serviceName: string;
  /** 試験が span を受け取るために渡す。渡すと、送り先の環境変数がなくても起動する。 */
  readonly spanProcessors?: NonNullable<ConstructorParameters<typeof NodeSDK>[0]>["spanProcessors"];
}

export interface Telemetry {
  /** SDK を始めたか。送り先がない、または無効にしたときは false。入口が知らせるために使う。 */
  readonly enabled: boolean;
  /** 送っていない span を送り切って止める。プロセスを終えるときに呼ぶ。 */
  readonly shutdown: () => Promise<void>;
}

const stopped: Telemetry = { enabled: false, shutdown: () => Promise.resolve() };

function hasEndpoint(env: StartTelemetryOptions["env"]): boolean {
  return [env.OTEL_EXPORTER_OTLP_ENDPOINT, env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT].some(
    (value) => value !== undefined && value !== "",
  );
}

/**
 * トレースを始める。受信 HTTP の span は `@hono/otel` (apps/api の app.ts)、DB は `pg`、外向きの通信は `fetch`
 * (undici) と AWS SDK の計装が作る。ログは OTLP で送らない (docs/adr/0048)。
 *
 * 送り先は標準の `OTEL_EXPORTER_OTLP_ENDPOINT` で決める。ない、または `OTEL_SDK_DISABLED=true` のときは何も始めず、
 * 送り先のないまま localhost:4318 への失敗を出し続けない。
 *
 * 計装は、計装する module (`pg` など) を import する前に有効にする。入口はこれを最初に呼ぶ。
 */
export function startTelemetry({
  env,
  serviceName,
  spanProcessors,
}: StartTelemetryOptions): Telemetry {
  if (env.OTEL_SDK_DISABLED === "true") return stopped;
  if (spanProcessors === undefined && !hasEndpoint(env)) return stopped;
  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME ?? serviceName,
    ...(spanProcessors === undefined ? {} : { spanProcessors }),
    // トレースだけを送る。sdk-node は OTEL_METRICS_EXPORTER と OTEL_LOGS_EXPORTER が空だと既定の otlp を有効にするので、
    // 空の配列を渡して環境変数の読み取りを止める。ログは stdout の JSON Lines のままで OTLP では送らない (docs/adr/0048)。
    metricReaders: [],
    logRecordProcessors: [],
    instrumentations: [
      new PgInstrumentation(pgInstrumentationConfig),
      new UndiciInstrumentation(undiciInstrumentationConfig),
      new AwsInstrumentation(awsSdkInstrumentationConfig),
    ],
  });
  sdk.start();
  return { enabled: true, shutdown: () => sdk.shutdown() };
}
