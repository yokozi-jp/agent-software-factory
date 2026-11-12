import { createRouter as createSharedRouter } from "@agent-software-factory/shared-kernel/problem";

import type { ApiVariables } from "../middleware/logging.ts";

/**
 * route のファイルが作る sub-app (docs/adr/0047)。app.ts が `.route("/", …)` で付ける。
 * 検証エラーの hook を渡した `OpenAPIHono` は shared-kernel の `createRouter` で、モジュールの `http` 層も同じものを使う。
 * `defaultHook` は route を登録する app のものが使われるので、sub-app ごとに渡す。親の app の hook は届かない。
 */
export function createRouter() {
  return createSharedRouter<{ Variables: ApiVariables }>();
}
