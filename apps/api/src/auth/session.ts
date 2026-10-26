import type { MiddlewareHandler } from "hono";

import type { Auth } from "./auth.ts";

export type SessionVariables = {
  session: NonNullable<Awaited<ReturnType<Auth["betterAuth"]["api"]["getSession"]>>>;
};

/**
 * Cookie のセッションがなければ 401 を返す。あれば `c.get("session")` で取れる。
 * 無操作の期限は Better Auth が見る。使われ続けても切る最長の期限は、ここで見る (docs/adr/0022)。
 */
export function requireSession(auth: Auth): MiddlewareHandler<{ Variables: SessionVariables }> {
  const { api } = auth.betterAuth;

  return async (c, next) => {
    const session = await api.getSession({ headers: c.req.raw.headers });
    if (session === null) return c.json({ error: "unauthenticated" }, 401);

    const ageMs = Date.now() - session.session.createdAt.getTime();
    if (ageMs > auth.absoluteSessionSeconds * 1000) {
      // DB の行と Cookie を消す。
      const { headers } = await api.signOut({ headers: c.req.raw.headers, returnHeaders: true });
      for (const cookie of headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
      return c.json({ error: "session expired" }, 401);
    }

    c.set("session", session);
    return next();
  };
}
