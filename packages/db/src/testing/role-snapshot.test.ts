import { describe, expect, it } from "vite-plus/test";

import { rolledBackPerTest } from "./rolled-back.ts";
import { diffRoles, snapshotRoles } from "./role-snapshot.ts";

describe("snapshotRoles", () => {
  const db = rolledBackPerTest();

  it("ロールの属性とメンバーシップを読み、システムのロールは含めないこと", async () => {
    const lines = await snapshotRoles(db.superuser);

    expect(lines).toContainEqual(expect.stringMatching(/^app_user super=f .* login=t /));
    expect(lines).toContainEqual("app_user は claim_module のメンバー inherit=f set=t admin=f");
    expect(lines.filter((line) => line.startsWith("pg_"))).toEqual([]);
  });

  it("ロールを変えると、その差が見つかること", async () => {
    const before = await snapshotRoles(db.superuser);
    await db.superuser.query(`ALTER ROLE app_user CREATEROLE`);
    await db.superuser.query(`GRANT migrator TO app_user`);

    const changes = diffRoles(before, await snapshotRoles(db.superuser));

    expect(changes).toHaveLength(3);
    expect(changes).toContainEqual(expect.stringMatching(/^- app_user .* createrole=f /));
    expect(changes).toContainEqual(expect.stringMatching(/^\+ app_user .* createrole=t /));
    expect(changes).toContainEqual(expect.stringMatching(/^\+ app_user は migrator のメンバー /));
  });
});

describe("diffRoles", () => {
  it("同じ状態なら、空を返すこと", () => {
    expect(diffRoles(["a", "b"], ["b", "a"])).toEqual([]);
  });
});
