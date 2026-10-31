import { app } from "./app.ts";

// spec のサーバー URL は相対パス。web と API は同じオリジンで配信する (docs/adr/0022、0047)。
const openApiDocument = {
  openapi: "3.1.0" as const,
  info: {
    title: "agent-software-factory API",
    version: "0.0.0",
    description:
      "The HTTP API of agent-software-factory, served on the same origin as the web app.",
    contact: {
      name: "agent-software-factory",
      url: "https://github.com/yokozi-jp/agent-software-factory",
    },
  },
  servers: [{ url: "/" }],
  // 名前の昇順 (Spectral の openapi-tags-alphabetical)。route に tag を足したら、ここにも説明つきで足す。
  tags: [
    { name: "auth", description: "The signed-in user and the session." },
    { name: "health", description: "Whether the API process is running." },
  ],
};

/** route から生成した spec。`apps/api/openapi.json` に commit する (tools/scripts/src/openapi/cli.ts が書く)。 */
export function generateOpenApi() {
  return app.getOpenAPI31Document(openApiDocument);
}
