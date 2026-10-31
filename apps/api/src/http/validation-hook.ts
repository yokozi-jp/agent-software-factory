import { commonProblemTypes, problemResponse } from "@agent-software-factory/shared-kernel";
import type { Hook } from "@hono/zod-openapi";
import type { Env } from "hono";

// 検証エラー (400) は、shared-kernel の problemResponse で作る (docs/adr/0035、docs/adr/0047)。識別子は `type` だけ。`errors` の要素は web が i18n で文面にするための `pointer` (JSON Pointer) と `code` (zod の issue の code)。
// route に応答のステータスとして 400 を書くと、spec にも出る。

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
