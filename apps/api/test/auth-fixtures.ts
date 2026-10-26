import { inject } from "vite-plus/test";

import { createAuth, migrateAuth } from "../src/auth/auth.ts";
import { createApp } from "../src/app.ts";
import { TestBrowser } from "./browser.ts";
import { createTestDatabase, type TestDatabase } from "./database.ts";

export const appOrigin = "https://app.example.test";

export interface AuthFixture {
  readonly db: TestDatabase;
  readonly app: ReturnType<typeof createApp>;
  newBrowser(): TestBrowser;
  close(): Promise<void>;
}

/** 本物の PostgreSQL と Keycloak につないだ、認証つきのアプリを作る。 */
export async function createAuthFixture(
  session: { idleSeconds?: number; absoluteSeconds?: number } = {},
): Promise<AuthFixture> {
  const db = await createTestDatabase();
  const auth = createAuth({
    database: db.authService,
    baseURL: appOrigin,
    secret: "test-secret-test-secret-test-secret-0123",
    oidc: {
      discoveryUrl: `${inject("keycloakBaseUrl")}/realms/factory/.well-known/openid-configuration`,
      clientId: "api",
      clientSecret: "test-client-secret",
    },
    session,
    validateSchema: false,
  });
  await migrateAuth(auth);
  const app = createApp({ auth });

  return {
    db,
    app,
    newBrowser: () => new TestBrowser(app, appOrigin),
    close: () => db.close(),
  };
}
