import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { inject } from "vite-plus/test";

import { authOptions, authPlugins, createAuth, type AuthConfig } from "../src/auth/auth.ts";
import { createApp } from "../src/app.ts";
import { runtimeWithoutDatabase } from "../src/runtime.ts";
import { TestBrowser } from "./browser.ts";
import { createTestDatabase, type TestDatabase } from "@agent-software-factory/db/testing";
import { clientId, clientSecret } from "./oidc-provider.ts";
import { startServerProcess, type ServerProcess } from "./server-process.ts";

export const appOrigin = "https://app.example.test";

export interface AuthFixture {
  readonly db: TestDatabase;
  readonly app: ReturnType<typeof createApp>;
  /**
   * 同じ DB と同じ設定で、別のプロセスに API をもう 1 つ起動する (ECS のタスクや Lambda の実行環境の 1 つ)。
   * 本番の入口 (src/server.ts) を使い、プロセスの中の状態をこのアプリと共有しない。`close()` が止める。
   */
  startInstance(): Promise<ServerProcess>;
  newBrowser(): TestBrowser;
  /**
   * 本物のログイン (テスト用 IdP) を通さずに、認証済みの browser を作る。
   * 業務のテストは、認証が目的ではないので、これを使う (docs/adr/0022)。
   * ログイン、Cookie、ログアウトを確かめるテストだけが `newBrowser().login()` を使う。
   * `roles` を渡すと、新しいテナントのメンバーとして、その役割 (経理は "accounting") を持たせる。
   */
  signedIn(user?: {
    email?: string;
    name?: string;
    roles?: readonly string[];
  }): Promise<TestBrowser>;
  close(): Promise<void>;
}

export interface AuthFixtureOptions {
  readonly session?: AuthConfig["session"];
  /**
   * Better Auth の rate limit を有効にする。既定は無効。ほかのテストは同じ IP (127.0.0.1) から
   * 何度もログインし、サインインの上限 (10 秒に 3 回) に当たるため。rate limit のテストだけが true にする。
   */
  readonly rateLimit?: boolean;
}

/** 本物の PostgreSQL とテスト用 IdP につないだ、認証つきのアプリを作る。 */
export async function createAuthFixture({
  session = {},
  rateLimit = false,
}: AuthFixtureOptions = {}): Promise<AuthFixture> {
  const db = await createTestDatabase();
  const config: AuthConfig = {
    database: db.authService,
    baseURL: appOrigin,
    secret: "test-secret-test-secret-test-secret-0123",
    oidc: {
      discoveryUrl: `${inject("oidcIssuer")}/.well-known/openid-configuration`,
      clientId,
      clientSecret,
    },
    session,
    rateLimit: { enabled: rateLimit },
  };
  const app = createApp({ runtime: runtimeWithoutDatabase(), auth: createAuth(config) });

  // 同じ設定、同じ DB、同じ secret に testUtils だけを足した認証。session の行と Cookie の署名が同じなので、
  // ここで作った session を、アプリはそのまま受け取る (Better Auth の testUtils は、テスト用の別の認証を勧める)。
  const testAuth = betterAuth({
    ...authOptions(config),
    plugins: [...authPlugins(config), testUtils()],
  });
  const { test } = await testAuth.$context;
  const instances: ServerProcess[] = [];

  return {
    db,
    app,
    async startInstance() {
      const instance = await startServerProcess({
        AUTH_DATABASE_URL: db.url("auth_service"),
        APP_DATABASE_URL: db.url("app_user"),
        PUBLIC_ORIGIN: config.baseURL,
        AUTH_SECRET: config.secret,
        OIDC_DISCOVERY_URL: config.oidc.discoveryUrl,
        OIDC_CLIENT_ID: config.oidc.clientId,
        OIDC_CLIENT_SECRET: config.oidc.clientSecret,
      });
      instances.push(instance);
      return instance;
    },
    newBrowser: () => new TestBrowser(app, appOrigin),
    async signedIn({ roles = [], ...user } = {}) {
      const saved = await test.saveUser(test.createUser(user));
      let session: Record<string, unknown> = {};
      if (roles.length > 0) {
        // 役割は member の行にあり、セッションの active organization で引く (ADR 0022)。
        const organization = await test.saveOrganization?.(test.createOrganization?.() ?? {});
        const organizationId = organization?.id;
        if (typeof organizationId !== "string") throw new Error("organization was not saved");
        await test.addMember?.({ userId: saved.id, organizationId, role: roles.join(",") });
        session = { activeOrganizationId: organizationId };
      }
      const headers = await test.getAuthHeaders({ userId: saved.id, session });
      const browser = new TestBrowser(app, appOrigin);
      browser.adoptCookieHeader(headers.get("cookie") ?? "");
      return browser;
    },
    async close() {
      // DB を消す前に、その DB につないだプロセスを止める。
      await Promise.all(instances.map((instance) => instance.stop()));
      await db.close();
    },
  };
}
