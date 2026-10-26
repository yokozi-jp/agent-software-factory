import { Pool } from "pg";
import { describe, expect, it } from "vite-plus/test";

import { authOptions, type AuthConfig } from "./auth.ts";

// 設定を組み立てるだけで、DB にはつながない (Pool は、最初の query までつながない)。
const config: AuthConfig = {
  database: new Pool(),
  baseURL: "https://app.example.test",
  secret: "unused-in-this-test",
  oidc: { discoveryUrl: "https://idp.example.test", clientId: "api", clientSecret: "unused" },
};

describe("認証の設定 (ADR 0022)", () => {
  it("指定しなければ、起動時に Better Auth の表がそろっているかを確かめること", () => {
    expect(authOptions(config).advanced.database.validateSchema).toBe(true);
  });

  it("validateSchema: false のときは確かめないこと", () => {
    expect(authOptions({ ...config, validateSchema: false }).advanced.database.validateSchema).toBe(
      false,
    );
  });
});
