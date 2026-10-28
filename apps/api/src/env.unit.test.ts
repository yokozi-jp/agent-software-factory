import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { envSchema, loadEnv } from "./env.ts";

const validEnv = {
  AUTH_DATABASE_URL: "postgres://auth_service:pw@localhost:5432/app", // betterleaks:allow
  PUBLIC_ORIGIN: "https://app.example.test",
  AUTH_SECRET: "a-secret-that-is-long-enough-for-tests", // betterleaks:allow
  OIDC_DISCOVERY_URL: "https://idp.example.test/.well-known/openid-configuration",
  OIDC_CLIENT_ID: "api",
  OIDC_CLIENT_SECRET: "client-secret", // betterleaks:allow
};

function messageOf(env: Record<string, string | undefined>): string {
  try {
    loadEnv(env);
  } catch (error) {
    return String(error);
  }
  return "";
}

describe("環境変数の読み込み (ADR 0032)", () => {
  it("そろっていれば、検査済みの設定を返すこと。PORT がなければ 3000 にすること", () => {
    expect(loadEnv(validEnv)).toEqual({ ...validEnv, PORT: 3000 });
  });

  it("PORT は数値にして返すこと", () => {
    expect(loadEnv({ ...validEnv, PORT: "8080" }).PORT).toBe(8080);
  });

  it.each(Object.keys(validEnv))("%s が欠けたら例外にすること (fail closed)", (name) => {
    expect(() => loadEnv({ ...validEnv, [name]: undefined })).toThrow(name);
  });

  it.each(Object.keys(validEnv))("%s が空文字なら例外にすること", (name) => {
    expect(() => loadEnv({ ...validEnv, [name]: "" })).toThrow(name);
  });

  it.each(["", "abc", "0", "70000", "1.5"])("PORT が %j なら例外にすること", (port) => {
    expect(() => loadEnv({ ...validEnv, PORT: port })).toThrow("PORT");
  });

  it("URL の形でない PUBLIC_ORIGIN は例外にすること", () => {
    expect(() => loadEnv({ ...validEnv, PUBLIC_ORIGIN: "not a url" })).toThrow("PUBLIC_ORIGIN");
  });

  it("エラーに値を含めないこと (秘密をログに出さない)", () => {
    const message = messageOf({ ...validEnv, PUBLIC_ORIGIN: "leaky-value" });
    expect(message).toContain("PUBLIC_ORIGIN");
    expect(message).not.toContain("leaky-value");
  });
});

describe(".env.example と schema", () => {
  it("schema の key と一致すること", () => {
    const text = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    const keys = text
      .split("\n")
      .filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line))
      .map((line) => line.slice(0, line.indexOf("=")));
    expect(keys.toSorted()).toEqual(Object.keys(envSchema.shape).toSorted());
  });
});
