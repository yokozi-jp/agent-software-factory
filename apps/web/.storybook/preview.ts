import { createI18n } from "@agent-software-factory/i18n";
import type { Preview } from "@storybook/react-vite";
import { createElement } from "react";
import { I18nextProvider } from "react-i18next";
import { configure } from "storybook/test";

// アプリと同じ CSS (Tailwind とテーマ) を、全ての story に読む。
import "../src/index.css";

// アプリと同じ文言を使う。story は日本語で確かめる (docs/adr/0044)。
const i18n = await createI18n("ja");

// route の部品は、最初に開いた時に Vite の dev server から読むので、Testing Library の findBy の既定の 1 秒
// (https://testing-library.com/docs/dom-testing-library/api-configuration/ の asyncUtilTimeout) では足りないことがある。
configure({ asyncUtilTimeout: 5000 });

const preview: Preview = {
  // a11y (axe) の違反のある story は、テストが失敗する。直せない story だけ、その story の parameters で
  // `a11y: { test: "todo" }` にして警告にとどめる (docs/adr/0033)。
  parameters: {
    a11y: {
      test: "error",
      // 既定は WCAG 2.0/2.1 の A・AA と best-practice だけで、押せる大きさの `target-size` (WCAG 2.2 SC 2.5.8、AA) は
      // `wcag22aa` だけに付くので動かない。`runOnly` は書いたタグの規則だけを動かすので、既定のタグも並べる (Issue #724)。
      options: {
        runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
      },
    },
    // スマホの下限 (320px) と、iPhone の多数派の幅 (390px) (Issue #724、docs/web-frontend/mobile.md)。
    viewport: {
      options: {
        mobile320: {
          name: "スマホ 320px",
          styles: { width: "320px", height: "640px" },
          type: "mobile",
        },
        mobile390: {
          name: "スマホ 390px",
          styles: { width: "390px", height: "844px" },
          type: "mobile",
        },
      },
    },
  },
  decorators: [(Story) => createElement(I18nextProvider, { i18n }, createElement(Story))],
};

export default preview;
