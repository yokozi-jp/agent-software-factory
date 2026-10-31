import {
  exceptionFields,
  type LogContext,
  type LogFields,
  type Logger,
} from "@agent-software-factory/logging";
import { commonProblemTypes } from "@agent-software-factory/shared-kernel";
import type { Context, MiddlewareHandler } from "hono";
import { tryGetContext } from "hono/context-storage";

import type { SessionVariables } from "../auth/session.ts";

// API のロギング (docs/adr/0049、docs/logging/web-api.md)。ロガーの実装は packages/logging にあり、ここは Hono との接点だけを持つ。
// middleware の順序は app.ts にある: contextStorage() → @hono/otel → requestContext() → accessLog() の順で、
// otel の後ろに置かないとログに trace_id が付かない。
interface LoggingVariables {
  /** `requestContext()` が入れる。ログの `http.request.id`。 */
  requestId: string;
  /** テナントを決める middleware が入れる (今は入れるものがない)。ログの `tenant_id`。 */
  tenantId?: string;
}

export type ApiVariables = SessionVariables & LoggingVariables;
type ApiEnv = { Variables: ApiVariables };

// 受け取った ID をそのままログに載せない。改行や長い文字列でログを読みにくくされないよう、形が合うときだけ使う。
const acceptedRequestId = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * リクエストの ID を決めて `c.set` する。`X-Request-Id` が形に合えばそれを、なければ採番する。
 * ログの文脈 (`requestLogContext`) が、`user.id` とともに毎行に付ける。
 */
export function requestContext(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const received = c.req.header("x-request-id");
    c.set(
      "requestId",
      received !== undefined && acceptedRequestId.test(received) ? received : crypto.randomUUID(),
    );
    await next();
  };
}

/**
 * ロガーが毎行に付ける文脈。`hono/context-storage` から今のリクエストを読む。リクエストの外 (起動のとき) は undefined。
 * `user.id` は session guard が入れたあとの値を、書くときに読む。
 */
export function requestLogContext(): LogContext | undefined {
  const c = tryGetContext<ApiEnv>();
  if (c === undefined) return undefined;
  const userId = c.get("session")?.user.id;
  const tenantId = c.get("tenantId");
  return {
    requestId: c.get("requestId"),
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(userId === undefined ? {} : { userId }),
  };
}

const healthPath = "/health";

function requestFields(c: Context): LogFields {
  const userAgent = c.req.header("user-agent");
  return {
    "http.request.method": c.req.method,
    "url.path": c.req.path,
    // クライアントが決める値なので、長さを切る (1 リクエストが 2 行に載せる)。
    ...(userAgent === undefined ? {} : { "user_agent.original": userAgent.slice(0, 512) }),
  };
}

async function problemTypeOf(response: Response): Promise<string | undefined> {
  if (!response.headers.get("content-type")?.includes("application/problem+json")) return undefined;
  try {
    const body: unknown = await response.clone().json();
    if (
      typeof body === "object" &&
      body !== null &&
      "type" in body &&
      typeof body.type === "string"
    )
      return body.type;
  } catch {
    // 本文が JSON でなければ、理由は分からない。
  }
  return undefined;
}

// 理由つきで記録する応答 (docs/logging/web-api.md、OWASP Logging Cheat Sheet)。401 は認証、403 は認可の失敗、
// 400 は入力の検証の失敗。それ以外の 4xx は出さない。alarm fog を避けるため、レベルは info にする。
function rejection(
  status: number,
  type: string | undefined,
): Pick<LogFields, "event.category"> | undefined {
  if (status === 401) return { "event.category": "authentication" };
  if (status === 403) return { "event.category": "iam" };
  if (status === 400 && type === commonProblemTypes.validation) return { "event.category": "web" };
  return undefined;
}

/**
 * アクセスログ。要求時と応答時の両方を info で出す。`/health` は出さず、`OPTIONS` は出す。
 * `client.address` は出さない (Issue #321 で決める)。401、403、400 の検証失敗は、応答のあとに理由つきで 1 行足す。
 * 5xx は `app.onError` が書く (`logUnexpectedError`)。
 */
export function accessLog(logger: Logger): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (c.req.path === healthPath) return next();
    const fields = requestFields(c);
    logger.info("request received", fields);
    const startedAt = performance.now();

    await next();

    const status = c.res.status;
    logger.info("request completed", {
      ...fields,
      "http.response.status_code": status,
      "http.server.request.duration": (performance.now() - startedAt) / 1000,
    });
    const type = await problemTypeOf(c.res);
    const reason = rejection(status, type);
    // 理由 (Problem の type) が読めない 401 と 403 も、理由なしで残す。
    if (reason !== undefined)
      logger.info("request rejected", {
        ...fields,
        ...reason,
        "http.response.status_code": status,
        ...(type === undefined ? {} : { "error.type": type }),
        "event.kind": "event",
        "event.outcome": "failure",
      });
    return undefined;
  };
}

/** `problemErrorHandler` に渡す。5xx になった例外を error で 1 行書く。応答の変換は shared-kernel の `problemErrorHandler`。 */
export function logUnexpectedError(logger: Logger): (error: Error, c: Context) => void {
  return (error, c) => {
    logger.error("API-001", {
      ...requestFields(c),
      ...exceptionFields(error),
      "event.kind": "event",
      "event.category": "web",
      "event.outcome": "failure",
    });
  };
}
