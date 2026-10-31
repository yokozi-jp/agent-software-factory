// Node 専用の入口 (docs/adr/0049)。pino と @opentelemetry/api を import してよいのはこのファイルと、アプリの入口、テストだけ。
// 環境変数は読まない。入口が読んで引数で渡す (docs/adr/0032)。
import { isSpanContextValid, trace } from "@opentelemetry/api";
import { pino } from "pino";

import {
  exceptionFields,
  messageCodes,
  type FatalLogger,
  type LogContext,
  type LogFields,
  type LogLevel,
} from "./index.ts";

export interface NodeLoggerOptions {
  /** 出力先。`stdoutDestination()` か、テストのメモリ上の出力先。 */
  readonly destination: { write(chunk: string): unknown };
  readonly level: LogLevel;
  readonly service: {
    readonly name: string;
    readonly version: string;
    readonly environment: string;
  };
  /** リクエストの文脈。毎行、書くときに呼ぶ。 */
  readonly context?: () => LogContext | undefined;
  /** UTC のミリ秒 3 桁の ISO 8601。既定は現在の時刻。テストが固定する。 */
  readonly now?: () => string;
}

// 秘匿情報を持ちやすいキー (docs/logging/security.md の 2 層目)。最上位と 1 段下 (`*`) だけを見る。深い入れ子と
// 綴りの違うキー、message の文字列は守れない (node.test.ts に書いてある)。detail、where、parameters は pg のエラーが持つ。
const redactKeys = [
  "password",
  "passwd",
  "secret",
  "client_secret",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "authorization",
  "cookie",
  "set-cookie",
  "api_key",
  "apikey",
  "session_id",
  "detail",
  "where",
  "parameters",
];
const redactPaths = redactKeys.flatMap((key) => [`["${key}"]`, `*["${key}"]`]);

/**
 * テスト用のメモリ上の出力先。`write` された JSON Lines を `lines()` が 1 行ずつ object にして返す。
 * 本番のコードは使わない (出力先は入口が `stdoutDestination()` で作る)。
 */
export function memoryDestination() {
  const chunks: string[] = [];
  return {
    write: (chunk: string): void => {
      chunks.push(chunk);
    },
    chunks,
    lines: (): Record<string, unknown>[] =>
      chunks.flatMap((chunk) => chunk.split("\n").filter(Boolean)).map(parseLine),
  };
}

function parseLine(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("a log line is not a JSON object");
  return Object.fromEntries(Object.entries(value));
}

/**
 * 標準出力への同期の書き込み。worker transport は使わない: 起動が非同期で、`process.exit()` の前だと行を失う
 * (docs/adr/0049)。
 */
export function stdoutDestination(): NodeLoggerOptions["destination"] {
  return pino.destination({ sync: true });
}

// ロガーの時計は、行を書く入口 (この関数) が読む。UTC の `Z` と固定のミリ秒 3 桁は toISOString の形。
const currentTime = (): string => new Date().toISOString();

function traceFields() {
  const span = trace.getActiveSpan();
  if (span === undefined) return {};
  const spanContext = span.spanContext();
  if (!isSpanContextValid(spanContext)) return {};
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    trace_flags: spanContext.traceFlags.toString(16).padStart(2, "0"),
  };
}

function contextFields(context: LogContext | undefined) {
  if (context === undefined) return {};
  return {
    ...(context.requestId === undefined ? {} : { "http.request.id": context.requestId }),
    ...(context.tenantId === undefined ? {} : { tenant_id: context.tenantId }),
    ...(context.userId === undefined ? {} : { "user.id": context.userId }),
  };
}

/** Node 専用の入口が作るロガー。1 行が 1 つの JSON (JSON Lines) で、docs/logging/keys.md の共通のキーが付く。 */
export function createNodeLogger(options: NodeLoggerOptions): FatalLogger {
  const { service, context, now = currentTime } = options;
  const base = pino(
    {
      level: options.level,
      base: null,
      messageKey: "message",
      // `severity.text` が規約のキー。`level` は Lambda の絞り込み用の併記で、費用を測って見直す (docs/adr/0049)。
      formatters: {
        level: (label) => ({ "severity.text": label.toUpperCase(), level: label.toUpperCase() }),
      },
      timestamp: () => `,"timestamp":"${now()}"`,
      mixin: () => ({
        "service.name": service.name,
        "service.version": service.version,
        "deployment.environment": service.environment,
        ...traceFields(),
        ...contextFields(context?.()),
      }),
      redact: { paths: redactPaths, censor: "[REDACTED]" },
    },
    options.destination,
  );

  const coded =
    (level: "warn" | "error" | "fatal") =>
    (code: keyof typeof messageCodes, fields?: LogFields): void => {
      base[level]({ ...fields, "event.code": code }, messageCodes[code].message);
    };

  return {
    debug: (message, fields) => base.debug({ ...fields }, message),
    info: (message, fields) => base.info({ ...fields }, message),
    warn: coded("warn"),
    error: coded("error"),
    fatal: coded("fatal"),
  };
}

/**
 * 入口の起動を包む。起動が失敗したら `fatal` を出し、終了コードを非ゼロにする。`process.exit()` は呼ばない:
 * 書きかけの出力と後始末を切らないため。
 */
export async function startOrFail(logger: FatalLogger, start: () => unknown): Promise<void> {
  try {
    await start();
  } catch (error) {
    logger.fatal("API-002", exceptionFields(error));
    process.exitCode = 1;
  }
}
