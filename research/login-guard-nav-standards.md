# ログイン保護と遷移、ナビゲーション部品、ログアウトの画面側のつなぎ方の標準を調べる

## 問い

[Issue #398](https://github.com/yokozi-jp/agent-software-factory/issues/398) の調査。地図 [Issue #396](https://github.com/yokozi-jp/agent-software-factory/issues/396) の決定が前提にする、次の 3 点の現行の標準を公式ドキュメントで確かめる。

1. TanStack Router の認証ガード（`beforeLoad`、redirect、戻り先の保持）の標準的な書き方。
2. shadcn/ui と Base UI のナビゲーション部品（ヘッダー、メニュー、サイドバー）。
3. ADR 0022 のログアウトの 4 動作を、画面側からどうつなぐか。

調べた日は 2026-10-29。ブラウザでも IdP でも何も実行していない。読んだのは各プロジェクトの `main` 時点のドキュメントで、リポジトリの固定版（`@tanstack/react-router` ^1.170.45、`@base-ui/react` ^1.9.0、`shadcn` ^4.22.1）との差は確かめていない。

## 要約

- **ガードの標準**: 保護する route を pathless layout route（`_authenticated`）にまとめ、その `beforeLoad` で未認証なら `throw redirect({ to: '/login', search: { redirect: location.href } })` する。`beforeLoad` は子の route より先に走り、throw すると子は読み込まれない。
- **ガードは認可の境界ではない**: TanStack の公式が「route のガードはデータの認可の境界ではない。private なデータを返す API は自分で認可する」と明記する。これは `docs/web-frontend/authorization.md` の「本当の認可はバックエンド」と一致する。
- **戻り先**: 公式の例は `redirect: location.href` を search に入れ、ログイン後に `router.history.push(search.redirect)` する。公式は戻り先の検証に触れていない。OWASP は、利用者の入力をそのまま遷移先にせず、検証するか、ローカルの URL だけを許すよう勧める。したがって、`/login` の `validateSearch` で同じオリジンの path だけを通すのは、OWASP に沿った自前の検証になる（判断）。
- **認証状態の渡し方**: 公式は 2 通りを示す。React の context / hook の値を `RouterProvider` の `context` で渡す形と、`beforeLoad` が直接 session を問い合わせる形（`verifySession()`）。このリポジトリの方式 2（Cookie の BFF、`GET /api/me` が 401 か本人）には、後者が合う（判断）。
- **ナビゲーション部品**: shadcn/ui の base 版（Base UI）には `NavigationMenu`、`Sidebar`、`DropdownMenu` がある。Base UI は `NavigationMenu`（サイトの link の集まり）と `Menu`（操作の一覧）を別の部品にしている。W3C の APG は、サイトのナビゲーションに `menu` の role を使わない。
- **ログアウト**: Better Auth の `signOut({ disableRedirect: true })` は、`url`（IdP の `end_session_endpoint`）を返す。画面は `window.location.assign(url)` で IdP に移る。`callbackURL` は IdP に post-logout redirect URI として登録しておく必要がある。

## 1. TanStack Router の認証ガード

出典: [Authenticated Routes](https://github.com/TanStack/router/blob/main/docs/router/guide/authenticated-routes.md)、[redirect function](https://github.com/TanStack/router/blob/main/docs/router/api/router/redirectFunction.md)。

### 確かめた事実

- `beforeLoad` は route の読み込み前に呼ばれる。順序は、route の照合（`params.parse`、`validateSearch`）、`beforeLoad`、`onError`、そのあとに component の preload と loader。
- 親の `beforeLoad` は、子の `beforeLoad` より先に呼ばれる。親が throw すると、子は読み込まれない。公式は「その route と子すべての middleware」と書く。
- 未認証なら `beforeLoad` から `throw redirect({ to: '/login', search: { redirect: location.href } })`。公式は、戻り先に `router.state.resolvedLocation` を使わず、`beforeLoad` の引数の `location` を使うよう注意する（`resolvedLocation` は実際の位置より遅れうる）。
- ログイン後は `router.history.push(search.redirect)`。公式は、URL 全体を置き換えるので `router.navigate` より `history.push` が向くと書く。
- 認証の確認が例外を投げうる場合（ネットワーク失敗など）は、try/catch で囲み、`isRedirect(error)` なら再 throw し、それ以外は `/login` へ redirect する形を示す。
- 保護を一括にするには、pathless layout route か layout route を使う。公式は「この方法は pathless / layout route と合わせて、親の下の全 route を保護できる」と書く。
- redirect しない方式もある。同じ URL のまま `<Outlet />` の代わりにログインフォームを出す。
- `redirect()` は `navigate` と同じ option を取る（`replace: true` など）。外部の URL には `href` を使う。
- 認証状態が React の context や hook にあるときは、`createRootRouteWithContext` と `RouterProvider` の `context` prop で渡す。hook は `beforeLoad` の中では使えない。
- 公式は、route のガードを「データの認可の境界」と見なさないよう、冒頭の注意書きで明示する。

### このリポジトリの現状（確かめた）

- `apps/web/src/main.tsx` は `createRouter({ routeTree })` で context を渡していない。routes は `__root.tsx` と `index.tsx` だけ。
- API は `GET /api/me`（`requireSession()`）で、未認証は 401（`apps/api/src/auth/logout.test.ts` が確かめている）。

### 決めるべき論点（判断はしていない）

| 論点             | 選択肢                                                                                                                                           | 出典との関係                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 認証状態の持ち方 | (a) `beforeLoad` が毎回 `GET /api/me` を呼ぶ。(b) 呼んだ結果を router context に載せる（`router.invalidate()` で更新）。(c) React context で渡す | 公式の例は (a) 相当の `verifySession()` と (c) の両方。どちらも標準                                                   |
| 保護する範囲     | pathless layout route `_authenticated` の下に置く。`/login` は外に置く                                                                           | 公式の標準の形                                                                                                        |
| 戻り先           | search の `redirect` に path を入れる。同じオリジンの path に限る                                                                                | 検証は公式にない。OWASP が検証を勧める                                                                                |
| 通信失敗時       | `/login` に飛ばす（公式の例）か、エラー画面を出すか                                                                                              | 公式の例は `/login`。画面の決定は [地図](https://github.com/yokozi-jp/agent-software-factory/issues/396) の別チケット |
| 403 / 404 の画面 | `notFound()` を `beforeLoad` か `loader` で throw し、`notFoundComponent` で受ける                                                               | [Not Found Errors](https://github.com/TanStack/router/blob/main/docs/router/guide/not-found-errors.md)                |

### 戻り先の検証について

- OWASP の [Unvalidated Redirects and Forwards Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html) は、遷移先に利用者の入力を使わないか、使うなら検証し、ローカルの戻り先にはローカルの URL だけを許す補助関数を使うよう勧める。外部の遷移先は、解析した URL の scheme、host、port を allowlist と比べる。接頭辞や接尾辞の文字列照合は使わない。
- TanStack の公式は戻り先の検証を書いていない（上の 2 つの文書と `setup-authentication` の how-to を読んだ範囲）。
- 判断（案）: `/login` の `validateSearch` で `redirect` を、`/` で始まり `//` や `\` で始まらず、`new URL(value, origin).origin === origin` となる値だけに絞る。それ以外は捨てて `/` にする。`validateSearch` は不正な search に既定値を返す使い方が公式に書かれている（[Search Params](https://github.com/TanStack/router/blob/main/docs/router/guide/search-params.md)）。

## 2. ナビゲーション部品（shadcn/ui と Base UI）

出典: shadcn/ui の base 版の docs（[navigation-menu](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/components/base/navigation-menu.mdx)、[sidebar](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/components/base/sidebar.mdx)、[dropdown-menu](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/components/base/dropdown-menu.mdx)、[sidebar.tsx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/sidebar.tsx)）、Base UI の docs（[Navigation Menu](https://base-ui.com/react/components/navigation-menu)、[Menu](https://base-ui.com/react/components/menu)）、W3C の [APG Disclosure Navigation Menu](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/)。

### 確かめた事実

| 部品                     | 何か                                                                                                                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shadcn `NavigationMenu`  | Base UI の `NavigationMenu` の薄い包み。`List`、`Item`、`Trigger`、`Content`、`Link`、`Indicator`。docs の説明は「サイトを移動する link の集まり」                                                                                                                         |
| shadcn `Sidebar`         | `SidebarProvider`、`Sidebar`、`SidebarHeader/Content/Footer`、`SidebarGroup`、`SidebarMenu`、`SidebarMenuButton`。`collapsible` は `offcanvas` / `icon` / `none`。モバイルでは Sheet で出る（`sidebar.tsx` が `Sheet` と `useIsMobile` を使う）。`ctrl+b` / `cmd+b` で開閉 |
| shadcn `DropdownMenu`    | Base UI の `Menu` の包み。「ボタンで開く、操作の一覧」。`DropdownMenuTrigger render={<Button />}` の形                                                                                                                                                                     |
| Base UI `NavigationMenu` | 「link とメニューの集まり」。`NavigationMenu.Link` に `active`（現在のページか）の prop がある                                                                                                                                                                             |
| Base UI `Menu`           | 「操作の一覧」。`Menu.LinkItem href=...` で link の項目を作れる。`closeOnClick` で項目を押したときに閉じるかを選ぶ                                                                                                                                                         |
| 他の部品への合成         | shadcn も Base UI も `render` prop で別の link component に差し替える（shadcn の docs は Next.js の `Link` の例）。TanStack の `Link` も同じ形で合成できる                                                                                                                 |

- shadcn の `SidebarMenuButton` は `render={<a href=... />}` と `isActive` で link とアクティブ状態を作る（sidebar の docs の例）。
- shadcn の `Sidebar` は開閉の状態を `sidebar_state` という Cookie に `document.cookie` で書く（`sidebar.tsx`、max-age 7 日）。HttpOnly ではない。ADR 0022 のログアウトの `Clear-Site-Data: "cookies"` は、この Cookie も消す。
- APG は、サイトのナビゲーションに `menu` の role を使わない。理由は、`menu` の role が支援技術に複雑な操作（矢印キーでの移動など）を期待させるため。APG の例は、現在のページの link に `aria-current="page"` を付ける。
- TanStack Router の `Link` は、現在の位置と合うとき `data-status="active"` を付け、`activeProps` と `activeOptions`（`exact` など）で状態を指定できる（[Navigation](https://github.com/TanStack/router/blob/main/docs/router/guide/navigation.md)）。

### 確かめていない点

- `packages/ui` には今 `button` と `dialog` しかない（確かめた）。`navigation-menu`、`sidebar`、`dropdown-menu` を ADR 0034 の置き方で足したときの CSP（ADR 0033 の ScrollArea / Select の注意）への影響は、試していない。
- Base UI の `NavigationMenu` の a11y の記述（`aria-current` の扱い、`<nav>` landmark）は、`main` の docs から grep で拾えなかった。`active` の prop の説明だけを確かめた。
- shadcn の `Sidebar` と TanStack の `Link` を `render` で合成したときの動作は、試していない。

### 決めるべき論点（判断はしていない）

| 論点                         | 選択肢                                                                                | 材料                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 外枠の形                     | 上のヘッダー（`NavigationMenu` または素の `<nav>` + link）か、左の `Sidebar`          | 項目が少ないうちはヘッダー、多く入れ子になるなら Sidebar。項目数は [地図](https://github.com/yokozi-jp/agent-software-factory/issues/396) の別チケットで決まる |
| ユーザー（氏名、ログアウト） | `DropdownMenu`（操作の一覧）。ナビゲーションの link とは別の部品にする                | Base UI が `Menu` と `NavigationMenu` を分けている                                                                                                             |
| 項目の組み立て               | `packages/ui` は外枠だけ、項目は `apps/web` が渡す（ADR 0034）                        | shadcn の部品は props / children で項目を受ける形で、経費精算の語を持たない                                                                                    |
| 現在のページの表示           | TanStack `Link` の `activeProps` / `data-status` と、`aria-current="page"` を合わせる | APG の例                                                                                                                                                       |

## 3. ログアウトの 4 動作を画面側からつなぐ

出典: [Better Auth のドキュメント](https://github.com/better-auth/better-auth/blob/main/docs/content/docs)（`basic-usage.mdx`、`plugins/generic-oauth.mdx`）、[OIDC RP-Initiated Logout 1.0](https://openid.net/specs/openid-connect-rpinitiated-1_0.html)、[W3C Clear-Site-Data](https://www.w3.org/TR/clear-site-data/)、このリポジトリの `apps/api/src/app.ts` と `apps/api/src/auth/logout.test.ts`。

### 確かめた事実

- Better Auth のクライアントは `authClient.signOut()`。`fetchOptions.onSuccess` で遷移を足せる（`basic-usage`）。
- OIDC の provider が `end_session_endpoint` を持つとき、`signOut()` は Better Auth の session を消してから、ブラウザを provider のログアウトに向ける。`discoveryUrl` を使うと、endpoint は discovery document から読む。手で `endSessionEndpoint` も指定できる（`generic-oauth`）。
- `callbackURL` を渡すと、provider がログアウト後に利用者をアプリへ戻す。その URL は provider に post-logout redirect URI として登録しておく必要がある（同）。
- 自分で遷移するときは `disableRedirect: true` にして、返る `url` に `window.location.assign(url)` する（同）。
- 複数の provider がある場合、最後に更新した account の provider へだけ遷移できる（同）。このリポジトリの IdP は 1 つ（ADR 0022）。
- provider のログアウトを切る設定もある（同）。ADR 0022 は IdP のログアウトを行うので、使わない。
- OIDC RP-Initiated Logout は、`post_logout_redirect_uri` が OP に事前に登録された値でなければならないとし、`id_token_hint` を使う。
- このリポジトリの API は `POST /api/auth/sign-out` の成功時（`c.res.ok`）にだけ `Clear-Site-Data: "cache", "cookies"` を付ける（`app.ts`）。失敗や CSRF の拒否では付けない。テストが、`disableRedirect: true` と `callbackURL: "/"` を送り、応答の `url` に `id_token_hint` が入ることを確かめている（`logout.test.ts`）。
- W3C の仕様では、`Clear-Site-Data` は fetch の応答にも作用する。`"cookies"` は、その応答の origin の Cookie を消す（HttpOnly の Cookie も消せるのが、この header の動機として書かれている）。`"cache"` は、その origin のブラウザの cache を消す。

### 画面側の流れ（案、判断）

1. ログアウトのボタン（`DropdownMenuItem` など）が `fetch` で `signOut({ disableRedirect: true, callbackURL: "/login" })` を呼ぶ。CSRF の検査のため、`Origin` と `Content-Type: application/json` は同じオリジンの `fetch` が付ける。
2. 成功したら、応答の `Clear-Site-Data` がブラウザの Cookie と cache を消し、`session` の行も API 側で消えている（動作 1〜3）。
3. 応答に `url` があれば `window.location.assign(url)` で IdP に移る（動作 4）。IdP が `callbackURL` に戻す。`url` がなければ（IdP が `end_session_endpoint` を持たない）、`/login` へ遷移する。
4. 画面に残る React の状態や router の cache は、フルページの遷移（`assign`）で捨てられる。`/login` への `router.navigate` だけで済ませるときは、`router.invalidate()` が要る（`invalidate` は読み込み済みの match を再実行する。`RouterType.md`）。
5. `/login` で、戻ってきた利用者に「ログアウトしました」と出すかは、画面の決定（地図の別チケット）。

### 確かめていない点

- `"cache"` の効果が、`bfcache`（戻るボタンで復元される前のページ）にどう効くかは、仕様の記述を拾いきれていない。ログアウト後に戻るボタンで保護された画面が見えるかは、ブラウザで試す必要がある。
- Keycloak で `post_logout_redirect_uri`（`/login`）を client に登録する設定と、Cognito / Entra ID で同じことができるかは、確かめていない。Cognito のログアウトの endpoint は、標準の `end_session_endpoint` と引数が違うと記憶しているが、一次資料では確かめていない。Better Auth の `endSessionEndpoint` で吸収できるかも未確認。
- `callbackURL` が API 側でどう検証されるか（Better Auth の `trustedOrigins` との関係）は読んでいない。
- `Clear-Site-Data` が付く応答を `fetch` で受けて、その直後に `assign` する間の挙動（競合）は、試していない。
- 画面の `signOut` がログアウトを失敗したときの表示（API は失敗時に `Clear-Site-Data` を付けない）は、画面の決定になる。

### 決めるべき論点（判断はしていない）

| 論点                                         | 選択肢                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| ログアウトの遷移先                           | `callbackURL` を `/login` にするか `/` にするか。`/` は未認証なので `beforeLoad` が `/login` に飛ばす |
| ログアウトの操作                             | 確認のダイアログ（Base UI の `AlertDialog`）を挟むか、すぐ実行するか                                  |
| 画面の状態の捨て方                           | `window.location.assign` のフル遷移に任せるか、`router.invalidate()` を使うか                         |
| IdP が `end_session_endpoint` を持たないとき | `/login` へ遷移するだけにするか、案件ごとの設定にするか                                               |

## 公式と `docs/` の食い違い

- `docs/web-frontend/auth.md` と `authorization.md` は、TanStack Router の標準的な書き方と矛盾しない。`authorization.md` の「画面のアクセス制御は navigation guard で一元的に」は、公式の pathless layout route の `beforeLoad` に当たる。
- `authorization.md` は「セッション / Cookie ベースの認証では、認証後にフロントエンドからバックエンドに問い合わせてパーミッションを取得せざるを得ない」と書く。このリポジトリでは `GET /api/me` が id、email、name だけを返す（確かめた）ので、役割を返す形に広げるかは [役割ごとの出し分け](https://github.com/yokozi-jp/agent-software-factory/issues/400) の決定になる。
- 食い違いは見つからなかったので、`docs/` は直していない。
