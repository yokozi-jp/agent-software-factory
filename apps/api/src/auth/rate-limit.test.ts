import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { appOrigin, createAuthFixture, type AuthFixture } from "../../test/auth-fixtures.ts";
import type { ServerProcess } from "../../test/server-process.ts";
import { oidcProviderId } from "./auth.ts";

// Better Auth の rate limit を、API のインスタンスをまたいで数える (#236)。
// API は ECS の複数のタスクと Lambda の複数の実行環境で動く (docs/adr/0013)。保存先がメモリだと、
// インスタンスごとに別々に数えるので、インスタンスの数だけ上限を超えて通る。
//
// サインインの上限は、Better Auth の既定 (/sign-in で始まる経路は 10 秒に 3 回)。
// 4 回を 2 つのインスタンスに交互に送るので、1 つのインスタンスは 2 回しか受けず、上限に届かない。
describe("サインインの rate limit (#236)", () => {
  let fixture: AuthFixture;
  let other: ServerProcess;

  beforeAll(async () => {
    fixture = await createAuthFixture({ rateLimit: true });
    // もう 1 つのインスタンスは別のプロセスにする。Better Auth のメモリの保存先は module の変数で、
    // 同じプロセスの 2 つの認証は、メモリでも同じ数を共有してしまうため。
    other = await fixture.startInstance();
  });

  afterAll(async () => {
    await fixture.close();
  });

  const signIn: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: appOrigin,
      // 2 つのインスタンスが同じ利用者の要求と見るように、利用者の IP を明示する。
      // Better Auth は、x-forwarded-for が 1 つの値だけのときにそれを使う。
      "x-forwarded-for": "203.0.113.7",
    },
    body: JSON.stringify({ provider: oidcProviderId, callbackURL: "/" }),
  };

  it("2 つのインスタンスで合わせた回数が上限を超えたら 429 を返すこと", async () => {
    const path = "/api/auth/sign-in/social";

    const statuses: number[] = [];
    for (let round = 0; round < 2; round += 1) {
      statuses.push((await fixture.app.request(path, signIn)).status);
      statuses.push((await other.request(path, signIn)).status);
    }

    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});
