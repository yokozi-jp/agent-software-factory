// テスト用 IdP (oidc-provider.ts) のユーザー。
// 本物の秘密情報ではない。betterleaks が拾うので、行ごとに許可の印を付ける。
// DB のロールのパスワードは packages/db の testing にある (docs/adr/0038)。

export const users = {
  yamada: { username: "yamada", password: "yamada-password", email: "yamada@example.com" }, // betterleaks:allow
  sato: { username: "sato", password: "sato-password", email: "sato@example.com" }, // betterleaks:allow
} as const;
