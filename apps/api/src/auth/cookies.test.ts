import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";
import { users } from "../../test/credentials.ts";

// state は、IdP から戻る callback で送られる必要があるので Lax にする。ほかは Strict (RFC 10017 6.1.3.2)。
const expectedSameSite = (name: string) =>
  name === "__Host-state" ? "samesite=lax" : "samesite=strict";

describe("cookies the login sets (docs/adr/0022, RFC 10017 6.1.3.2)", () => {
  let fixture: AuthFixture;
  let setCookies: string[];

  beforeAll(async () => {
    fixture = await createAuthFixture();
    const browser = fixture.newBrowser();
    await browser.login(users.yamada);
    setCookies = browser.appSetCookies;
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("sets the session cookie", () => {
    expect(setCookies.some((line) => line.startsWith("__Host-session_token="))).toBe(true);
  });

  it("gives every cookie the __Host- prefix and the attributes it requires", () => {
    const problems: string[] = [];

    for (const line of setCookies) {
      const name = line.slice(0, line.indexOf("="));
      const attributes = line
        .split(";")
        .slice(1)
        .map((part) => part.trim().toLowerCase());

      if (!name.startsWith("__Host-")) problems.push(`${name}: no __Host- prefix`);
      if (!attributes.includes("secure")) problems.push(`${name}: not Secure`);
      if (!attributes.includes("httponly")) problems.push(`${name}: not HttpOnly`);
      if (!attributes.includes("path=/")) problems.push(`${name}: Path is not /`);
      if (!attributes.includes(expectedSameSite(name))) problems.push(`${name}: wrong SameSite`);
      if (attributes.some((attribute) => attribute.startsWith("domain="))) {
        problems.push(`${name}: has a Domain`);
      }
    }

    expect(setCookies.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
