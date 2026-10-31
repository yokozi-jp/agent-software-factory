import {
  problemErrorHandler,
  problemResponse,
} from "@agent-software-factory/shared-kernel/problem";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { contextStorage } from "hono/context-storage";
import { describe, expect, it } from "vite-plus/test";

import { createApp } from "../app.ts";
import { runtimeWithoutDatabase } from "../runtime.ts";
import type { Auth } from "../auth/auth.ts";
import { memoryLogger } from "../../test/memory-logger.ts";
import { validationHook } from "./validation-hook.ts";
import {
  accessLog,
  logUnexpectedError,
  requestContext,
  requestLogContext,
  type ApiVariables,
} from "./logging.ts";

/** 文脈の middleware だけを付けた app。 */
function contextApp({ validation = false } = {}) {
  const app = new OpenAPIHono<{ Variables: ApiVariables }>(
    validation ? { defaultHook: validationHook } : {},
  );
  app.use(contextStorage());
  app.use(requestContext());
  return app;
}

// Better Auth の代わり。getSession が返す値で、ログインの有無と失敗を作る。
function fakeAuth(getSession: () => Promise<unknown>): Auth {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double with only the members the API reads
  return {
    origin: "https://app.example.com",
    absoluteSessionSeconds: 3600,
    betterAuth: {
      api: { getSession },
      handler: () => new Response(null, { status: 204 }),
    },
  } as unknown as Auth;
}
const signedOut = () => Promise.resolve({ headers: new Headers(), response: null });
const signedIn = () =>
  Promise.resolve({
    headers: new Headers(),
    response: {
      user: { id: "0198f7aa-0000-7000-8000-000000000001", email: "a@example.com", name: "A" },
      session: { createdAt: new Date() },
    },
  });

describe("アクセスログ (docs/logging/web-api.md)", () => {
  it("要求時と応答時の両方を info で出し、同じ http.request.id を付ける", async () => {
    const { logger, lines } = memoryLogger();
    const res = await createApp({ runtime: runtimeWithoutDatabase(), logger }).request(
      "/not-found",
      {
        headers: { "user-agent": "vitest/1" },
      },
    );

    expect(res.status).toBe(404);
    const [received, completed, ...rest] = lines();
    expect(rest).toEqual([]);
    expect(received).toMatchObject({
      "severity.text": "INFO",
      message: "request received",
      "http.request.method": "GET",
      "url.path": "/not-found",
      "user_agent.original": "vitest/1",
      "service.name": "api",
    });
    expect(completed).toMatchObject({
      "severity.text": "INFO",
      message: "request completed",
      "http.response.status_code": 404,
      "http.request.method": "GET",
      "url.path": "/not-found",
    });
    expect(completed?.["http.server.request.duration"]).toEqual(expect.any(Number));
    expect(received?.["http.request.id"]).toEqual(expect.any(String));
    expect(completed?.["http.request.id"]).toBe(received?.["http.request.id"]);
  });

  it("/health は出さない", async () => {
    const { logger, lines } = memoryLogger();
    const res = await createApp({ runtime: runtimeWithoutDatabase(), logger }).request("/health");
    expect(res.status).toBe(200);
    expect(lines()).toEqual([]);
  });

  it("OPTIONS は出す", async () => {
    const { logger, lines } = memoryLogger();
    await createApp({ runtime: runtimeWithoutDatabase(), logger }).request("/health2", {
      method: "OPTIONS",
    });
    expect(lines().map((line) => line["http.request.method"])).toEqual(["OPTIONS", "OPTIONS"]);
  });

  it("クエリ文字列と client.address は出さない", async () => {
    const { logger, lines } = memoryLogger();
    await createApp({ runtime: runtimeWithoutDatabase(), logger }).request("/a?code=secret-code", {
      headers: { "x-forwarded-for": "192.0.2.1" },
    });
    const text = JSON.stringify(lines());
    expect(text).not.toContain("secret-code");
    expect(text).not.toContain("192.0.2.1");
    expect(text).not.toContain("client.address");
  });

  it("user_agent がなければキーを付けない", async () => {
    const { logger, lines } = memoryLogger();
    await createApp({ runtime: runtimeWithoutDatabase(), logger }).request("/a");
    expect(lines()[0]).not.toHaveProperty("user_agent.original");
  });
});

