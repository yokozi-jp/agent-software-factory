import { describe, expect, it } from "vite-plus/test";

import committed from "../openapi.json" with { type: "json" };
import { app, openApiDocument } from "./app.ts";

describe("OpenAPI の spec (docs/adr/0047)", () => {
  it("route から生成した spec が、commit した openapi.json と一致すること", () => {
    expect(app.getOpenAPI31Document(openApiDocument)).toEqual(committed);
  });

  // 検出力: route の変更を spec に反映し忘れた (古い spec が commit されている) 状態を渡すと、一致の検査が落ちること。
  it("古い spec (route を足す前の openapi.json) とは一致しないこと", () => {
    const stale = structuredClone(committed) as { paths: Record<string, unknown> };
    delete stale.paths["/health"];

    expect(app.getOpenAPI31Document(openApiDocument)).not.toEqual(stale);
  });

  it("OpenAPI 3.1 で、サーバー URL が相対パスであること", () => {
    const document = app.getOpenAPI31Document(openApiDocument);

    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([{ url: "/" }]);
  });
});

describe("GET /health の応答", () => {
  it("応答が route の応答スキーマに通ること", async () => {
    const res = await app.request("/health");
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });
});
