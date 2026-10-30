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
  decorators: [(Story) => createElement(I18nextProvider, { i18n }, createElement(Story))],
};

export default preview;
