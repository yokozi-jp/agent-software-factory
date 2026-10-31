/**
 * 権限のない画面を開いたことを表す。route の `beforeLoad` や loader が投げ、経理専用の layout の
 * `errorComponent` が、URL を変えずに 403 の画面を出す。API が 403 を返したときは、loader が
 * `throwOnForbiddenOrNotFound` (api-error.ts) でこれを投げて、同じ画面にする。
 * API の認可が正で、ここは UX のため (docs/web-frontend/authorization.md)。
 */
export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}
