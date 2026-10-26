import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";
import { users } from "../../test/credentials.ts";

describe("session cookies (docs/adr/0022, RFC 10017 6.1.3.2)", () => {
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

  it.each(["__Host-session_token", "__Host-state"])(
    "gives %s the attributes RFC 10017 asks for",
    (name) => {
      const line = setCookies.find((candidate) => candidate.startsWith(`${name}=`));
      expect(line, `${name} was not set`).toBeDefined();
      const attributes = (line ?? "").split(";").map((part) => part.trim().toLowerCase());

      expect(attributes).toContain("secure");
      expect(attributes).toContain("httponly");
      expect(attributes).toContain("samesite=strict");
      expect(attributes).toContain("path=/");
      expect(attributes.some((attribute) => attribute.startsWith("domain="))).toBe(false);
    },
  );

  it("never sets a cookie without the __Host- prefix", () => {
    const unprefixed = setCookies.filter((line) => !line.startsWith("__Host-"));

    expect(unprefixed).toEqual([]);
  });
});
