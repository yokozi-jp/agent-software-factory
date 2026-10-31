import { app } from "./app.ts";

// spec のサーバー URL は相対パス。web と API は同じオリジンで配信する (docs/adr/0022、0047)。
const openApiDocument = {
  openapi: "3.1.0" as const,
  info: { title: "agent-software-factory API", version: "0.0.0" },
  servers: [{ url: "/" }],
};

/** route から生成した spec。`apps/api/openapi.json` に commit する (tools/scripts/src/openapi/cli.ts が書く)。 */
export function generateOpenApi() {
  return app.getOpenAPI31Document(openApiDocument);
}
