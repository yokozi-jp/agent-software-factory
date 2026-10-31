import { createI18n, resolveLanguage } from "@agent-software-factory/i18n";
import { RouterProvider, createBrowserHistory } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";

import "temporal-polyfill/global";
import "./index.css";
import { applyStoredTheme, darkMediaQuery } from "./lib/theme.ts";
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
  signOut: async () => {
    // IdP が end_session_endpoint を持てば、その URL が返る。持たなければ /login に移る。
    const { data, error } = await authClient.signOut({
      disableRedirect: true,
      callbackURL: loggedOutUrl,
    });
    if (error) throw new Error(`Sign out failed: ${error.message ?? error.statusText}`);
    location.assign(typeof data?.url === "string" ? data.url : loggedOutUrl);
  },
};

// ログアウト後の戻り先。/login が「ログアウトしました」を出す (lib/login-redirect.ts の reason)。
const loggedOutUrl = "/login?reason=logged-out";

const router = createAppRouter(context, createBrowserHistory());

// 保存したテーマは、最初の描画の前に反映する (ちらつき防止。inline script は CSP で使えない)。
applyStoredTheme(localStorage, document.documentElement, darkMediaQuery());

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
