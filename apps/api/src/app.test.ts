import { describe, expect, it } from "vite-plus/test";

import { app } from "./app.ts";

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
