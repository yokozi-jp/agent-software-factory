import { startTestIdp } from "./oidc-provider.ts";
import { users } from "./credentials.ts";

// 手で動かすための IdP の入口 (docs/tooling/local-api.md)。結合テストと同じ node-oidc-provider の実装を、
// 固定のポートと、web の開発サーバー (vp dev) の origin で起動する。止めるのは Ctrl-C。
// 既定の値は apps/api/.env.example の OIDC_DISCOVERY_URL と PUBLIC_ORIGIN に合わせてある。変えるときは環境変数で渡し、.env も合わせる。
const port = Number(process.env["IDP_PORT"] ?? 9000);
const appOrigin = process.env["IDP_APP_ORIGIN"] ?? "http://localhost:5173";

const idp = await startTestIdp({ port, appOrigin });
console.log(`IdP listening on ${idp.issuer}`);
console.log(`discovery: ${idp.issuer}/.well-known/openid-configuration`);
// パスワードは出力しない (CodeQL の clear-text logging)。ユーザーとパスワードは docs/tooling/local-api.md にある。
console.log(
  `users: ${Object.values(users)
    .map((user) => user.username)
    .join(", ")}`,
);

for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void idp.stop().finally(() => process.exit(0));
  });
