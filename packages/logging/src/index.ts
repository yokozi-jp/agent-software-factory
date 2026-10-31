// 実行環境を選ばない入口 (docs/adr/0049)。アプリのコードはこの `Logger` にだけ依存する。pino と @opentelemetry の
// SDK は ./node (Node 専用の入口) に閉じる。docs/logging の規約の実装。

/** `LOG_LEVEL` に書ける値。`fatal` は入口が起動の失敗に使うので、設定では選ばない。 */
export const logLevels = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof logLevels)[number];

/**
 * 呼び出し側が渡せるキー (docs/logging/keys.md)。ここにないキーは、オブジェクトリテラルで渡すと型検査で落ちる。
 * 発生源で秘匿情報を載せない 1 層目 (docs/logging/security.md): 値が秘匿情報になるキーはここに書かない。
 * `service.*`、`trace_id` などの共通のキーと `event.code` は、ロガーの実装が足す。
 */
export interface LogFields {
  readonly "http.request.method"?: string;
  readonly "url.path"?: string;
  readonly "http.response.status_code"?: number;
  /** 秒 (OTel の http.server.request.duration の単位)。 */
  readonly "http.server.request.duration"?: number;
  readonly "user_agent.original"?: string;
  /** 失敗の理由。Problem の `type` (docs/adr/0035)。 */
  readonly "error.type"?: string;
  readonly "exception.type"?: string;
  readonly "exception.message"?: string;
  readonly "exception.stacktrace"?: string;
  readonly "event.kind"?: "event";
  readonly "event.category"?: "web" | "authentication" | "iam";
  readonly "event.outcome"?: "failure" | "success";
}

/** リクエストの文脈 (`hono/context-storage`。ワーカーとバッチは入口の `AsyncLocalStorage.run`)。ロガーが毎行に付ける。 */
export interface LogContext {
  readonly requestId?: string;
  readonly tenantId?: string;
  readonly userId?: string;
}

interface MessageDefinition {
  readonly level: "warn" | "error" | "fatal";
  /** 何が起きたかを 1 行で。ログの `message` になる。 */
  readonly message: string;
  /** 発生原因。 */
  readonly cause: string;
  /** 運用者が取る対応。空にしない。 */
  readonly action: string;
}

/**
 * メッセージコードの定義 (docs/logging/message-codes.md)。`warn` 以上のログは、この定義のキーだけを受け取る。
 * キーの形は `<領域>-<3桁>`。想定外の例外は、領域ごとに固定のコード (`API-001`)。
 */
export const messageCodes = {
  "API-001": {
    level: "error",
    message: "An unexpected error occurred while handling a request.",
    cause:
      "A bug in the API, or a dependency (the database, an external service) failed during a request. The response was 500.",
    action:
      "Find the request by http.request.id or trace_id, and read exception.type and exception.stacktrace. If the same exception.type repeats, treat it as an incident.",
  },
  "API-002": {
    level: "fatal",
    message: "The API failed to start.",
    cause:
      "The environment variables are missing or malformed, or a dependency was unreachable at start-up. The process exits with a non-zero code.",
    action:
      "Read exception.message, which names the variable and the reason but not its value. Fix the setting and deploy again.",
  },
} as const satisfies Record<`${string}-${number}${number}${number}`, MessageDefinition>;

export type MessageCode = keyof typeof messageCodes;
type CodeOf<Level extends MessageDefinition["level"]> = {
  [Code in MessageCode]: (typeof messageCodes)[Code]["level"] extends Level ? Code : never;
}[MessageCode];

/**
 * アプリが依存するロガー。`debug` と `info` は自由な文言、`warn` と `error` は `messageCodes` のキーだけを受け取る
 * (文言は定義から付き、`event.code` にそのキーが出る)。`fatal` は入口だけが使う (`./node` の `NodeLogger`)。
 */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(code: CodeOf<"warn">, fields?: LogFields): void;
  error(code: CodeOf<"error">, fields?: LogFields): void;
}

/** 入口が起動の失敗に使う。 */
export interface FatalLogger extends Logger {
  fatal(code: CodeOf<"fatal">, fields?: LogFields): void;
}

/**
 * 例外から出すのは、型、メッセージ、スタックトレースだけにする。pg のエラーが持つ `detail`、`where`、`parameters` は
 * 行の値を含むので、例外の他のプロパティは読まない (docs/logging/security.md)。
 */
export function exceptionFields(
  error: unknown,
): Pick<LogFields, "exception.type" | "exception.message" | "exception.stacktrace"> {
  if (error instanceof Error)
    return {
      "exception.type": error.name,
      "exception.message": error.message,
      ...(error.stack === undefined ? {} : { "exception.stacktrace": error.stack }),
    };
  return { "exception.type": typeof error, "exception.message": "A non-Error value was thrown." };
}

/** 何も出さない。ロガーを渡さないで `createApp` を呼ぶテストと、`vp dev` が使う。 */
export const noopLogger: FatalLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};
