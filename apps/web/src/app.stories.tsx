import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { RouteError } from "./components/route-error.tsx";
import { ForbiddenError } from "./lib/forbidden.ts";
import { EmbeddedNotFound, ForbiddenScreen } from "./components/error-screens.tsx";
import { LoginScreen as LoginScreenView } from "./components/login-screen.tsx";
import {
  withSessionExpiry,
  type AppContext,
  type SessionState,
  type SignedInUser,
} from "./lib/session.ts";
import { createAppRouter, goToSessionExpired, type AppRouter } from "./router.ts";

// 画面と遷移の component test (docs/adr/0033)。本物の route の木を、メモリ履歴のルーターと、`/api/me` の応答を
// 決める mock の context で動かす (Issue #406、#401 の条件 1、4〜7、15)。

const member: SignedInUser = { name: "田中 太郎", roles: [] };
const accounting: SignedInUser = { name: "鈴木 花子", roles: ["accounting"] };

interface ReadyApp {
  router: AppRouter;
  context: AppContext;
}

interface AppProps {
  /** 最初に開く URL。 */
  path: string;
  /** `GET /api/me` の結果。"unavailable" は答えない (障害)。 */
  session: SessionState | "unavailable";
  signIn: AppContext["signIn"];
  signOut: AppContext["signOut"];
  /** 業務の API が返す status。 */
  apiStatus?: number;
}

const accountUnavailable =
  "このアカウントでは利用できません。心当たりがない場合は、管理者に連絡してください。";
const notFoundTitle = "お探しのページは見つかりません。URL を確認するか、トップへ戻ってください。";
const forbiddenTitle = "このページを表示する権限がありません。";

let latest: ReadyApp | undefined;

function App({ path, session, signIn, signOut, apiStatus = 200 }: AppProps) {
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
      getSession: () =>
        current === "unavailable"
          ? Promise.reject(new Error("unavailable"))
          : Promise.resolve(current),
      signIn,
      signOut,
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
  args: {
    path: "/",
    session: "unauthenticated",
    signIn: fn<AppContext["signIn"]>(() => Promise.resolve()),
    signOut: fn<AppContext["signOut"]>(() => Promise.resolve()),
  },
  // 前の story が残した、テーマの選択と `.dark` を消す。
  beforeEach: () => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  },
} satisfies Meta<typeof App>;

export default meta;

type Story = StoryObj<typeof meta>;

function locationOf() {
  return currentApp().router.state.location;
}

function currentApp(): ReadyApp {
  if (latest === undefined) throw new Error("the app has not been rendered");
  return latest;
}

async function expectHomeAt(
  canvas: { findByRole: (role: string, options: object) => Promise<HTMLElement> },
  href: string,
) {
  await canvas.findByRole("heading", { name: "ホーム" });
  await expect(locationOf().href).toBe(href);
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

export const LoginShowsAnAlertWhenSignInFails: Story = {
  args: {
    path: "/login",
    signIn: fn<AppContext["signIn"]>(() => Promise.reject(new Error("idp down"))),
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "IdP でログイン" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent("ログインできませんでした");
    await expect(args.signIn).toHaveBeenCalledOnce();
    await expect(canvas.getByRole("button", { name: "IdP でログイン" })).toBeVisible();
    // もう一度押すと、前の失敗の表示は消えてから、やり直す。
    await userEvent.click(canvas.getByRole("button", { name: "IdP でログイン" }));
    await expect(args.signIn).toHaveBeenCalledTimes(2);
  },
};

export const LoginOpensWhenTheSessionCheckIsUnavailable: Story = {
  args: { path: "/login", session: "unavailable" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("button", { name: "IdP でログイン" })).toBeVisible();
    await expect(locationOf().pathname).toBe("/login");
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

export const LoginWithAccountUnavailable: Story = {
  args: { path: "/login?error=account_unavailable" },
  play: async ({ args, canvas }) => {
    const alert = await canvas.findByRole("alert");
    await expect(alert).toHaveTextContent(accountUnavailable);
    // 識別子の文字は見せない。
    await expect(alert).not.toHaveTextContent("account_unavailable");
    await userEvent.click(canvas.getByRole("button", { name: "IdP でログイン" }));
    await expect(args.signIn).toHaveBeenCalledWith("/");
  },
};

export const LoginWithAnUnknownError: Story = {
  args: { path: "/login?error=state_mismatch" },
  play: async ({ canvas }) => {
    const alert = await canvas.findByRole("alert");
    await expect(alert).toHaveTextContent("ログインできませんでした。もう一度お試しください。");
    await expect(alert).not.toHaveTextContent("state_mismatch");
    await expect(canvas.getByRole("button", { name: "IdP でログイン" })).toBeVisible();
  },
};

// 「一時的に使えない」の識別子は人事システムの確認 (Issue #156) が決める。それまでは URL から出せないので、画面だけを確かめる。
export const LoginTemporarilyUnavailable: Story = {
  render: () => (
    <LoginScreenView kind="temporarilyUnavailable" onSignIn={() => Promise.resolve()} />
  ),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "ただいま利用できません。しばらくしてから、もう一度お試しください。",
    );
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
    await expect(locationOf().pathname).toBe("/login");
    await expect(locationOf().search).toEqual({ redirect: "/?from=mail" });
  },
};

