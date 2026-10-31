import { commonProblemTypes, problemResponse } from "@agent-software-factory/shared-kernel/problem";
import type { MiddlewareHandler } from "hono";

import type { Auth } from "./auth.ts";

type Session = NonNullable<Awaited<ReturnType<Auth["betterAuth"]["api"]["getSession"]>>>;

export type SessionVariables = {
  /** Cookie のセッション。なければ null。`sessionGuard` が入れる。 */
  session: Session | null;
};

/**
 * `/api/*` の全部に付ける。Cookie のセッションを読み、`c.get("session")` に入れる (docs/adr/0022)。
 * - 無操作の期限は Better Auth が見る。使われ続けても切る最長の期限は、ここで見る。
 *   Better Auth 自身の経路 (`/api/auth/get-session` など) も同じ検査を通すため、全部の前に置く。
 * - 無操作の期限を延ばしたとき、Better Auth は新しい期限の Set-Cookie を返す。それを応答に付けないと、
 *   ブラウザは最初にもらった Cookie の期限で、使われている間も Cookie を捨てる。
 */
export function sessionGuard(auth: Auth): MiddlewareHandler<{ Variables: SessionVariables }> {
  const { api } = auth.betterAuth;

  return async (c, next) => {
    const { headers, response: session } = await api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });

    if (session !== null) {
      // Better Auth gives `createdAt` as a Date, and this middleware is an entry point that reads the clock itself.
      // Issue #404 replaces this with the Clock of the entry point once the entry passes a ManagedRuntime.
      // oxlint-disable-next-line no-restricted-globals -- the absolute lifetime compares with Better Auth's Date
      const ageMs = Date.now() - session.session.createdAt.getTime();
      if (ageMs > auth.absoluteSessionSeconds * 1000) {
        // DB の行と Cookie を消す。
        const revoked = await api.signOut({ headers: c.req.raw.headers, returnHeaders: true });
        for (const cookie of revoked.headers.getSetCookie()) {
          c.header("set-cookie", cookie, { append: true });
        }
        return problemResponse(c, {
          type: commonProblemTypes.sessionExpired,
          title: "The session has expired.",
          status: 401,
        });
      }
    }

    c.set("session", session);
    await next();

    for (const cookie of headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
    return undefined;
  };
}

/** セッションがなければ 401 を返す。`sessionGuard` のあとに置く。 */
export function requireSession(): MiddlewareHandler<{ Variables: SessionVariables }> {
  return async (c, next) => {
    if (c.get("session") === null) {
      return problemResponse(c, {
        type: commonProblemTypes.unauthenticated,
        title: "Authentication is required.",
        status: 401,
      });
    }
    return next();
  };
}
