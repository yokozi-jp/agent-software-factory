import { describe, expect, it } from "vite-plus/test";

import { resolveLanguage } from "./language.ts";

describe("ブラウザの言語から表示の言語を決める", () => {
  it.each([
    [["ja"], "ja"],
    [["ja-JP"], "ja"],
    [["en-US"], "en"],
    [["en"], "en"],
  ])("%j は %s にすること", (languages, expected) => {
    expect(resolveLanguage(languages)).toBe(expected);
  });

  it("ja と en 以外だけのときは en にすること", () => {
    expect(resolveLanguage(["fr-FR", "de"])).toBe("en");
  });

  it("優先順位の高い言語から、ja か en の最初のものを選ぶこと", () => {
    expect(resolveLanguage(["fr", "ja-JP", "en"])).toBe("ja");
  });

  it("言語がないときは en にすること", () => {
    expect(resolveLanguage([])).toBe("en");
  });

  it("大文字小文字を区別しないこと", () => {
    expect(resolveLanguage(["JA-jp"])).toBe("ja");
  });
});