describe("リクエストの ID", () => {
  it("形が合う X-Request-Id はそのまま使う", async () => {
    const { logger, lines } = memoryLogger();
    await createApp({ runtime: runtimeWithoutDatabase(), logger }).request("/a", {
      headers: { "x-request-id": "req-abc_1.2" },
    });
    for (const line of lines()) expect(line["http.request.id"]).toBe("req-abc_1.2");
  });

  it("形が合わない X-Request-Id は使わず、採番する (ログの汚染を避ける)", async () => {
    const { logger, lines } = memoryLogger();
    await createApp({ runtime: runtimeWithoutDatabase(), logger }).request("/a", {
      headers: { "x-request-id": "bad id with spaces" },
    });
    expect(lines()[0]?.["http.request.id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("401、403、400 の記録 (docs/logging/web-api.md)", () => {
  it("401 は理由つきで info に残し、event.category は authentication", async () => {
    const { logger, lines } = memoryLogger();
    const res = await createApp({
      runtime: runtimeWithoutDatabase(),
      logger,
      auth: fakeAuth(signedOut),
    }).request("/api/me");

    expect(res.status).toBe(401);
    const rejected = lines().find((line) => line["message"] === "request rejected");
    expect(rejected).toMatchObject({
      "severity.text": "INFO",
      "error.type": "/problems/unauthenticated",
      "event.kind": "event",
      "event.category": "authentication",
      "event.outcome": "failure",
      "http.response.status_code": 401,
      "url.path": "/api/me",
    });
    expect(rejected).not.toHaveProperty("event.code");
  });

  it("403 (CSRF の Origin) は event.category が iam", async () => {
    const { logger, lines } = memoryLogger();
    const res = await createApp({
      runtime: runtimeWithoutDatabase(),
      logger,
      auth: fakeAuth(signedOut),
    }).request("/api/anything", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(403);
    expect(lines().find((line) => line["message"] === "request rejected")).toMatchObject({
      "error.type": "/problems/forbidden-origin",
      "event.category": "iam",
      "http.response.status_code": 403,
    });
  });

  describe("400 の検証の失敗", () => {
    const route = createRoute({
      method: "post",
      path: "/echo",
      request: {
        body: { content: { "application/json": { schema: z.object({ n: z.number() }) } } },
      },
      responses: { 200: { description: "ok" } },
    });
    function appWith(logger: ReturnType<typeof memoryLogger>["logger"]) {
      const app = contextApp({ validation: true });
      app.use(accessLog(logger));
      app.openapi(route, (c) => c.json({}, 200));
      app.get("/other-400", (c) =>
        problemResponse(c, { type: "/problems/x/y", title: "t", status: 400 }),
      );
      app.get("/conflict", (c) =>
        problemResponse(c, { type: "/problems/x/y", title: "t", status: 409 }),
      );
      return app;
    }

    it("検証の失敗は理由つきで info に残す", async () => {
      const { logger, lines } = memoryLogger();
      const res = await appWith(logger).request("/echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n: "not a number" }),
      });

      expect(res.status).toBe(400);
      expect(lines().find((line) => line["message"] === "request rejected")).toMatchObject({
        "error.type": "/problems/validation",
        "event.category": "web",
        "http.response.status_code": 400,
      });
      // 入力した値はログに出ない。
      expect(JSON.stringify(lines())).not.toContain("not a number");
    });

    it("検証以外の 400 と、その他の 4xx は出さない (rejected の行がない)", async () => {
      const { logger, lines } = memoryLogger();
      const app = appWith(logger);
      await app.request("/other-400");
      await app.request("/conflict");
      await app.request("/unknown");
      expect(lines().filter((line) => line["message"] === "request rejected")).toEqual([]);
      expect(lines().filter((line) => line["message"] === "request completed")).toHaveLength(3);
    });
  });

  it.each(["not json", "null", "[]", '{"status":401}', '{"type":1}'])(
    "問題の本文が %s で、理由を読めない 401 は、理由なしで rejected に残すこと",
    async (body) => {
      const { logger, lines } = memoryLogger();
      const app = new OpenAPIHono<{ Variables: ApiVariables }>();
      app.use(accessLog(logger));
      app.get(
        "/broken",
        () =>
          new Response(body, {
            status: 401,
            headers: { "content-type": "application/problem+json" },
          }),
      );
      await app.request("/broken");
      const rejected = lines().find((line) => line["message"] === "request rejected");
      expect(rejected).toMatchObject({ "event.category": "authentication" });
      expect(rejected).not.toHaveProperty("error.type");
    },
  );

  it("User-Agent は 512 文字で切る", async () => {
    const { logger, lines } = memoryLogger();
    await createApp({ runtime: runtimeWithoutDatabase(), logger }).request("/a", {
      headers: { "user-agent": "x".repeat(2000) },
    });
    expect(String(lines()[0]?.["user_agent.original"])).toHaveLength(512);
  });
});

describe("user.id と tenant_id", () => {
  it("ログイン済みなら、応答時の行に user.id が付く", async () => {
    const { logger, lines } = memoryLogger();
    const res = await createApp({
      runtime: runtimeWithoutDatabase(),
      logger,
      auth: fakeAuth(signedIn),
    }).request("/api/me", {
      headers: { origin: "https://app.example.com" },
    });
    expect(res.status).toBe(200);
    expect(lines().at(-1)).toMatchObject({
      message: "request completed",
      "user.id": "0198f7aa-0000-7000-8000-000000000001",
    });
  });

  it("未ログインなら user.id を付けない", async () => {
    const { logger, lines } = memoryLogger();
    await createApp({
      runtime: runtimeWithoutDatabase(),
      logger,
      auth: fakeAuth(signedOut),
    }).request("/api/me");
    for (const line of lines()) expect(line).not.toHaveProperty("user.id");
  });

  it("tenant_id を c.set した middleware の後ろの行に付く", async () => {
    const { logger, lines } = memoryLogger();
    const app = contextApp();
    app.use(async (c, next) => {
      c.set("tenantId", "0198f7aa-0000-7000-8000-0000000000aa");
      await next();
    });
    app.use(accessLog(logger));
    app.get("/x", (c) => c.text("ok"));
    await app.request("/x");
    for (const line of lines())
      expect(line["tenant_id"]).toBe("0198f7aa-0000-7000-8000-0000000000aa");
  });

  it("リクエストの外では文脈がない", () => {
    expect(requestLogContext()).toBeUndefined();
  });
});

describe("5xx の記録 (app.onError)", () => {
  it("error で 1 行書き、例外の型とメッセージ、event.* と event.code を付ける。応答には出さない", async () => {
    const { logger, lines } = memoryLogger();
    const app = contextApp();
    app.onError(problemErrorHandler(logUnexpectedError(logger)));
    app.get("/boom", () => {
      throw Object.assign(new Error("connection refused"), {
        name: "DatabaseError",
        detail: "Key (email)=(a@example.com) already exists.",
        where: "COPY users",
        parameters: ["a@example.com"],
      });
    });

    const res = await app.request("/boom?token=q-secret");

    expect(res.status).toBe(500);
    const [line, ...rest] = lines();
    expect(rest).toEqual([]);
    expect(line).toMatchObject({
      "severity.text": "ERROR",
      "event.code": "API-001",
      "event.kind": "event",
      "event.category": "web",
      "event.outcome": "failure",
      "exception.type": "DatabaseError",
      "exception.message": "connection refused",
      "url.path": "/boom",
      "http.request.method": "GET",
    });
    expect(line?.["exception.stacktrace"]).toEqual(expect.stringContaining("connection refused"));
    // pg のエラーの値と、クエリ文字列は出ない。
    expect(JSON.stringify(line)).not.toContain("a@example.com");
    expect(JSON.stringify(line)).not.toContain("q-secret");
    expect(await res.text()).not.toContain("connection refused");
  });

  it("createApp では、route より前の middleware の例外も 1 か所で書く", async () => {
    const { logger, lines } = memoryLogger();
    const failing = fakeAuth(() => Promise.reject(new Error("db down")));
    const res = await createApp({
      runtime: runtimeWithoutDatabase(),
      logger,
      auth: failing,
    }).request("/api/me");

    expect(res.status).toBe(500);
    expect(lines().filter((line) => line["event.code"] === "API-001")).toHaveLength(1);
    // 5xx は error の 1 行で、rejected の info は出さない。
    expect(lines().some((line) => line["message"] === "request rejected")).toBe(false);
  });

  it("4xx の HTTPException は error で書かない", async () => {
    const { logger, lines } = memoryLogger();
    const res = await createApp({ runtime: runtimeWithoutDatabase(), logger }).request("/nothing");
    expect(res.status).toBe(404);
    expect(lines().some((line) => line["severity.text"] === "ERROR")).toBe(false);
  });
});
