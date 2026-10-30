import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { expect, fn, userEvent } from "storybook/test";

import { ForbiddenScreen } from "./components/error-screens.tsx";
import { withSessionExpiry, type AppContext, type SessionState } from "./lib/session.ts";
import { createAppRouter, goToSessionExpired, type AppRouter } from "./router.ts";

// 画面と遷移の component test (docs/adr/0033)。本物の route の木を、メモリ履歴のルーターと、`/api/me` の応答を
// 決める mock の context で動かす (Issue #406、#401 の条件 1、4〜7、15)。

interface ReadyApp {
  router: AppRouter;
  context: AppContext;
}

interface AppProps {
  /** 最初に開く URL。 */
  path: string;
  /** `GET /api/me` の結果。 */
  session: SessionState;
  signIn: AppContext["signIn"];
  /** 業務の API が返す status。 */
  apiStatus?: number;
}

let latest: ReadyApp | undefined;

function App({ path, session, signIn, apiStatus = 200 }: AppProps) {
  const [app] = useState(() => {
    // 401 を返した後は、サーバーの側でもセッションがない。
    let current = session;
    const context: AppContext = {
      apiFetch: withSessionExpiry(
        () => {
          if (apiStatus === 401) current = "unauthenticated";
          return Promise.resolve(new Response(null, { status: apiStatus }));
        },
        () => {
          goToSessionExpired(router);
        },
      ),
      getSession: () => Promise.resolve(current),
      signIn,
    };
    const router = createAppRouter(context, createMemoryHistory({ initialEntries: [path] }));
    const created = { router, context };
    // play が router を読めるよう、作った router を覚える。story は 1 つずつ流れる。
    latest = created;
    return created;
  });
  return <RouterProvider router={app.router} />;
}

const meta = {
  title: "web/App",
  component: App,
  args: { path: "/", session: "unauthenticated", signIn: fn() },
} satisfies Meta<typeof App>;

export default meta;

type Story = StoryObj<typeof meta>;

function currentApp(): ReadyApp {
  if (latest === undefined) throw new Error("the app has not been rendered");
  return latest;
}

async function expectHomeAt(
  canvas: { findByRole: (role: string, options: object) => Promise<HTMLElement> },
  href: string,
) {
  await canvas.findByRole("heading", { name: "agent-software-factory" });
  await expect(currentApp().router.state.location.href).toBe(href);
}

export const LoginScreen: Story = {
  args: { path: "/login" },
  play: async ({ args, canvas }) => {
    const button = await canvas.findByRole("button", { name: "IdP でログイン" });
    await expect(canvas.queryByRole("alert")).toBeNull();
    await userEvent.click(button);
    await expect(args.signIn).toHaveBeenCalledWith("/");
  },
};

export const LoginReturnsToTheRequestedPath: Story = {
  args: { path: "/login?redirect=%2F%3Ffrom%3Dmail" },
  play: async ({ args, canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "IdP でログイン" }));
    await expect(args.signIn).toHaveBeenCalledWith("/?from=mail");
  },
};

export const LoginIgnoresAnExternalReturnPath: Story = {
  args: { path: "/login?redirect=%2F%2Fevil.example" },
  play: async ({ args, canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "IdP でログイン" }));
    await expect(args.signIn).toHaveBeenCalledWith("/");
  },
};

export const LoginAfterSessionExpired: Story = {
  args: { path: "/login?reason=session-expired" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent("有効期限が切れました");
    await expect(canvas.getByRole("button", { name: "IdP でログイン" })).toBeVisible();
  },
};

export const LoginAfterLogout: Story = {
  args: { path: "/login?reason=logged-out" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent("ログアウトしました");
    await expect(canvas.getByRole("button", { name: "IdP でログイン" })).toBeVisible();
  },
};

export const LoginWithAnUnknownReason: Story = {
  args: { path: "/login?reason=%3Cscript%3E" },
  play: async ({ canvas }) => {
    await canvas.findByRole("button", { name: "IdP でログイン" });
    await expect(canvas.queryByRole("alert")).toBeNull();
  },
};