export const SignedOutVisitToHomeMovesToLogin: Story = {
  args: { path: "/", session: "unauthenticated" },
  play: async ({ canvas }) => {
    await canvas.findByRole("button", { name: "IdP でログイン" });
    await expect(locationOf().href).toBe("/login");
  },
};

export const SignedInOpensHome: Story = {
  args: { path: "/", session: member },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "ホーム" })).toBeVisible();
  },
};

export const SignedInLoginMovesToHome: Story = {
  args: { path: "/login", session: member },
  play: async ({ canvas }) => {
    await expectHomeAt(canvas, "/");
  },
};

export const SignedInLoginMovesToTheReturnPath: Story = {
  args: { path: "/login?redirect=%2F%3Ffrom%3Dmail", session: member },
  play: async ({ canvas }) => {
    await expectHomeAt(canvas, "/?from=mail");
  },
};

export const SignedInLoginIgnoresAnExternalReturnPath: Story = {
  args: { path: "/login?redirect=https%3A%2F%2Fevil.example", session: member },
  play: async ({ canvas }) => {
    await expectHomeAt(canvas, "/");
  },
};

export const NotFoundWhenSignedIn: Story = {
  args: { path: "/no-such-page", session: member },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: notFoundTitle })).toBeVisible();
    await expect(await canvas.findByRole("link", { name: "トップへ戻る" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(locationOf().pathname).toBe("/no-such-page");
  },
};

export const NotFoundWhenSignedOut: Story = {
  args: { path: "/no-such-page", session: "unauthenticated" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: notFoundTitle })).toBeVisible();
    await expect(await canvas.findByRole("link", { name: "ログインへ" })).toHaveAttribute(
      "href",
      "/login",
    );
    await expect(canvas.queryByRole("link", { name: "トップへ戻る" })).toBeNull();
    await expect(locationOf().pathname).toBe("/no-such-page");
  },
};

// 確かめられない (障害) ときは未ログインとして扱い、ログイン画面への道を残す。
export const NotFoundWhenTheSessionCheckIsUnavailable: Story = {
  args: { path: "/no-such-page", session: "unavailable" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: "ログインへ" })).toHaveAttribute(
      "href",
      "/login",
    );
  },
};

export const SessionExpiresDuringAnOperation: Story = {
  args: { path: "/?from=mail", session: member, apiStatus: 401 },
  play: async ({ canvas }) => {
    await canvas.findByRole("heading", { name: "ホーム" });
    const { context } = currentApp();
    await context.apiFetch("/api/claims");
    await expect(await canvas.findByRole("alert")).toHaveTextContent("有効期限が切れました");
    await expect(locationOf().pathname).toBe("/login");
    await expect(locationOf().search).toEqual({
      redirect: "/?from=mail",
      reason: "session-expired",
    });
  },
};

export const SessionExpiryOnTheLoginScreenStaysThere: Story = {
  args: { path: "/login", session: "unauthenticated", apiStatus: 401 },
  play: async ({ canvas }) => {
    await canvas.findByRole("button", { name: "IdP でログイン" });
    await currentApp().context.apiFetch("/api/claims");
    await expect(locationOf().href).toBe("/login");
  },
};

export const OtherApiErrorsStayOnTheScreen: Story = {
  args: { path: "/", session: member, apiStatus: 403 },
  play: async ({ canvas }) => {
    await canvas.findByRole("heading", { name: "ホーム" });
    const { context } = currentApp();
    await expect((await context.apiFetch("/api/claims")).status).toBe(403);
    await expect(locationOf().pathname).toBe("/");
  },
};

// 403 の画面だけを確かめる。経理専用の route が 403 を出す流れは、下の `ForbiddenForNonAccountingUser` が確かめる。
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
      await canvas.findByRole("heading", { name: "このページを表示する権限がありません。" }),
    ).toBeVisible();
    await expect(canvas.getByRole("link", { name: "トップへ戻る" })).toHaveAttribute("href", "/");
  },
};

