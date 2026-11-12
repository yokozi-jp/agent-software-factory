import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";

import {
  idempotencyFailureResponse,
  idempotencyInProgressResponse,
  idempotencyPayloadMismatchResponse,
  idempotencyRequestOf,
  parseIdempotencyKey,
  requireIdempotencyKey,
  type IdempotencyEnv,
} from "./idempotency-http.ts";
import {
  IdempotencyInProgress,
  IdempotencyPayloadMismatch,
} from "../idempotency-db/idempotency.ts";

const uuid = "9f1c1f6e-2f0e-4c3a-9c53-2a5c3e0d6b11";

describe("parseIdempotencyKey", () => {
  it("引用符付きの UUID を Valid にし、小文字にそろえること", () => {
    expect(parseIdempotencyKey(`"${uuid}"`)).toEqual({ _tag: "Valid", key: uuid });
    expect(parseIdempotencyKey(`"${uuid.toUpperCase()}"`)).toEqual({ _tag: "Valid", key: uuid });
  });

  it("nil UUID も UUID として受けること (RFC 9562)", () => {
    const nil = "00000000-0000-0000-0000-000000000000";

    expect(parseIdempotencyKey(`"${nil}"`)).toEqual({ _tag: "Valid", key: nil });
  });

  it("ヘッダーがなければ Missing にすること", () => {
    expect(parseIdempotencyKey(undefined)).toEqual({ _tag: "Missing" });
    expect(parseIdempotencyKey(null)).toEqual({ _tag: "Missing" });
  });

  it.each([
    ["引用符のない UUID", uuid],
    ["空の String", '""'],
    ["UUID でない String", '"abc"'],
    ["桁数が UUID でない値", '"9f1c1f6e-2f0e-0c3a-9c53-2a5c3e0d6b1"'],
    ["パラメーター付き", `"${uuid}";a=1`],
    ["エスケープを含む String", `"\\"${uuid}"`],
    ["Token", "abc"],
    ["前後に文字がある値", ` "${uuid}" x`],
  ])("%s は Malformed にすること", (_name, value) => {
    expect(parseIdempotencyKey(value)).toEqual({ _tag: "Malformed" });
  });
});

describe("requireIdempotencyKey", () => {
  const app = new Hono<IdempotencyEnv>();
  app.post("/x", requireIdempotencyKey, (c) => c.json({ key: c.var.idempotencyKey }));

  it("キーがなければ 400 の Problem Details (type は idempotency-key-missing) を返し、handler を呼ばないこと", async () => {
    const response = await app.request("/x", { method: "POST" });

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await response.json()).toMatchObject({
      type: "/problems/idempotency-key-missing",
      status: 400,
    });
  });

  it("形式が違えば 400 (type は idempotency-key-malformed) を返すこと", async () => {
    const response = await app.request("/x", {
      method: "POST",
      headers: { "Idempotency-Key": uuid },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ type: "/problems/idempotency-key-malformed" });
  });

  it("正しいキーなら handler に c.var.idempotencyKey として渡すこと", async () => {
    const response = await app.request("/x", {
      method: "POST",
      headers: { "Idempotency-Key": `"${uuid}"` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ key: uuid });
  });
});

describe("失敗の応答", () => {
  it("ペイロードの不一致は 400 の idempotency-payload-mismatch にすること", async () => {
    const app = new Hono();
    app.get("/", (c) => idempotencyPayloadMismatchResponse(c));

    const response = await app.request("/");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ type: "/problems/idempotency-payload-mismatch" });
  });

  it("処理中は 409 の idempotency-in-progress にし、Retry-After を付けること", async () => {
    const app = new Hono();
    app.get("/", (c) =>
      idempotencyInProgressResponse(c, new IdempotencyInProgress({ retryAfterSeconds: 5 })),
    );

    const response = await app.request("/");

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.json()).toMatchObject({ type: "/problems/idempotency-in-progress" });
  });
});

describe("idempotencyRequestOf", () => {
  it("method、path、クエリ文字列 (? なし)、本文をそのまま返し、本文をあとからも読めること", async () => {
    const app = new Hono();
    app.post("/items", async (c) => {
      const request = await idempotencyRequestOf(c);
      return c.json({ request, again: await c.req.text() });
    });

    const res = await app.request("/items?a=1&b=2", { method: "POST", body: '{"x":1}' });

    expect(await res.json()).toEqual({
      request: { method: "POST", path: "/items", query: "a=1&b=2", body: '{"x":1}' },
      again: '{"x":1}',
    });
  });

  it("クエリがなければ query は空文字であること", async () => {
    const app = new Hono();
    app.post("/items", async (c) => c.json(await idempotencyRequestOf(c)));

    const res = await app.request("/items", { method: "POST" });

    expect(await res.json()).toEqual({ method: "POST", path: "/items", query: "", body: "" });
  });
});

describe("idempotencyFailureResponse", () => {
  const app = new Hono();
  app.get("/mismatch", (c) => idempotencyFailureResponse(c, new IdempotencyPayloadMismatch()));
  app.get("/progress", (c) =>
    idempotencyFailureResponse(c, new IdempotencyInProgress({ retryAfterSeconds: 5 })),
  );

  it("不一致は 400、処理中は Retry-After 付きの 409 にすること", async () => {
    const mismatch = await app.request("/mismatch");
    const progress = await app.request("/progress");

    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toMatchObject({ type: "/problems/idempotency-payload-mismatch" });
    expect(progress.status).toBe(409);
    expect(progress.headers.get("Retry-After")).toBe("5");
  });
});
