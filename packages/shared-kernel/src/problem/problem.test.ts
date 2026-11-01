import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { hc } from "hono/client";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";

import {
  commonProblemResponses,
  problemErrorHandler,
  problemNotFoundHandler,
  problemResponse,
  problemSchema,
  problemTypes,
  statusTitle,
  validationProblemSchema,
  type CommonProblemType,
} from "./problem.ts";

const approvalTypes = problemTypes("expense", { ApprovalNotAllowed: true, AlreadyApproved: true });

describe("problemTypes", () => {
  it("_tag から /problems/<module>/<kebab-tag> を作る", () => {
    expect(approvalTypes).toEqual({
      ApprovalNotAllowed: "/problems/expense/approval-not-allowed",
      AlreadyApproved: "/problems/expense/already-approved",
    });
  });

  it("type は文字列リテラルの型になる", () => {
    expectTypeOf(
      approvalTypes.ApprovalNotAllowed,
    ).toEqualTypeOf<"/problems/expense/approval-not-allowed">();
  });

  it("_tag を書き漏らすと型検査が落ちる", () => {
    type Tag = "A" | "B";
    // @ts-expect-error -- B is missing
    expect(problemTypes<"expense", Tag>("expense", { A: true })).toBeDefined();
    // @ts-expect-error -- C is not a tag
    expect(problemTypes<"expense", Tag>("expense", { A: true, B: true, C: true })).toBeDefined();
  });
});

describe("problemSchema", () => {
  const schema = problemSchema(["/problems/x/a", "/problems/x/b"]);

  it("type をリテラルの union にする", () => {
    expectTypeOf<z.infer<typeof schema>["type"]>().toEqualTypeOf<
      "/problems/x/a" | "/problems/x/b"
    >();
  });

  it("並べていない type を拒む", () => {
    expect(schema.safeParse({ type: "/problems/x/c", title: "x", status: 422 }).success).toBe(
      false,
    );
    expect(schema.safeParse({ type: "/problems/x/a", title: "x", status: 422 }).success).toBe(true);
  });

  it("spec では type を string と x-extensible-enum にする", () => {
    const app = new OpenAPIHono().openapi(
      createRoute({
        method: "get",
        path: "/x",
        responses: {
          422: { description: "d", content: { "application/problem+json": { schema } } },
        },
      }),
      (c) => c.json({ type: "/problems/x/a" as const, title: "t", status: 422 }, 422),
    );
    const doc = app.getOpenAPI31Document({ openapi: "3.1.0", info: { title: "t", version: "0" } });
    const type = JSON.stringify(doc.paths?.["/x"]?.get?.responses?.["422"]);
    expect(type).toContain('"x-extensible-enum":["/problems/x/a","/problems/x/b"]');
    expect(type).not.toContain('"enum"');
    expect(type).toContain('"type":"string"');
  });
});

describe("commonProblemResponses", () => {
  it("400、401、403、415、500 を application/problem+json で宣言する", () => {
    const responses = commonProblemResponses;
    expect(Object.keys(responses)).toEqual(["400", "401", "403", "415", "500"]);
    for (const response of Object.values(responses)) {
      expect(Object.keys(response.content)).toEqual(["application/problem+json"]);
    }
  });

  it("400 の type は /problems/validation", () => {
    expectTypeOf<CommonProblemType>().toMatchTypeOf<string>();
    expect(
      validationProblemSchema.safeParse({
        type: "/problems/validation",
        title: "t",
        status: 400,
        errors: [{ pointer: "/a", code: "invalid_type" }],
      }).success,
    ).toBe(true);
  });
});

describe("problemResponse", () => {
  const app = new OpenAPIHono();
  app.get("/p", (c) =>
    problemResponse(c, { type: "/problems/x/a", title: "A.", status: 422, detail: "d" }),
  );
  app.get("/blank", (c) =>
    problemResponse(c, { type: "about:blank", title: "Not Found", status: 404 }),
  );

  it("application/problem+json で、指定のステータスを返す", async () => {
    const res = await app.request("/p");
    expect(res.status).toBe(422);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await res.json()).toEqual({
      type: "/problems/x/a",
      title: "A.",
      status: 422,
      detail: "d",
    });
  });

  it("今の span がなければ trace_id を付けない", async () => {
    const body = await (await app.request("/blank")).json();
    expect(body).not.toHaveProperty("trace_id");
  });
});