// グローバルメニューと、役割ごとの出し分け、経理専用の route のガード、ユーザーメニュー (Issue #407、#401)。

export const MenuShowsTheItemsOfAnApplicant: Story = {
  args: { path: "/", session: member },
  play: async ({ canvas }) => {
    const nav = await canvas.findByRole("navigation", { name: "メインメニュー" });
    await expect(within(nav).getByRole("link", { name: "承認" })).toHaveAttribute(
      "href",
      "/approvals",
    );
    await expect(within(nav).queryByRole("link", { name: "確認" })).toBeNull();
    await expect(within(nav).queryByRole("link", { name: "締め" })).toBeNull();
    // 見える項目のないグループは出さない。
    await expect(within(nav).queryByText("締め")).toBeNull();
  },
};

export const MenuShowsTheAccountingItemsToAccounting: Story = {
  args: { path: "/", session: accounting },
  play: async ({ canvas }) => {
    const nav = await canvas.findByRole("navigation", { name: "メインメニュー" });
    await expect(within(nav).getByRole("link", { name: "承認" })).toBeVisible();
    await expect(within(nav).getByRole("link", { name: "確認" })).toBeVisible();
    await expect(within(nav).getByRole("link", { name: "締め" })).toBeVisible();
  },
};

export const MenuMarksTheCurrentItem: Story = {
  args: { path: "/approvals", session: member },
  play: async ({ canvas }) => {
    const nav = await canvas.findByRole("navigation", { name: "メインメニュー" });
    await expect(within(nav).getByRole("link", { name: "承認" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // 上部バーに、今の画面の名前が出る。
    await expect(canvas.getByRole("heading", { name: "承認" })).toBeVisible();
  },
};

export const MenuMovesToTheChosenItem: Story = {
  args: { path: "/", session: accounting },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("link", { name: "締め" }));
    await expect(await canvas.findByRole("heading", { name: "締め" })).toBeVisible();
    await expect(locationOf().pathname).toBe("/closing");
  },
};

export const AccountingScreenIsOpenToAccounting: Story = {
  args: { path: "/closing", session: accounting },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "締め" })).toBeVisible();
    await expect(canvas.queryByRole("heading", { name: forbiddenTitle })).toBeNull();
  },
};

export const ReviewScreenIsOpenToAccounting: Story = {
  args: { path: "/review", session: accounting },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "確認" })).toBeVisible();
  },
};

// 経理専用の route の errorComponent。権限のエラーは 403、ほかの失敗は一般のエラー。
export const RouteErrorShowsForbiddenOrAGenericError: Story = {
  render: () => {
    // 403 の画面の link が router を要るので、最小の router の中に出す。
    const root = createRootRoute({
      component: () => (
        <>
          <RouteError error={new ForbiddenError()} />
          <RouteError error={new Error("boom")} />
        </>
      ),
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    return <RouterProvider router={router} />;
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: forbiddenTitle })).toBeVisible();
    await expect(canvas.getByRole("alert")).toHaveTextContent("エラーが発生しました");
  },
};

export const ForbiddenForNonAccountingUser: Story = {
  args: { path: "/closing", session: member },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: forbiddenTitle })).toBeVisible();
    // URL は変えない。メニューは出す。
    await expect(locationOf().pathname).toBe("/closing");
    await expect(canvas.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
    // 見出し (h1) は 403 の画面の 1 つだけ。上部バーは名前を出さない。
    await expect(canvas.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  },
};

// route の中で notFound() を投げたときの 404 (ログイン済みはメニューの中)。投げる route はまだないので、画面だけを最小の router で確かめる。
function inMinimalRouter(screen: () => React.JSX.Element) {
  return () => {
    const root = createRootRoute({ component: screen });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    return <RouterProvider router={router} />;
  };
}

export const NotFoundThrownInAProtectedRouteIsEmbedded: Story = {
  render: inMinimalRouter(EmbeddedNotFound),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: notFoundTitle })).toBeVisible();
    await expect(canvas.queryByRole("main")).toBeNull();
  },
};

export const MenuIsNotShownOnTheLoginScreen: Story = {
  args: { path: "/login", session: "unauthenticated" },
  play: async ({ canvas }) => {
    await canvas.findByRole("button", { name: "IdP でログイン" });
    await expect(canvas.queryByRole("navigation", { name: "メインメニュー" })).toBeNull();
    await expect(canvas.queryByRole("button", { name: "ライト" })).toBeNull();
  },
};

