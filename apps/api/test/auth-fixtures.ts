import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { inject } from "vite-plus/test";

import { authOptions, authPlugins, createAuth, type AuthConfig } from "../src/auth/auth.ts";
import { createApp } from "../src/app.ts";
import { TestBrowser } from "./browser.ts";
import { createTestDatabase, type TestDatabase } from "./database.ts";

export const appOrigin = "https://app.example.test";

export interface AuthFixture {
  readonly db: TestDatabase;
  readonly app: ReturnType<typeof createApp>;
  newBrowser(): TestBrowser;
  /**
   * 本物のログイン (Keycloak) を通さずに、認証済みの browser を作る。
   * 業務のテストは、認証が目的ではないので、これを使う (docs/adr/0022)。
   * ログイン、Cookie、ログアウトを確かめるテストだけが `newBrowser().login()` を使う。
   */
  signedIn(user?: { email?: string; name?: string }): Promise<TestBrowser>;
  close(): Promise<void>;
}

/** 本物の PostgreSQL と Keycloak につないだ、認証つきのアプリを作る。 */
export async function createAuthFixture(session: AuthConfig["session"] = {}): Promise<AuthFixture> {
  const db = await createTestDatabase();
  const config: AuthConfig = {
    database: db.authService,
    baseURL: appOrigin,
    secret: "test-secret-test-secret-test-secret-0123",
    oidc: {
      discoveryUrl: `${inject("keycloakBaseUrl")}/realms/factory/.well-known/openid-configuration`,
      clientId: "api",
      clientSecret: "test-client-secret",
    },
    session,
  };
  const auth = createAuth(config);
  const app = createApp({ auth });

  // 同じ設定、同じ DB、同じ secret に testUtils だけを足した認証。session の行と Cookie の署名が同じなので、
  // ここで作った session を、アプリはそのまま受け取る (Better Auth の testUtils は、テスト用の別の認証を勧める)。
  const testAuth = betterAuth({
    ...authOptions(config),
    plugins: [...authPlugins(config), testUtils()],
  });
  const { test } = await testAuth.$context;

  return {
    db,
    app,
    newBrowser: () => new TestBrowser(app, appOrigin),
    async signedIn(user = {}) {
      const saved = await test.saveUser(test.createUser(user));
      const headers = await test.getAuthHeaders({ userId: saved.id });
      const browser = new TestBrowser(app, appOrigin);
      browser.adoptCookieHeader(headers.get("cookie") ?? "");
      return browser;
    },
    close: () => db.close(),
  };
}
