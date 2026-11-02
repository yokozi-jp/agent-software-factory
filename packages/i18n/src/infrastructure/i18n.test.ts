import { describe, expect, it } from "vite-plus/test";

import { createI18n } from "./i18n.ts";

describe("言語ごとの文言", () => {
  it("ja では日本語の文言を返すこと", async () => {
    const i18n = await createI18n("ja");
    expect(i18n.t("home.sampleButton")).toBe("ボタン");
  });

  it("en では英語の文言を返すこと", async () => {
    const i18n = await createI18n("en");
    expect(i18n.t("home.sampleButton")).toBe("Button");
  });

  it("言語ごとに独立した instance を返すこと", async () => {
    const ja = await createI18n("ja");
    const en = await createI18n("en");
    expect(ja.t("home.sampleButton")).not.toBe(en.t("home.sampleButton"));
    expect(ja.language).toBe("ja");
    expect(en.language).toBe("en");
  });
});
