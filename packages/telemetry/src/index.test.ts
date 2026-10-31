import { describe, expect, it } from "vite-plus/test";

import { urlWithoutQuery } from "./index.ts";

describe("urlWithoutQuery", () => {
  it("クエリ文字列とフラグメントを落とし、オリジンとパスを残す", () => {
    expect(urlWithoutQuery("https://example.com/a/b?code=1&state=2#top")).toBe(
      "https://example.com/a/b",
    );
  });

  it("userinfo を落とす", () => {
    expect(urlWithoutQuery("https://user:pass@example.com/a")).toBe("https://example.com/a");
  });

  it("パスだけの値は、基準のオリジンと合わせる", () => {
    expect(urlWithoutQuery("/path?api_key=1", "http://127.0.0.1:8080")).toBe(
      "http://127.0.0.1:8080/path",
    );
  });
});
