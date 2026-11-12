import {
  commonProblemResponses,
  commonProblemTypes,
  problemResponse,
} from "@agent-software-factory/shared-kernel/problem";
import { createRoute, z } from "@hono/zod-openapi";

import type { Auth } from "../../auth/auth.ts";
import { createRouter } from "./router.ts";

// `/api/me` は auth の有無で route の型を変えない (spec と AppType に常に入る)。auth がなければ session が入らないので 401。
// `/api/auth/*` は Better Auth が扱う経路で、契約の外に置く (docs/adr/0035)。
const meRoute = createRoute({
  method: "get",
  path: "/api/me",
  operationId: "getCurrentUser",
  summary: "Current user",
  description:
    "Returns the user of the current session. Responds 401 when there is no valid session.",
  tags: ["auth"],
  responses: {
    200: {
      description: "The signed-in user.",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string(),
            email: z.email(),
            name: z.string(),
            roles: z
              .array(z.string())
              .describe(
                "Roles of the user in the active tenant, such as accounting. Empty when there is none.",
              ),
          }),
        },
      },
    },
    401: commonProblemResponses[401],
  },
});

// member の role は、複数の役割をコンマで区切って持つ (Better Auth の organization plugin)。
async function activeRoles(auth: Auth, headers: Headers): Promise<string[]> {
  // active organization のメンバーでなくなった (退職など) 利用者は、Better Auth が 403 を投げる。役割はなく、
  // ログインは続けられる。ほかの失敗でも、メニューが減るだけで (空の roles)、操作の認可は API の application 層が行う。
  const role = await auth.betterAuth.api
    .getActiveMemberRole({ headers })
    .then((member) => member.role)
    .catch(() => "");
  return role.split(",").filter((name) => name !== "");
}

export function meRoutes(auth: Auth | undefined) {
  return createRouter().openapi(meRoute, async (c) => {
    const session = c.get("session");
    const user = session?.user;
    if (user === undefined) {
      return problemResponse(c, {
        type: commonProblemTypes.unauthenticated,
        title: "Authentication is required.",
        status: 401,
      });
    }
    // 役割はアプリの DB (member の行) にあり、セッションの active organization で引く (docs/adr/0022)。
    // 画面の出し分けのための値で、操作の認可は API の application 層が行う (docs/adr/0045)。
    const roles =
      auth !== undefined && session?.session.activeOrganizationId
        ? await activeRoles(auth, c.req.raw.headers)
        : [];
    return c.json({ id: user.id, email: user.email, name: user.name, roles }, 200);
  });
}
