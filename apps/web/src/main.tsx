import { createI18n, resolveLanguage } from "@agent-software-factory/i18n";
import { RouterProvider, createBrowserHistory } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";

import "temporal-polyfill/global";
import "./index.css";
import { createApiClient } from "./lib/api-client.ts";
import { fetchSession, withSessionExpiry, type AppContext } from "./lib/session.ts";
import { createAppRouter, goToSessionExpired } from "./router.ts";

// 認証は同じオリジンの /api/auth/* に向く (Better Auth の既定。docs/adr/0022)。
const authClient = createAuthClient();

// IdP の ID。apps/api の oidcProviderId と同じ値にする (apps/web は apps/api を import しない)。
const oidcProviderId = "oidc";

const context: AppContext = {
  apiFetch: withSessionExpiry(
    (input, init) => fetch(input, init),
    () => {
      goToSessionExpired(router);
    },
  ),
  getSession: () => fetchSession(createApiClient(location.origin, fetch)),
  signIn: async (callbackURL) => {
    const { error } = await authClient.signIn.social({ provider: oidcProviderId, callbackURL });
    if (error) throw new Error(`Sign in failed: ${error.message ?? error.statusText}`);
  },
};

const router = createAppRouter(context, createBrowserHistory());

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