export const SignedOutVisitMovesToLoginWithTheOriginalPath: Story = {
  args: { path: "/?from=mail", session: "unauthenticated" },
  play: async ({ canvas }) => {
    await canvas.findByRole("button", { name: "IdP でログイン" });
    const { router } = currentApp();
    await expect(router.state.location.pathname).toBe("/login");
    await expect(router.state.location.search).toEqual({ redirect: "/?from=mail" });
  },
};

export const SignedOutVisitToHomeMovesToLogin: Story = {
  args: { path: "/", session: "unauthenticated" },
  play: async ({ canvas }) => {
    await canvas.findByRole("button", { name: "IdP でログイン" });
    const { router } = currentApp();
    await expect(router.state.location.href).toBe("/login");
  },
};

export const SignedInOpensHome: Story = {
  args: { path: "/", session: "authenticated" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "agent-software-factory" }),
    ).toBeVisible();
  },
};

export const SignedInLoginMovesToHome: Story = {
  args: { path: "/login", session: "authenticated" },
  play: async ({ canvas }) => {
    await expectHomeAt(canvas, "/");
  },
};

export const SignedInLoginMovesToTheReturnPath: Story = {
  args: { path: "/login?redirect=%2F%3Ffrom%3Dmail", session: "authenticated" },
  play: async ({ canvas }) => {
    await expectHomeAt(canvas, "/?from=mail");
  },
};

export const SignedInLoginIgnoresAnExternalReturnPath: Story = {
  args: { path: "/login?redirect=https%3A%2F%2Fevil.example", session: "authenticated" },
  play: async ({ canvas }) => {
    await expectHomeAt(canvas, "/");
  },
};

export const NotFoundWhenSignedIn: Story = {
  args: { path: "/no-such-page", session: "authenticated" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "ページが見つかりません。" }),
    ).toBeVisible();
    await expect(canvas.getByRole("link", { name: "トップへ戻る" })).toHaveAttribute("href", "/");
    const { router } = currentApp();
    await expect(router.state.location.pathname).toBe("/no-such-page");
  },
};

export const NotFoundWhenSignedOut: Story = {
  args: { path: "/no-such-page", session: "unauthenticated" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "ページが見つかりません。" }),
    ).toBeVisible();
    const { router } = currentApp();
    await expect(router.state.location.pathname).toBe("/no-such-page");
  },
};

export const SessionExpiresDuringAnOperation: Story = {
  args: { path: "/?from=mail", session: "authenticated", apiStatus: 401 },
  play: async ({ canvas }) => {
    await canvas.findByRole("heading", { name: "agent-software-factory" });
    const { router, context } = currentApp();
    await context.apiFetch("/api/claims");
    await expect(await canvas.findByRole("alert")).toHaveTextContent("有効期限が切れました");
    await expect(router.state.location.pathname).toBe("/login");
    await expect(router.state.location.search).toEqual({
      redirect: "/?from=mail",
      reason: "session-expired",
    });
  },
};

export const OtherApiErrorsStayOnTheScreen: Story = {
  args: { path: "/", session: "authenticated", apiStatus: 403 },
  play: async ({ canvas }) => {
    await canvas.findByRole("heading", { name: "agent-software-factory" });
    const { router, context } = currentApp();
    await expect((await context.apiFetch("/api/claims")).status).toBe(403);
    await expect(router.state.location.pathname).toBe("/");
  },
};

// 403 は URL を変えず、権限のない route の中に出す。判定する route は Issue #407 で足すので、ここでは画面だけを確かめる。
export const Forbidden: Story = {
  render: () => {
    const root = createRootRoute();
    const admin = createRoute({
      getParentRoute: () => root,
      path: "/admin",
      component: ForbiddenScreen,
    });
    const router = createRouter({
      routeTree: root.addChildren([admin]),
      history: createMemoryHistory({ initialEntries: ["/admin"] }),
    });
    return <RouterProvider router={router} />;
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "この画面を開く権限がありません。" }),
    ).toBeVisible();
    await expect(canvas.getByRole("link", { name: "トップへ戻る" })).toHaveAttribute("href", "/");
  },
};
