import { createI18n, resolveLanguage } from "@agent-software-factory/i18n";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";

import "temporal-polyfill/global";
import "./index.css";
import { routeTree } from "./routeTree.gen.ts";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root not found");

// 言語はブラウザの言語で決める。アプリの中の切り替えと保存は作らない (docs/adr/0044)。
const language = resolveLanguage(navigator.languages);
// index.html の lang は固定なので、決めた言語に合わせる (スクリーンリーダー、字形、ハイフネーションが使う)。
document.documentElement.lang = language;

// 文言は同梱のリソースで、通信しないので、初期化はほぼ失敗しない。失敗したら、文言なしでも分かる表示を出し、
// エラーは投げ直す (ブラウザのコンソールとエラー収集に届く)。
let i18n;
try {
  i18n = await createI18n(language);
} catch (error) {
  rootElement.textContent = "Failed to start the application. Please reload the page.";
  throw error;
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>
  </StrictMode>,
);
