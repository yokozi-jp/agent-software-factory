import { describe, expect, it } from "vite-plus/test";

import { memoryLogger } from "../test/memory-logger.ts";
import { app, createApp } from "./app.ts";
import { unusedRuntime } from "./runtime.ts";

describe("ヘルスチェック (GET /health)", () => {
  it("ok を返すこと", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("セキュリティヘッダー (docs/web-api/security.md)", () => {
  it.each(["/health", "/not-found"])("規約が求めるヘッダーを付けること (%s)", async (path) => {
    const res = await app.request(path);

    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
  });

  it("規約が非推奨とするヘッダーを付けないこと", async () => {
    const res = await app.request("/health");

    expect(res.headers.has("X-XSS-Protection")).toBe(false);
    expect(res.headers.has("X-Frame-Options")).toBe(false);
  });
});

describe("CORS の設定 (docs/web-api/security.md)", () => {
  it("別のオリジンからのプリフライトを許可しないこと", async () => {
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

  it("別のオリジンからの単純なリクエストを許可しないこと", async () => {
    const res = await app.request("/health", { headers: { Origin: "https://evil.example" } });

    expect(res.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });
});

describe("エラー応答 (docs/adr/0035)", () => {
  async function expectBlankProblem(res: Response, status: number, title: string) {
    expect(res.status).toBe(status);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(JSON.parse(await res.text())).toEqual({ type: "about:blank", title, status });
  }

  it("未定義の path は about:blank の 404 の Problem Details にすること", async () => {
    const res = await app.request("/not-found");

    expect(res.status).toBe(404);
    await expectBlankProblem(res, 404, "Not Found");
  });

  it("予期しない例外は、メッセージを出さない about:blank の 500 にすること", async () => {
    const { logger, lines } = memoryLogger();
    const failing = createApp({ runtime: unusedRuntime(), logger });
    failing.get("/boom", () => {
      throw new Error("password=hunter2");
    });

    const res = await failing.request("/boom");

    expect(await res.clone().text()).not.toContain("hunter2");
    await expectBlankProblem(res, 500, "Internal Server Error");
    // 5xx は error の 1 行で、event.code を持つ (docs/adr/0049)。
    expect(lines().filter((line) => line["event.code"] === "API-001")).toHaveLength(1);
  });
});
