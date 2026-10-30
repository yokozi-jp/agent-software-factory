// 実行環境を選ばない入口。モジュールが import してよい OpenTelemetry は @opentelemetry/api だけで、SDK は
// ./node (Node 専用の入口) に閉じる (docs/adr/0047)。
import { trace } from "@opentelemetry/api";

/** ログ行に足す、今の span の識別子。W3C Trace Context の形式 (trace_id は 32 桁、span_id は 16 桁の 16 進)。 */
export interface TraceFields {
  readonly trace_id: string;
  readonly span_id: string;
  /** 2 桁の 16 進。`01` は sampled。 */
  readonly trace_flags: string;
}

/**
 * 今の span の `trace_id`、`span_id`、`trace_flags` を返す。span の中にいない (SDK が未起動を含む) ときは undefined。
 * ロガーがログ行に足し、ログからトレースを開けるようにする (docs/adr/0047、#327)。
 */
export function activeTraceFields(): TraceFields | undefined {
  const context = trace.getActiveSpan()?.spanContext();
  if (context === undefined || !trace.isSpanContextValid(context)) return undefined;
  return {
    trace_id: context.traceId,
    span_id: context.spanId,
    trace_flags: context.traceFlags.toString(16).padStart(2, "0"),
  };
}
