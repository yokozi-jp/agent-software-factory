// テスト用の認証情報。Keycloak の realm (keycloak/factory-realm.json) と同じ値にする。
// 本物の秘密情報ではない。betterleaks が拾うので、行ごとに許可の印を付ける。

export const users = {
  yamada: { username: "yamada", password: "yamada-password", email: "yamada@example.com" }, // betterleaks:allow
  sato: { username: "sato", password: "sato-password", email: "sato@example.com" }, // betterleaks:allow
} as const;

export const rolePassword = "test-role-password"; // betterleaks:allow
