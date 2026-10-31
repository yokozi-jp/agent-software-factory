import { afterEach, describe, expect, it } from "vite-plus/test";

import { clientId, startTestIdp, type TestIdp } from "../../test/oidc-provider.ts";

// 手で動かす IdP (test/dev-idp.ts、docs/tooling/local-api.md) が頼る、port と appOrigin の引数の試験。
describe("テスト用 IdP の起動の引数 (startTestIdp)", () => {
  const started: TestIdp[] = [];
  afterEach(async () => {
    await Promise.all(started.splice(0).map((idp) => idp.stop()));
  });

  async function authorize(idp: TestIdp, redirectUri: string): Promise<Response> {
    const query = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope: "openid",
      redirect_uri: redirectUri,
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    });
    return fetch(`${idp.issuer}/auth?${query.toString()}`, { redirect: "manual" });
  }

  it("port を渡すと、その port で待ち受けること", async () => {
    const probe = await startTestIdp();
    const port = Number(new URL(probe.issuer).port);
    await probe.stop();

    const idp = await startTestIdp({ port });
    started.push(idp);

    expect(idp.issuer).toBe(`http://127.0.0.1:${port}`);
  });

  it("appOrigin を渡すと、その origin の callback を戻り先として受け付けること", async () => {
    const idp = await startTestIdp({ appOrigin: "http://localhost:5173" });
    started.push(idp);

    const accepted = await authorize(idp, "http://localhost:5173/api/auth/callback/oidc");
    const rejected = await authorize(idp, "https://app.example.test/api/auth/callback/oidc");

    expect(accepted.status).toBe(303);
    expect(rejected.status).not.toBe(303);
  });
});
