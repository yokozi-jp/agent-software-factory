import { describe, expect, it } from "vite-plus/test";

import committed from "../openapi.json" with { type: "json" };
import { app } from "./app.ts";
import { generateOpenApi } from "./openapi.ts";

describe("OpenAPI の spec (docs/adr/0047)", () => {
  it("route から生成した spec が、commit した openapi.json と一致すること", () => {
    expect(generateOpenApi()).toEqual(committed);
  });

  // 検出力: route の変更を spec に反映し忘れた (古い spec が commit されている) 状態と比べると、一致しないこと。
  // 上のテストの比べ方 (toEqual) が、違いを見逃さない比べ方であることを示す。
  it("古い spec (route を足す前の openapi.json) とは一致しないこと", () => {
    const stale = structuredClone(committed) as { paths: Record<string, unknown> };
    delete stale.paths["/health"];

    expect(generateOpenApi()).not.toEqual(stale);
  });

  it("OpenAPI 3.1 で、サーバー URL が相対パスであること", () => {
    const document = generateOpenApi();

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
