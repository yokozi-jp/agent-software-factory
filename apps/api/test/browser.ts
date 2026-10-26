import { oidcProviderId } from "../src/auth/auth.ts";

/** Hono アプリと外の HTTP サーバー (Keycloak) をまたいで、ブラウザのように Cookie を持ち回す。 */
interface RequestableApp {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

export class TestBrowser {
  private readonly cookies = new Map<string, Map<string, string>>();
  /** アプリが返した Set-Cookie の行を、返された順にすべて残す。 */
  readonly appSetCookies: string[] = [];

  private readonly app: RequestableApp;
  private readonly appOrigin: string;

  constructor(app: RequestableApp, appOrigin: string) {
    this.app = app;
    this.appOrigin = appOrigin;
  }

  /** 指定した host の Cookie を、名前から値を引ける形で返す。 */
  cookieValue(url: string, name: string): string | undefined {
    return this.cookies.get(new URL(url).host)?.get(name);
  }

  /** リダイレクトを辿らずに 1 回だけ要求する。Cookie は host ごとに保存、送信する。 */
  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(url, this.appOrigin);
    const headers = new Headers(init.headers);
    const jar = this.cookies.get(target.host);
    if (jar && jar.size > 0) {
      headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
    }

    const response =
      target.origin === this.appOrigin
        ? await this.app.request(target.toString(), { ...init, headers })
        : await fetch(target, { ...init, headers, redirect: "manual" });

    if (target.origin === this.appOrigin)
      this.appSetCookies.push(...response.headers.getSetCookie());
    this.store(target.host, response);
    return response;
  }

  /** リダイレクトを辿り、最後の応答を返す。 */
  async follow(url: string, init: RequestInit = {}): Promise<Response> {
    let response = await this.request(url, init);
    let current = new URL(url, this.appOrigin);
    for (let hops = 0; hops < 10; hops += 1) {
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || location === null) return response;
      current = new URL(location, current);
      response = await this.request(current.toString());
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

    return this.follow(callback);
  }

  private store(host: string, response: Response): void {
    const jar = this.cookies.get(host) ?? new Map<string, string>();
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const maxAge = attributes.find((attribute) => attribute.toLowerCase().startsWith("max-age="));
      if (value === "" || maxAge?.split("=")[1] === "0") jar.delete(name);
      else jar.set(name, value);
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
