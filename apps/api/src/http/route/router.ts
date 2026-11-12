import { OpenAPIHono } from "@hono/zod-openapi";

import { validationHook } from "../hook/validation-hook.ts";
import type { ApiVariables } from "../middleware/logging.ts";

/**
 * route のファイルが作る sub-app (docs/adr/0047)。app.ts が `.route("/", …)` で付ける。
 * `defaultHook` は route を登録する app のものが使われるので、sub-app ごとに渡す。親の app の hook は届かない。
 */
export function createRouter() {
  return new OpenAPIHono<{ Variables: ApiVariables }>({ defaultHook: validationHook });
}
