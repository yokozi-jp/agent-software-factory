---
type: Runbook
title: ローカルで API と web を認証つきで動かす
description: node-oidc-provider の IdP を手で起動し、API (apps/api) を認証つきで起動して、web の開発サーバー経由でブラウザからログインとログアウトを試す手順。認証つきの API を手元で動かしたいとき、ログインの動きを目で確かめたいとき、ローカルの IdP の origin やユーザーを変えるときに読む。
tags: [tooling, runbook, api, auth, oidc, local]
---

# ローカルで API と web を認証つきで動かす

API の `src/server.ts` は、認証の環境変数が足りないと起動しません (fail closed、[ADR 0022](../adr/0022-better-auth-cookie-bff.md))。認証なしで動かすなら `vp dev` を使います。この手順は、認証つきで動かし、ブラウザでログインとログアウトを試すためのものです。
IdP は、結合テストと同じ node-oidc-provider の実装 (`apps/api/test/oidc-provider.ts`) を、固定のポートで起動します。Docker は使いません。

## 用意する

1. PostgreSQL を起動して (`compose.local.yaml` の PostgreSQL 18 が起動しない件は [Issue #531](https://github.com/yokozi-jp/agent-software-factory/issues/531)) migration を流す。手順は[ローカルで通知メールのワーカーを動かす](local-worker.md)の「起動する」と「データベースを用意する」。
2. `apps/api/.env.example` を同じディレクトリの `.env` に写す。値は compose と下の IdP に合わせてある。

## 起動する

端末を 3 つ使います。

```sh
pnpm --filter @agent-software-factory/api dev:idp    # IdP。http://127.0.0.1:9000
pnpm --filter @agent-software-factory/api dev:auth   # API。http://localhost:3000
pnpm --filter @agent-software-factory/web dev        # web。http://localhost:5173
```

ブラウザで <http://localhost:5173> を開きます。web にログインの画面はまだないので、開発者ツールの console から API を呼びます。

```js
// ログイン: 応答の url (IdP の画面) を開き、ユーザー名とパスワードを入れると web に戻る。
const login = await fetch("/api/auth/sign-in/social", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ provider: "oidc", callbackURL: "/" }),
});
location.href = (await login.json()).url;

// ログアウト: 応答の url (IdP の /session/end) を開くと、IdP のセッションも終わる。
const logout = await fetch("/api/auth/sign-out", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
location.href = (await logout.json()).url;
```

| ユーザー | パスワード        | メールアドレス       |
| -------- | ----------------- | -------------------- |
| yamada   | `yamada-password` | `yamada@example.com` |
| sato     | `sato-password`   | `sato@example.com`   |

ユーザーは `apps/api/test/credentials.ts` の 2 人で、結合テストと共通です。ログインのあとに人事システムの確認で止まる場合があります ([Issue #156](https://github.com/yokozi-jp/agent-software-factory/issues/156))。

## 固定した値

| 値                                 | 場所                    | 理由                                                                 |
| ---------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| IdP のポート 9000、アプリの origin | `test/dev-idp.ts`       | 手で使うには、決まったポートと、web の開発サーバーの origin が要る。 |
| client ID `api`、secret            | `test/oidc-provider.ts` | テストと共通。本物の秘密ではない。                                   |
| `PUBLIC_ORIGIN`                    | `.env`                  | `http://localhost:5173`。API (3000) ではなく web の origin にする。  |

`PUBLIC_ORIGIN` を web の origin にする理由: web の開発サーバーは `/api` を API へ転送するので (`apps/web/vite.config.ts`)、ブラウザからは同じ origin に見えます。Cookie の `__Host-` と `SameSite=Strict`、CSRF の `Origin` の検査 ([ADR 0022](../adr/0022-better-auth-cookie-bff.md)) は、この 1 つの origin の上で成り立ちます。API の 3000 番を直接開くと、`PUBLIC_ORIGIN` と違う origin になり、CSRF の検査で 403 になります。
IdP から戻る callback は `http://localhost:5173/api/auth/callback/oidc` です。IdP の origin (127.0.0.1) とアプリの origin (localhost) は別のサイトなので、callback で送られる `state` の Cookie は `SameSite=Lax` です ([ADR 0022](../adr/0022-better-auth-cookie-bff.md) の Cookie の項)。
IdP を `127.0.0.1`、web を `localhost` にしているのは、API が IdP を呼ぶ node の `fetch` で `localhost` が IPv6 (`::1`) に解決されると、`127.0.0.1` だけで待ち受ける IdP に届かないためです (判断。IdP の待ち受けは `test/oidc-provider.ts`)。

## 置き場所

`dev-idp.ts` は `test/` に置きます。IdP はテストの代役で、本番のコードではなく、`oidc-provider` は devDependency です。`src/` に置くと、本番のビルドが devDependency に頼ります。結合テストと同じ `startTestIdp` を呼ぶので、手で見た動きがテストの動きと同じになります (判断)。

## うまくいかないとき

- 起動直後の `Rate limiting could not determine a client IP` の警告は、Better Auth の rate limit が接続元の IP を取れないときの警告 (出所は Better Auth)。ローカルでは 1 人で使うので無視できる (判断)。
- ポート 9000 を別のものが使っている: `apps/api/test/dev-idp.ts` の `port` を変え、`.env` の `OIDC_DISCOVERY_URL` も合わせる。
- `__Host-` の Cookie は `Secure` が要る。ブラウザは `http://localhost` を安全な文脈 (potentially trustworthy origin) として扱う ([MDN: Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts))。この手順の Cookie を実際のブラウザで受け付けるかは、まだ確かめていない ([Issue #532](https://github.com/yokozi-jp/agent-software-factory/issues/532))。

## この手順で確かめていないもの

- 実際のブラウザ (Playwright を含む) でのログインとログアウト。このコミットを書いたときは、Cookie を保持する使い捨ての Node.js のスクリプトで、5173 経由の `sign-in/social`、IdP のログイン、callback、`get-session`、`sign-out` を通した (スクリプトは残していない)。
