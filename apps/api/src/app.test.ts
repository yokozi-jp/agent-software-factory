import { describe, expect, it } from "vite-plus/test";

import { app } from "./app.ts";

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("security headers (docs/web-api/security.md)", () => {
  it.each(["/health", "/not-found"])("sets the required headers on %s", async (path) => {
    const res = await app.request(path);

    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
  });

  it("omits headers the convention deprecates", async () => {
    const res = await app.request("/health");

    expect(res.headers.has("X-XSS-Protection")).toBe(false);
    expect(res.headers.has("X-Frame-Options")).toBe(false);
  });
});

describe("CORS", () => {
  it("does not allow a cross-origin preflight", async () => {
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "GET",
      },
    });

    expect(res.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(res.headers.has("Access-Control-Allow-Methods")).toBe(false);
  });

  it("does not allow a cross-origin simple request", async () => {
    const res = await app.request("/health", { headers: { Origin: "https://evil.example" } });

    expect(res.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });
});
