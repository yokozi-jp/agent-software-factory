import { z } from "@hono/zod-openapi";
import { trace } from "@opentelemetry/api";
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// RFC 9457 の Problem Details (docs/adr/0035)。API のエラー応答は、この 1 つのファイルの関数を通す。
// 識別子は `type` だけで、`code` の拡張は足さない。

const PROBLEM_CONTENT_TYPE = "application/problem+json";

/** The `type` of a problem that the status code alone explains (RFC 9457 4.2.1). */
export const ABOUT_BLANK = "about:blank";

/** Problem types that are not tied to one module. A route lists the ones it can return. */
export const commonProblemTypes = {
  validation: "/problems/validation",
  unauthenticated: "/problems/unauthenticated",
  sessionExpired: "/problems/session-expired",
  forbiddenOrigin: "/problems/forbidden-origin",
  forbiddenCrossSiteRequest: "/problems/forbidden-cross-site-request",
} as const;

export type CommonProblemType = (typeof commonProblemTypes)[keyof typeof commonProblemTypes];

/** `ApprovalNotAllowed` → `approval-not-allowed`. The type-level twin of `toKebab`. */
export type Kebab<
  S extends string,
  First extends boolean = true,
> = S extends `${infer Head}${infer Rest}`
  ? `${Head extends Lowercase<Head> ? Head : `${First extends true ? "" : "-"}${Lowercase<Head>}`}${Kebab<Rest, false>}`
  : S;

function toKebab(tag: string): string {
  return tag.replaceAll(/(?<!^)([A-Z])/g, "-$1").toLowerCase();
}

/**
 * The `type` of every failure `_tag` of a module: `/problems/<module>/<kebab-tag>`. The keys must be exactly the
 * `_tag` union (`Tag`), so a `_tag` added to the domain and forgotten here fails the type check.
 */
export function problemTypes<const Module extends string, Tag extends string>(
  module: Module,
  tags: { readonly [K in Tag]: true },
): { readonly [K in Tag]: `/problems/${Module}/${Kebab<K>}` } {
  const types: Record<string, string> = Object.fromEntries(
    Object.keys(tags).map((tag) => [tag, `/problems/${module}/${toKebab(tag)}`]),
  );
  if (!isTypesOf<Module, Tag>(types)) throw new Error("unreachable");
  return types;
}

/**
 * `types` was built from the keys of `tags`, which the signature of `problemTypes` limits to `Tag`, so it has one
 * entry per `Tag` and the template literal type of each is what `toKebab` computes. TypeScript cannot follow that.
 */
function isTypesOf<Module extends string, Tag extends string>(
  _types: Record<string, string>,
): _types is { readonly [K in Tag]: `/problems/${Module}/${Kebab<K>}` } {
  return true;
}

const problemBase = {
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  trace_id: z.string().optional(),
};

/**
 * The schema of a problem whose `type` is one of `types`. TypeScript sees a union of literals. The spec shows `type`
 * as `string` with `x-extensible-enum`, so adding a value is not a breaking change for oasdiff (docs/adr/0035).
 */
export function problemSchema<const Types extends readonly [string, ...string[]]>(types: Types) {
  return z.object({
    type: z
      .custom<Types[number]>((value) => typeof value === "string" && types.includes(value))
      .openapi({ type: "string", "x-extensible-enum": [...types] }),
    ...problemBase,
  });
}

/** One invalid input. `pointer` is a JSON Pointer, `code` is the `code` of the zod issue; the web writes the text. */
export const validationErrorSchema = z.object({
  pointer: z.string(),
  code: z.string(),
});

export type ValidationError = z.infer<typeof validationErrorSchema>;

export const validationProblemSchema = z.object({
  type: z.literal(commonProblemTypes.validation),
  ...problemBase,
  errors: z.array(validationErrorSchema.catchall(z.unknown())),
});

const aboutBlankProblemSchema = z.object({ type: z.literal(ABOUT_BLANK), ...problemBase });

const unauthenticatedProblemSchema = problemSchema([
  commonProblemTypes.unauthenticated,
  commonProblemTypes.sessionExpired,
]);

const forbiddenProblemSchema = problemSchema([
  commonProblemTypes.forbiddenOrigin,
  commonProblemTypes.forbiddenCrossSiteRequest,
]);

function problemContent<S extends z.ZodType>(schema: S) {
  return { [PROBLEM_CONTENT_TYPE]: { schema } };
}

/**
 * The responses every route can return: 400 (validation), 401, 403 (CSRF), 415, 500. Spread it into `responses`,
 * and write the 422 and 409 of the route after it.
 */
export const commonProblemResponses = {
  400: { description: "The request is invalid.", content: problemContent(validationProblemSchema) },
  401: {
    description: "There is no valid session.",
    content: problemContent(unauthenticatedProblemSchema),
  },
  403: {
    description: "The request is refused by the CSRF protection.",
    content: problemContent(forbiddenProblemSchema),
  },
  415: {
    description: "The Content-Type is not application/json.",
    content: problemContent(aboutBlankProblemSchema),
  },
  500: {
    description: "An unexpected error happened.",
    content: problemContent(aboutBlankProblemSchema),
  },
} as const;

/** Every `type` a problem can have: `about:blank`, a common one, or a module one (`/problems/<module>/<kebab-tag>`). */
export type ProblemType = typeof ABOUT_BLANK | CommonProblemType | `/problems/${string}/${string}`;

export interface ProblemInput {
  readonly type: ProblemType;
  readonly title: string;
  readonly status: ContentfulStatusCode;
  readonly detail?: string;
  readonly errors?: readonly object[];
}

/** The trace id of the current span, if there is one. */
function currentTraceId(): string | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  return spanContext !== undefined && trace.isSpanContextValid(spanContext)
    ? spanContext.traceId
    : undefined;
}

/**
 * The only function that builds an error response. A 5xx carries `type`, `title`, `status` and `trace_id` only: no
 * `detail`, no `errors`, whatever the caller passes.
 */
export function problemResponse(c: Context, input: ProblemInput) {
  const isServerError = input.status >= 500;
  const traceId = currentTraceId();
  const body = {
    type: input.type,
    title: input.title,
    status: input.status,
    ...(!isServerError && input.detail !== undefined ? { detail: input.detail } : {}),
    ...(!isServerError && input.errors !== undefined ? { errors: input.errors } : {}),
    ...(traceId !== undefined ? { trace_id: traceId } : {}),
  };
  return c.body(JSON.stringify(body), input.status, { "Content-Type": PROBLEM_CONTENT_TYPE });
}

const statusTitles: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Content Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

/** The `title` of a problem that the status code alone explains (`about:blank`). */
export function statusTitle(status: number): string {
  return statusTitles[status] ?? (status >= 500 ? "Server Error" : "Client Error");
}

/**
 * For `app.onError`. An `HTTPException` becomes its status as `about:blank`; any other error becomes a 500.
 * The `res` of an `HTTPException` is ignored on purpose: every error response is built here, in one shape.
 * `onServerError` receives every error that answers 5xx, to write the log; the response never carries the message.
 */
export function problemErrorHandler(
  onServerError: (error: Error, c: Context) => void,
): ErrorHandler {
  return (error, c) => {
    const status = error instanceof HTTPException ? error.status : 500;
    if (status >= 500) onServerError(error, c);
    return problemResponse(c, { type: ABOUT_BLANK, title: statusTitle(status), status });
  };
}

/** For `app.notFound`. */
export const problemNotFoundHandler: NotFoundHandler = (c) =>
  problemResponse(c, { type: ABOUT_BLANK, title: statusTitle(404), status: 404 });