export const MenuIsNotShownOnTheNotFoundScreenWhenSignedOut: Story = {
  args: { path: "/no-such-page", session: "unauthenticated" },
  play: async ({ canvas }) => {
    await canvas.findByRole("heading", { name: notFoundTitle });
    await expect(canvas.queryByRole("navigation", { name: "メインメニュー" })).toBeNull();
  },
};

export const MenuIsShownOnTheNotFoundScreenWhenSignedIn: Story = {
  args: { path: "/no-such-page", session: member },
  play: async ({ canvas }) => {
    await canvas.findByRole("heading", { name: notFoundTitle });
    await expect(canvas.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
  },
};

export const SkipLinkMovesToTheMainContent: Story = {
  args: { path: "/", session: member },
  play: async ({ canvas }) => {
    const skip = await canvas.findByRole("link", { name: "本文へ移動" });
    await expect(skip).toHaveAttribute("href", "#main-content");
    await expect(canvas.getByRole("main")).toHaveAttribute("id", "main-content");
  },
};

// 画面の幅を、matchMedia の差し替えで決める (useIsMobile は `(max-width: 767px)` を見る)。
function withScreen(narrow: boolean) {
  const original = window.matchMedia.bind(window);
  window.matchMedia = (query) => {
    const media = original(query);
    if (!query.includes("max-width")) return media;
    // 本物の MediaQueryList の部品を使い、`matches` だけを差し替える。
    return {
      media: media.media,
      matches: narrow,
      onchange: null,
      addEventListener: media.addEventListener.bind(media),
      removeEventListener: media.removeEventListener.bind(media),
      addListener: media.addListener.bind(media),
      removeListener: media.removeListener.bind(media),
      dispatchEvent: media.dispatchEvent.bind(media),
    };
  };
  return () => {
    window.matchMedia = original;
  };
}

export const TriggerTogglesTheMenu: Story = {
  args: { path: "/", session: member },
  beforeEach: () => withScreen(false),
  play: async ({ canvas }) => {
    const trigger = await canvas.findByRole("button", { name: "メニューを開閉" });
    const sidebar = () => document.querySelector("[data-slot='sidebar']");
    await expect(sidebar()).toHaveAttribute("data-state", "expanded");
    await userEvent.click(trigger);
    await expect(sidebar()).toHaveAttribute("data-state", "collapsed");
    await userEvent.click(trigger);
    await expect(sidebar()).toHaveAttribute("data-state", "expanded");
  },
};

export const TriggerOpensTheMenuInASheetOnANarrowScreen: Story = {
  args: { path: "/", session: member },
  beforeEach: () => withScreen(true),
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "メニューを開閉" }));
    // Sheet は portal で body の直下に出る。
    const nav = await within(document.body).findByRole("navigation", { name: "メインメニュー" });
    // 開くときの animation で、出た直後は見えない (#523)。見えるまで待つ。
    await waitFor(() => expect(within(nav).getByRole("link", { name: "承認" })).toBeVisible());
  },
};

export const UserMenuShowsTheNameAndSignsOut: Story = {
  args: { path: "/", session: member },
  play: async ({ args, canvas }) => {
    await canvas.findByText("田中 太郎");
    await userEvent.click(canvas.getByRole("button", { name: "ログアウト" }));
    // 確認なしで呼ぶ。
    await expect(args.signOut).toHaveBeenCalledOnce();
  },
};

export const SignOutFailureIsShown: Story = {
  args: {
    path: "/",
    session: member,
    signOut: fn<AppContext["signOut"]>(() => Promise.reject(new Error("idp down"))),
  },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "ログアウト" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent("ログアウトできませんでした");
  },
};

export const ThemeIsChosenAndRemembered: Story = {
  args: { path: "/", session: member },
  play: async ({ canvas }) => {
    const html = document.documentElement;
    await userEvent.click(await canvas.findByRole("button", { name: "ダーク" }));
    await expect(html).toHaveClass("dark");
    await expect(localStorage.getItem("theme")).toBe("dark");
    await expect(canvas.getByRole("button", { name: "ダーク" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(canvas.getByRole("button", { name: "ライト" }));
    await expect(html).not.toHaveClass("dark");
    await expect(localStorage.getItem("theme")).toBe("light");
    await userEvent.click(canvas.getByRole("button", { name: "システム" }));
    await expect(localStorage.getItem("theme")).toBe("system");
  },
};

export const ThemeChoiceIsRestoredWhenTheMenuOpens: Story = {
  args: { path: "/", session: member },
  beforeEach: () => {
    localStorage.setItem("theme", "dark");
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("button", { name: "ダーク" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  },
};
