import type { Hook } from "@hono/zod-openapi";
import type { Env } from "hono";

// 検証エラー (400) の形は、この 1 か所で決める (docs/adr/0035、docs/adr/0047)。RFC 9457 の Problem Details で、識別子は
// `type` だけ。`errors` の要素は web が i18n で文面にするための `pointer` (JSON Pointer) と `code` (zod の issue の code)。
// route に応答のステータスとして 400 を書くと、spec にも出る。
const VALIDATION_PROBLEM_TYPE = "/problems/validation";

function toPointer(path: readonly PropertyKey[]): string {
  return path.map((key) => `/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

export function validationHook<T, E extends Env, P extends string>(
  ...[result, c]: Parameters<Hook<T, E, P, unknown>>
): ReturnType<Hook<T, E, P, unknown>> {
  if (result.success) return;
  const problem = {
    type: VALIDATION_PROBLEM_TYPE,
    title: "Request validation failed.",
    status: 400,
    errors: result.error.issues.map((issue) => ({
      pointer: toPointer(issue.path),
      code: issue.code,
    })),
  };
  return c.body(JSON.stringify(problem), 400, { "Content-Type": "application/problem+json" });
}
