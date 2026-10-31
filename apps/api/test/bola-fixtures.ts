import { createRoute, z } from "@hono/zod-openapi";
import type { TestDatabase } from "@agent-software-factory/db/testing";
import { randomUUID } from "node:crypto";

import type { createApp } from "../src/app.ts";
import { requireSession } from "../src/auth/session.ts";
import type { ResourceContext, ResourceFactory } from "./bola.ts";

// BOLA のテストの検出力を確かめる fixture (docs/adr/0045)。メモを持ち主ごとに持つ route を、アプリに足す。
// `leak` で、わざと絞り込みを外した route を作る。業務の route はまだ id を持たないので、仕組みはこの route で動かす。
//   - none: 持ち主で絞り込む。404 の Problem Details を返す。
//   - read: GET が持ち主で絞り込まず、他人のメモを読める。
//   - write: PUT が持ち主を確かめる前に更新し、そのあとで 404 を返す。応答は 404 でも、他人の行が変わる。
export type Leak = "none" | "read" | "write";

const noteParams = z.object({ id: z.uuid() });
const note = z.object({ id: z.uuid(), body: z.string() });
const problem = z.object({ type: z.string(), title: z.string(), status: z.literal(404) });
const notFound = {
  description: "The note does not exist, or belongs to another employee.",
  content: { "application/problem+json": { schema: problem } },
};

const getNote = createRoute({
  method: "get",
  path: "/api/notes/{id}",
  request: { params: noteParams },
  responses: {
    200: { description: "The note.", content: { "application/json": { schema: note } } },
    404: notFound,
  },
});

const putNote = createRoute({
  method: "put",
  path: "/api/notes/{id}",
  request: {
    params: noteParams,
    body: { content: { "application/json": { schema: z.object({ body: z.string() }) } } },
  },
  responses: {
    200: { description: "The note.", content: { "application/json": { schema: note } } },
    404: notFound,
  },
});

const notFoundBody = { type: "about:blank", title: "Not Found", status: 404 as const };
const problemHeaders = { "Content-Type": "application/problem+json" };

/** `notes` の表を作り、アプリに GET と PUT の `/api/notes/{id}` を足す。 */
export async function addNoteRoutes(
  app: ReturnType<typeof createApp>,
  db: TestDatabase,
  leak: Leak,
): Promise<void> {
  await db.superuser.query(
    `CREATE TABLE public.bola_note (id uuid PRIMARY KEY, owner_id text NOT NULL, body text NOT NULL);
     GRANT SELECT, INSERT, UPDATE, DELETE ON public.bola_note TO app_user`,
  );
  app.use("/api/notes/*", requireSession());

  app.openapi(getNote, async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("session")?.user.id ?? "";
    const { rows } =
      leak === "read"
        ? await db.appUser.query<{ id: string; body: string }>(
            "SELECT id, body FROM public.bola_note WHERE id = $1",
            [id],
          )
        : await db.appUser.query<{ id: string; body: string }>(
            "SELECT id, body FROM public.bola_note WHERE id = $1 AND owner_id = $2",
            [id, userId],
          );
    const found = rows[0];
    if (found === undefined) return c.json(notFoundBody, 404, problemHeaders);
    return c.json(found, 200);
  });

  app.openapi(putNote, async (c) => {
    const { id } = c.req.valid("param");
    const { body } = c.req.valid("json");
    const userId = c.get("session")?.user.id ?? "";
    const { rows } =
      leak === "write"
        ? await db.appUser.query<{ id: string; owner_id: string }>(
            "UPDATE public.bola_note SET body = $2 WHERE id = $1 RETURNING id, owner_id",
            [id, body],
          )
        : await db.appUser.query<{ id: string; owner_id: string }>(
            "UPDATE public.bola_note SET body = $2 WHERE id = $1 AND owner_id = $3 RETURNING id, owner_id",
            [id, body, userId],
          );
    if (rows[0] === undefined || rows[0].owner_id !== userId) {
      return c.json(notFoundBody, 404, problemHeaders);
    }
    return c.json({ id, body }, 200);
  });
}

/** 持ち主のメモを 1 行作る。 */
export const createNote: ResourceFactory = async ({ owner, superuser }: ResourceContext) => {
  const id = randomUUID();
  await superuser.query("INSERT INTO public.bola_note (id, owner_id, body) VALUES ($1, $2, $3)", [
    id,
    owner.userId,
    "owner's note",
  ]);
  return { params: { id }, body: { body: "overwritten by the other employee" } };
};
