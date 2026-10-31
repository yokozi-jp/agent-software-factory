import { notFound } from "@tanstack/react-router";

import { ForbiddenError } from "./forbidden.ts";

/**
 * loader が API の応答を受けたとき、403 と 404 を画面の失敗に変える (docs/web-frontend/authorization.md)。
 * 403 は `ForbiddenError` (経理専用の layout の `errorComponent` が、URL を変えずに 403 の画面を出す)、
 * 404 は `notFound()` (`_authenticated` の `notFoundComponent` が、メニューの中に 404 の画面を出す。他人の申請も同じ)。
 * 401 は `withSessionExpiry` が `/login` に移すので、ここでは扱わない。ほかの応答はそのまま返す。
 */
export function throwOnForbiddenOrNotFound(response: Response): Response {
  if (response.status === 403) throw new ForbiddenError();
  // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router の notFound() は throw する値で、Error ではない
  if (response.status === 404) throw notFound();
  return response;
}
