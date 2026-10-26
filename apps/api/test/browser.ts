import { oidcProviderId } from "../src/auth/auth.ts";

/** Hono アプリと外の HTTP サーバー (Keycloak) をまたいで、ブラウザのように Cookie を持ち回す。 */
interface RequestableApp {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

interface StoredCookie {
  readonly value: string;
  readonly sameSite: "strict" | "lax" | "none";
  /** 期限 (ms)。Date.now() と比べる。テストが Date を進めると、Cookie も期限切れになる。 */
  readonly expiresAt: number | undefined;
}

interface RequestOptions {
  /**
   * 別のサイト (IdP) から始まった遷移として扱う。ブラウザと同じく、SameSite=Strict の Cookie を送らない。
   * リダイレクトの途中の要求も、遷移の出発点が別のサイトなので、同じく扱う。
   */
  readonly crossSite?: boolean;
}

export class TestBrowser {
  private readonly cookies = new Map<string, Map<string, StoredCookie>>();
  /** アプリが返した Set-Cookie の行を、返された順にすべて残す。 */
  readonly appSetCookies: string[] = [];

  private readonly app: RequestableApp;
  private readonly appOrigin: string;

  constructor(app: RequestableApp, appOrigin: string) {
    this.app = app;
    this.appOrigin = appOrigin;
  }

  /**
   * Cookie ヘッダーの値 (`a=b; c=d`) を、アプリの host の Cookie として持つ。
   * 本物のログインを通さずに、認証済みの browser を作るときに使う (test/auth-fixtures.ts の signedIn)。
   */
  adoptCookieHeader(cookieHeader: string): void {
    const jar = this.cookies.get(new URL(this.appOrigin).host) ?? new Map<string, StoredCookie>();
    for (const pair of cookieHeader.split(";")) {
      const separator = pair.indexOf("=");
      jar.set(pair.slice(0, separator).trim(), {
        value: pair.slice(separator + 1).trim(),
        sameSite: "strict",
        expiresAt: undefined,
      });
    }
    this.cookies.set(new URL(this.appOrigin).host, jar);
  }

  /** リダイレクトを辿らずに 1 回だけ要求する。Cookie は host ごとに保存、送信する。 */
  async request(
    url: string,
    init: RequestInit = {},
    options: RequestOptions = {},
  ): Promise<Response> {
    const target = new URL(url, this.appOrigin);
    const headers = new Headers(init.headers);
    const cookieHeader = this.cookieHeader(target.host, options.crossSite === true);
    if (cookieHeader !== "") headers.set("cookie", cookieHeader);

    const isApp = target.origin === this.appOrigin;
    const response = isApp
      ? await this.app.request(target.toString(), { ...init, headers })
      : await fetch(target, { ...init, headers, redirect: "manual" });

    if (isApp) this.appSetCookies.push(...response.headers.getSetCookie());
    this.store(target.host, response);
    return response;
  }

  /** リダイレクトを辿り、最後の応答を返す。 */
  async follow(
    url: string,
    init: RequestInit = {},
    options: RequestOptions = {},
  ): Promise<Response> {
    let response = await this.request(url, init, options);
    let current = new URL(url, this.appOrigin);
    for (let hops = 0; hops < 10; hops += 1) {
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || location === null) return response;
      current = new URL(location, current);
      response = await this.request(current.toString(), {}, options);
    }
    throw new Error("too many redirects");
  }

  /** Keycloak のログイン画面を通ってログインする。成功するとアプリのセッション Cookie を持つ。 */
  async login({ username, password }: { username: string; password: string }): Promise<Response> {
    const start = await this.request("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: this.appOrigin },
      body: JSON.stringify({ provider: oidcProviderId, callbackURL: "/" }),
    });
    const url = await readUrl(start);

    const loginPage = await this.request(url);
    const html = await loginPage.text();
    const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1];
    if (action === undefined) throw new Error("Keycloak のログイン画面にフォームがない");

    const submitted = await this.request(action.replaceAll("&amp;", "&"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password }).toString(),
    });
    const callback = submitted.headers.get("location");
    if (callback === null) throw new Error("Keycloak がログインを拒否した");

    // IdP から戻る遷移は、別のサイトから始まる。
    return this.follow(callback, {}, { crossSite: true });
  }

  private cookieHeader(host: string, crossSite: boolean): string {
    const now = Date.now();
    const sendable: string[] = [];
    for (const [name, cookie] of this.cookies.get(host) ?? []) {
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= now) continue;
      if (crossSite && cookie.sameSite === "strict") continue;
      sendable.push(`${name}=${cookie.value}`);
    }
    return sendable.join("; ");
  }

  private store(host: string, response: Response): void {
    const jar = this.cookies.get(host) ?? new Map<string, StoredCookie>();
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const attribute = (key: string) =>
        attributes
          .find((candidate) => candidate.toLowerCase().startsWith(`${key}=`))
          ?.slice(key.length + 1);

      const maxAge = attribute("max-age");
      const expires = attribute("expires");
      let expiresAt: number | undefined;
      if (maxAge !== undefined) expiresAt = Date.now() + Number(maxAge) * 1000;
      else if (expires !== undefined) expiresAt = Date.parse(expires);

      if (value === "" || (expiresAt !== undefined && expiresAt <= Date.now())) {
        jar.delete(name);
        continue;
      }
      const sameSite = attribute("samesite")?.toLowerCase();
      jar.set(name, {
        value,
        sameSite: sameSite === "strict" || sameSite === "none" ? sameSite : "lax",
        expiresAt,
      });
    }
    this.cookies.set(host, jar);
  }
}

/** JSON の応答の `url` を取り出す。なければ、テストの前提が崩れているので例外にする。 */
export async function readUrl(response: Response): Promise<string> {
  const body: unknown = await response.json();
  if (typeof body === "object" && body !== null && "url" in body && typeof body.url === "string") {
    return body.url;
  }
  throw new Error(`応答に url がない (status ${response.status})`);
}
