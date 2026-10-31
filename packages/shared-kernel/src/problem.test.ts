import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { trace } from "@opentelemetry/api";
import { hc } from "hono/client";
import { describe, expect, expectTypeOf, it, vi } from "vite-plus/test";

import {
  commonProblemResponses,
  problemErrorHandler,
  problemNotFoundHandler,
  problemResponse,
  problemSchema,
  problemTypes,
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
  const schema = problemSchema(["/problems/a", "/problems/b"]);

  it("type をリテラルの union にする", () => {
    expectTypeOf<z.infer<typeof schema>["type"]>().toEqualTypeOf<"/problems/a" | "/problems/b">();
  });

  it("並べていない type を拒む", () => {
    expect(schema.safeParse({ type: "/problems/c", title: "x", status: 422 }).success).toBe(false);
    expect(schema.safeParse({ type: "/problems/a", title: "x", status: 422 }).success).toBe(true);
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
      (c) => c.json({ type: "/problems/a" as const, title: "t", status: 422 }, 422),
    );
    const doc = app.getOpenAPI31Document({ openapi: "3.1.0", info: { title: "t", version: "0" } });
    const type = JSON.stringify(doc.paths?.["/x"]?.get?.responses?.["422"]);
    expect(type).toContain('"x-extensible-enum":["/problems/a","/problems/b"]');
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
    problemResponse(c, { type: "/problems/a", title: "A.", status: 422, detail: "d" }),
  );
  app.get("/blank", (c) =>
    problemResponse(c, { type: "about:blank", title: "Not Found", status: 404 }),
  );

  it("application/problem+json で、指定のステータスを返す", async () => {
    const res = await app.request("/p");
    expect(res.status).toBe(422);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await res.json()).toEqual({
      type: "/problems/a",
      title: "A.",
      status: 422,
      detail: "d",
    });
  });

  it("今の span がなければ trace_id を付けない", async () => {
    const body = await (await app.request("/blank")).json();
    expect(body).not.toHaveProperty("trace_id");
  });

  it("今の span があれば trace_id を付ける", async () => {
    const spanContext = {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: 1,
    };
    // No context manager is registered in a unit test, so the active span is stubbed.
    const spy = vi
      .spyOn(trace, "getActiveSpan")
      .mockReturnValue(trace.wrapSpanContext(spanContext));
    const body = await (await app.request("/blank")).json();
    spy.mockRestore();
    expect(body).toMatchObject({ trace_id: "4bf92f3577b34da6a3ce929d0e0e4736" });
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

describe("hc の型", () => {
  const types = problemTypes("expense", { ApprovalNotAllowed: true, AlreadyApproved: true });
  const route = createRoute({
    method: "post",
    path: "/approve",
    responses: {
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
  const app = new OpenAPIHono().openapi(route, (c) => c.json({ ok: true as const }, 200));

  it("res.status === 422 で body.type がリテラルの union に絞られる", async () => {
    const client = hc<typeof app>("http://localhost", {
      fetch: app.request,
    });
    const res = await client.approve.$post();
    if (res.status === 422) {
      const body = await res.json();
      expectTypeOf(body.type).toEqualTypeOf<
        "/problems/expense/approval-not-allowed" | "/problems/expense/already-approved"
      >();
    }
    expect(true).toBe(true);
  });
});
