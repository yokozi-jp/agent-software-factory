import { startTestIdp } from "./oidc-provider.ts";
import { users } from "./credentials.ts";

// 手で動かすための IdP の入口 (docs/tooling/local-api.md)。結合テストと同じ node-oidc-provider の実装を、
// 固定のポートと、web の開発サーバー (vp dev) の origin で起動する。止めるのは Ctrl-C。
const port = 9000;
const appOrigin = "http://localhost:5173";

const idp = await startTestIdp({ port, appOrigin });
console.log(`IdP listening on ${idp.issuer}`);
console.log(`discovery: ${idp.issuer}/.well-known/openid-configuration`);
for (const user of Object.values(users))
  console.log(`user: ${user.username} / ${user.password} (${user.email})`);

for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void idp.stop().finally(() => process.exit(0));
  });