describe("statusTitle", () => {
  it("表にあるステータスはその名前を、表にないものは 5xx なら Server Error、それ以外は Client Error を返す", () => {
    expect([statusTitle(404), statusTitle(599), statusTitle(418)]).toEqual([
      "Not Found",
      "Server Error",
      "Client Error",
    ]);
  });
});

describe("problemErrorHandler", () => {
  const logged: unknown[] = [];
  const app = new OpenAPIHono();
  app.onError(problemErrorHandler((error) => logged.push(error)));
  app.notFound(problemNotFoundHandler);
  app.get("/boom", () => {
    throw new Error("secret database password");
  });
  app.get("/teapot", async () => {
    const { HTTPException } = await import("hono/http-exception");
    throw new HTTPException(400, { message: "Malformed JSON in request body" });
  });

  it("予期しない例外は about:blank の 500 にして、内部の情報を出さない", async () => {
    logged.length = 0;
    const res = await app.request("/boom");
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(JSON.parse(text)).toEqual({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
    });
    expect(text).not.toContain("secret");
    expect(logged).toHaveLength(1);
  });

  it("HTTPException はそのステータスの about:blank にする", async () => {
    logged.length = 0;
    const res = await app.request("/teapot");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ type: "about:blank", title: "Bad Request", status: 400 });
    expect(logged).toHaveLength(0);
  });

  it("未定義の path は about:blank の 404 にする", async () => {
    const res = await app.request("/nothing");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await res.json()).toEqual({ type: "about:blank", title: "Not Found", status: 404 });
  });
});

describe("domain の _tag から route、hc まで", () => {
  type ApprovalError =
    | { readonly _tag: "ApprovalNotAllowed" }
    | { readonly _tag: "AlreadyApproved" };

  // 2. `domain` に _tag を足すと、`problemTypes` の引数、下の `switch`、route の宣言のどれかが型検査で落ちる。
  const types = problemTypes<"expense", ApprovalError["_tag"]>("expense", {
    ApprovalNotAllowed: true,
    AlreadyApproved: true,
  });

  function toProblemType(error: ApprovalError) {
    switch (error._tag) {
      case "ApprovalNotAllowed":
        return types.ApprovalNotAllowed;
      case "AlreadyApproved":
        return types.AlreadyApproved;
    }
  }

  const route = createRoute({
    method: "post",
    path: "/approve",
    responses: {
      ...commonProblemResponses,
      200: {
        description: "ok",
        content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
      },
      422: {
        description: "refused",
        content: {
          "application/problem+json": {
            schema: problemSchema([types.ApprovalNotAllowed, types.AlreadyApproved]),
          },
        },
      },
    },
  });

  const refused: ApprovalError = { _tag: "AlreadyApproved" };
  const app = new OpenAPIHono().openapi(route, (c) =>
    c.json(
      {
        type: toProblemType(refused),
        title: "The expense is already approved.",
        status: 422,
      },
      422,
    ),
  );

  it("res.status === 422 で body.type がリテラルの union に絞られ、_tag の type で返る", async () => {
    const client = hc<typeof app>("http://localhost", { fetch: app.request });

    const res = await client.approve.$post();

    expect(res.status).toBe(422);
    if (res.status !== 422) throw new Error("unreachable");
    const body = await res.json();
    expectTypeOf(body.type).toEqualTypeOf<
      "/problems/expense/approval-not-allowed" | "/problems/expense/already-approved"
    >();
    expect(body.type).toBe("/problems/expense/already-approved");
  });

  it("route が宣言した union に無い type を返すと型検査が落ちる", () => {
    const wrong = new OpenAPIHono().openapi(route, (c) =>
      // @ts-expect-error -- "/problems/expense/other" is not in the 422 union of the route
      c.json({ type: "/problems/expense/other" as const, title: "t", status: 422 }, 422),
    );
    expect(wrong).toBeDefined();
  });
});
