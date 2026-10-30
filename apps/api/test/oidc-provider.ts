import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import Provider, { type Configuration } from "oidc-provider";

import { users } from "./credentials.ts";

// 結合テストの IdP。テストのプロセスの中で node-oidc-provider を動かす (Docker が要らず、起動が 1 秒未満。docs/adr/0022、Issue #427)。
// 実在の IdP が持つ動きのうち、アプリが頼るもの (認可コード + PKCE のログイン、RP-Initiated Logout) だけを持つ。

export const clientId = "api";
export const clientSecret = "test-client-secret"; // betterleaks:allow
const appOrigin = "https://app.example.test";

/** Keycloak の realm と同じ 2 人。sub は固定の UUID。 */
const accounts = {
  yamada: { sub: "6f0c1d3e-0000-4000-8000-000000000001", name: "Taro Yamada", ...users.yamada },
  sato: { sub: "6f0c1d3e-0000-4000-8000-000000000002", name: "Hanako Sato", ...users.sato },
} as const;

const accountBySub = new Map<string, (typeof accounts)[keyof typeof accounts]>(
  Object.values(accounts).map((account) => [account.sub, account]),
);

export interface TestIdp {
  /** `${issuer}/.well-known/openid-configuration` が discovery の URL になる。 */
  readonly issuer: string;
  stop(): Promise<void>;
}

export async function startTestIdp(): Promise<TestIdp> {
  // issuer にポートが要るので、先に待ち受けて、provider ができてから要求を渡す。
  let handler = (_req: IncomingMessage, res: ServerResponse): void => {
    res.statusCode = 503;
    res.end();
  };
  const server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("IdP のポートが分からない");
  const issuer = `http://127.0.0.1:${address.port}`;

  const configuration: Configuration = {
    clients: [
      {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uris: [`${appOrigin}/api/auth/callback/oidc`],
        post_logout_redirect_uris: [`${appOrigin}/`],
        token_endpoint_auth_method: "client_secret_post",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      },
    ],
    cookies: { keys: ["test-cookie-key-0123456789"] },
    scopes: ["openid", "email", "profile"],
    claims: { openid: ["sub"], email: ["email", "email_verified"], profile: ["name"] },
    pkce: { required: () => true },
    features: {
      devInteractions: { enabled: false },
      rpInitiatedLogout: {
        enabled: true,
      },
    },
    // 既定のエラー画面は理由を出さない。テストが失敗したときに読めるよう、文字だけで返す。
    renderError(ctx, out, error) {
      ctx.type = "text/plain";
      ctx.body = `${error.name}: ${error.message} ${JSON.stringify(out)}`;
    },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    findAccount: (_ctx, sub) => {
      const account = accountBySub.get(sub);
      if (account === undefined) return Promise.resolve(undefined);
      return Promise.resolve({
        accountId: sub,
        claims: () =>
          Promise.resolve({
            sub,
            email: account.email,
            email_verified: true,
            name: account.name,
          }),
      });
    },
  };
  const provider = new Provider(issuer, configuration);
  const oidc = provider.callback();

  handler = (req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    const respond = (work: Promise<void> | undefined) => {
      work?.catch((error: unknown) => {
        // 例外の文字を応答に載せない (HTML として解釈されうる)。理由は、テストの出力に出す。
        console.error("テスト用 IdP の処理が失敗した", error);
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain");
        res.end("internal error");
      });
    };
    if (
      url.pathname === "/session/end" &&
      req.method === "GET" &&
      req.headers["x-internal"] === undefined
    ) {
      respond(endSession(issuer, url, req, res));
    } else if (/^\/interaction\/[^/]+$/.test(url.pathname)) {
      respond(interact(provider, issuer, req, res));
    } else {
      respond(oidc(req, res));
    }
  };

  return {
    issuer,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server.closeAllConnections();
      }),
  };
}

async function interact(
  provider: Provider,
  issuer: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const details = await provider.interactionDetails(req, res);

  if (details.prompt.name === "consent") {
    // 同意の画面は出さない。要求された範囲をそのまま認める。
    const grant = new provider.Grant({ accountId: details.session?.accountId, clientId });
    grant.addOIDCScope("openid email profile");
    const grantId = await grant.save();
    return provider.interactionFinished(req, res, { consent: { grantId } });
  }

  if (req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    const account = Object.values(accounts).find(
      (candidate) =>
        candidate.username === form.get("username") && candidate.password === form.get("password"),
    );
    if (account === undefined) {
      res.statusCode = 401;
      res.end("invalid credentials");
      return;
    }
    return provider.interactionFinished(req, res, { login: { accountId: account.sub } });
  }

  res.setHeader("content-type", "text/html");
  res.end(
    `<form id="op-login-form" method="post" action="${issuer}/interaction/${details.uid}">` +
      `<input name="username"><input name="password" type="password"></form>`,
  );
}

async function readBody(req: IncomingMessage): Promise<string> {
  req.setEncoding("utf8");
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return body;
}

/**
 * ブラウザは JS を動かさないので、確認の画面を出さずに、確認の POST を IdP の中で送って終わらせる。
 * id_token_hint 付きの Keycloak が確認を省くのと同じ挙動にする。
 */
async function endSession(
  issuer: string,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const cookies = new Map<string, string>();
  const remember = (header: string | null | undefined) => {
    for (const pair of (header ?? "").split(";")) {
      const separator = pair.indexOf("=");
      if (separator > 0)
        cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  };
  remember(req.headers.cookie);

  // 宛先は issuer と固定の path にする。要求から取るのは query だけ。
  const target = new URL("/session/end", issuer);
  target.search = url.search;
  const page = await fetch(target, {
    headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "), "x-internal": "1" },
    redirect: "manual",
  });
  for (const line of page.headers.getSetCookie()) remember(line.split(";")[0]);
  const xsrf = /name="xsrf" value="([^"]+)"/.exec(await page.text())?.[1];
  if (xsrf === undefined) {
    res.statusCode = page.status;
    res.end();
    return;
  }

  const confirmed = await fetch(`${issuer}/session/end/confirm`, {
    method: "POST",
    headers: {
      cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ xsrf, logout: "yes" }).toString(),
    redirect: "manual",
  });
  res.statusCode = confirmed.status;
  res.setHeader("set-cookie", confirmed.headers.getSetCookie());
  const location = confirmed.headers.get("location");
  if (location !== null) res.setHeader("location", location);
  res.end();
}
