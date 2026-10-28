import { betterAuth, type BetterAuthOptions } from "better-auth";
import { genericOAuth, organization } from "better-auth/plugins";
import type { Pool } from "pg";

// 認証は Better Auth の Cookie の BFF にする (docs/adr/0022)。
// ログインは OIDC の 1 経路だけで、IdP の違い (ローカルと CI は Keycloak、本番は Cognito か Entra ID) は
// issuer、client ID、secret の設定だけにする。メールとパスワードのログインは使わない。

/** 無操作で 30 分、最長で 8 時間 (OWASP Session Management Cheat Sheet、docs/adr/0022)。 */
const defaultSessionSeconds = { idle: 30 * 60, absolute: 8 * 60 * 60 } as const;

/**
 * IdP の ID。画面が `signIn.social({ provider })` に渡し、callback の path にも入る。
 * IdP が Keycloak でも Cognito でも変えない (差し替えを設定だけにするため)。
 */
export const oidcProviderId = "oidc";

export interface AuthConfig {
  /** Better Auth の表 (auth スキーマ) を使うデータベース。auth_service のロールで接続する。 */
  readonly database: Pool;
  /** ブラウザから見える、このアプリの公開のオリジン。 */
  readonly baseURL: string;
  readonly secret: string;
  readonly oidc: {
    readonly discoveryUrl: string;
    readonly clientId: string;
    readonly clientSecret: string;
  };
  readonly session?: { idleSeconds?: number; absoluteSeconds?: number };
  /**
   * Better Auth の rate limit。既定は有効にする。Better Auth の既定は NODE_ENV が production のときだけ
   * 有効で、NODE_ENV を設定し忘れた本番で、サインインの回数の制限が黙って外れるため (fail closed)。
   * 同じ IP から何度もログインするテストだけが false にする。
   */
  readonly rateLimit?: { enabled?: boolean };
  /**
   * 起動時に Better Auth の表がそろっているかを確かめる。既定は確かめる。
   * 表を作る前に認証を作るテストだけが false にする (ログに、まだ無い表の誤りが出るため)。
   */
  readonly validateSchema?: boolean;
}

// Cookie の名前に __Host- を付ける。Better Auth は useSecureCookies のとき __Secure- を付けるので、
// それを使わず、名前と Secure を自分で指定する (__Host- は Secure、Path=/、Domain なしが条件)。
//
// SameSite は Strict にする (RFC 10017 6.1.3.2)。ただし state は Lax にする。state は、IdP から戻る
// callback で、ログインを始めたブラウザかを確かめる Cookie である。IdP から戻る遷移は別のサイトから
// 始まるので、Strict だと送られず、ログインが "State mismatch" で失敗する。
const hostCookieSameSite = {
  session_token: "strict",
  session_data: "strict",
  account_data: "strict",
  dont_remember: "strict",
  state: "lax",
} as const;

function hostCookies(): NonNullable<NonNullable<BetterAuthOptions["advanced"]>["cookies"]> {
  return Object.fromEntries(
    Object.entries(hostCookieSameSite).map(([name, sameSite]) => [
      name,
      { name: `__Host-${name}`, attributes: { secure: true, sameSite, path: "/" } },
    ]),
  );
}

/** Better Auth の設定から plugins を除いたもの。テストが、同じ設定の認証に plugin を足すために切り出す。 */
export function authOptions(config: AuthConfig) {
  const idle = config.session?.idleSeconds ?? defaultSessionSeconds.idle;

  return {
    baseURL: config.baseURL,
    secret: config.secret,
    database: config.database,
    trustedOrigins: [new URL(config.baseURL).origin],
    session: { expiresIn: idle, updateAge: Math.min(60, idle) },
    // 保存先は DB にする。API は複数のインスタンスで動き、メモリだとインスタンスごとに別々に数えるため (#236)。
    // 窓と上限は Better Auth の既定 (全体は 10 秒に 100 回、/sign-in などは 10 秒に 3 回)。
    // 期限の切れた行は、Better Auth が、窓の切れた行を数え直すたびに、最も長い窓より古い行をまとめて消す。
    // 振る舞いは src/auth/rate-limit.test.ts が確かめる。表は packages/db/migrations の migration で作る。
    rateLimit: { enabled: config.rateLimit?.enabled ?? true, storage: "database" },
    advanced: {
      database: { validateSchema: config.validateSchema ?? true, generateId: "uuid" },
      useSecureCookies: false,
      cookies: hostCookies(),
      defaultCookieAttributes: { secure: true, sameSite: "strict", httpOnly: true, path: "/" },
    },
  } satisfies BetterAuthOptions;
}

export function authPlugins(
  config: AuthConfig,
): [ReturnType<typeof genericOAuth>, ReturnType<typeof organization>] {
  return [
    genericOAuth({
      config: [
        {
          providerId: oidcProviderId,
          discoveryUrl: config.oidc.discoveryUrl,
          clientId: config.oidc.clientId,
          clientSecret: config.oidc.clientSecret,
          scopes: ["openid", "email", "profile"],
          pkce: true,
        },
      ],
    }),
    // テナント (organization) は、人事システムの確認で作る。利用者が自分で作れてはいけない。
    organization({ allowUserToCreateOrganization: false }),
  ];
}

function buildBetterAuth(config: AuthConfig) {
  return betterAuth({ ...authOptions(config), plugins: authPlugins(config) });
}

export function createAuth(config: AuthConfig): Auth {
  return {
    betterAuth: buildBetterAuth(config),
    origin: new URL(config.baseURL).origin,
    absoluteSessionSeconds: config.session?.absoluteSeconds ?? defaultSessionSeconds.absolute,
  };
}

/** Better Auth と、アプリが認証のために知っておく設定。 */
export interface Auth {
  readonly betterAuth: ReturnType<typeof buildBetterAuth>;
  /** このアプリの公開のオリジン。CSRF の検査が、Origin ヘッダーと比べる。 */
  readonly origin: string;
  /** セッションが使われ続けても、この秒数を超えたら切る。 */
  readonly absoluteSessionSeconds: number;
}
