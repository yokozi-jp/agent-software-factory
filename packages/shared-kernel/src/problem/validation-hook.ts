import { OpenAPIHono, type Hook } from "@hono/zod-openapi";
import type { Env } from "hono";

import { commonProblemTypes, problemResponse } from "./problem.ts";

// 検証エラー (400) は、shared-kernel の problemResponse で作る (docs/adr/0035、docs/adr/0047)。
// `errors` の要素は、web が i18n で文面にするための `pointer` (JSON Pointer) と `code` (zod の issue の code)。
// route に応答のステータスとして 400 を書くと、spec にも出る (commonProblemResponses)。
function toPointer(path: readonly PropertyKey[]): string {
  return path.map((key) => `/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

export function validationHook<T, E extends Env, P extends string>(
  ...[result, c]: Parameters<Hook<T, E, P, unknown>>
): ReturnType<Hook<T, E, P, unknown>> {
  if (result.success) return;
  return problemResponse(c, {
    type: commonProblemTypes.validation,
    title: "Request validation failed.",
    status: 400,
    errors: result.error.issues.map((issue) => ({
      pointer: toPointer(issue.path),
      code: issue.code,
    })),
  });
}

/**
 * The sub-app of a route file (docs/adr/0047): an `OpenAPIHono` whose validation errors are the Problem Details of
 * `validationHook`. Both `apps/api` and the `http` layer of a module make their sub-apps with it, so a module does not
 * import `apps/api`. `defaultHook` is the one of the app that registers the route, so every sub-app passes it; the hook
 * of a parent app does not reach it. `E` is the Hono environment of the sub-app: the variables its handlers read.
 */
export function createRouter<E extends Env = Env>() {
  return new OpenAPIHono<E>({ defaultHook: validationHook });
}
