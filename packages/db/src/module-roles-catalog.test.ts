import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createTestDatabase, type TestDatabase } from "./testing/index.ts";
import { checkModuleRoles, type ModuleReads } from "./module-roles-catalog.ts";

// モジュールのロールと表の所有を DB のカタログで確かめる検査 (docs/adr/0029)。依存の方向は 締め → 承認 → 申請。
const reads: ModuleReads = {
  claim: [],
  approval: ["claim"],
  closing: ["approval", "claim"],
};

describe("checkModuleRoles", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  afterEach(async () => {
    // ロールの属性とメンバーシップはクラスタ全体のもので、複製した DB に閉じない。壊した検出力のテストの後に戻す。
    await db.superuser.query(
      `ALTER ROLE claim_module NOLOGIN NOSUPERUSER NOBYPASSRLS;
       GRANT claim_module TO app_user WITH INHERIT FALSE, SET TRUE`,
    );
    await db.close();
  });

  it("migration を流した DB では、問題がないこと", async () => {
    expect(await checkModuleRoles(db.superuser, reads)).toEqual([]);
  });

  it("モジュールの package (type:module) の名前ごとに、スキーマとロールがあること", () => {
    const packages = join(import.meta.dirname, "../..");
    const names = readdirSync(packages).filter((name) => {
      try {
        return readFileSync(join(packages, name, "package.json"), "utf8").includes('"type:module"');
      } catch {
        return false;
      }
    });

    expect(names.toSorted()).toEqual(Object.keys(reads).toSorted());
  });

  // 検出力: わざと規則を破った DB で、検査が失敗を返すこと (#30)。DDL は表の所有者の migrator、GRANT などは superuser。
  const breakages: readonly {
    name: string;
    run: (db: TestDatabase) => Promise<unknown>;
    expected: string;
  }[] = [
    {
      name: "モジュールのロールの superuser",
      run: (d) => d.superuser.query(`ALTER ROLE claim_module SUPERUSER`),
      expected: "ロール claim_module が superuser",
    },
    {
      name: "スキーマへの CREATE の GRANT",
      run: (d) => d.superuser.query(`GRANT CREATE ON SCHEMA claim TO claim_module`),
      expected: "claim_module が claim スキーマに CREATE できる",
    },
    {
      name: "自分のスキーマの USAGE の欠け",
      run: (d) => d.superuser.query(`REVOKE USAGE ON SCHEMA claim FROM claim_module`),
      expected: "claim_module の claim スキーマの USAGE がない",
    },
    {
      name: "自分の表の権限の欠け",
      run: (d) => d.superuser.query(`REVOKE UPDATE ON claim.t_claim FROM claim_module`),
      expected: "claim_module の claim.t_claim の UPDATE がない",
    },
    {
      name: "締めの auth.organization.id の SELECT の欠け",
      run: (d) =>
        d.superuser.query(`REVOKE SELECT ("id") ON auth."organization" FROM closing_module`),
      expected: "closing_module の auth.organization.id の SELECT がない",
    },
    {
      name: "締めの auth の USAGE の欠け",
      run: (d) => d.superuser.query(`REVOKE USAGE ON SCHEMA auth FROM closing_module`),
      expected: "closing_module の auth スキーマの USAGE がない",
    },
    {
      name: "ほかのスキーマへの GRANT",
      run: (d) => d.superuser.query(`GRANT USAGE ON SCHEMA approval TO claim_module`),
      expected: "claim_module の approval スキーマの USAGE がある",
    },
    {
      name: "ほかのモジュールの表への書き込みの GRANT",
      run: (d) => d.superuser.query(`GRANT INSERT ON claim.t_claim TO approval_module`),
      expected: "approval_module の claim.t_claim の INSERT がある",
    },
    {
      name: "方向に逆らう読み取りの GRANT",
      run: (d) =>
        d.superuser.query(
          `GRANT USAGE ON SCHEMA closing TO claim_module; GRANT SELECT ON ALL TABLES IN SCHEMA closing TO claim_module`,
        ),
      expected: "claim_module の closing スキーマの USAGE がある",
    },
    {
      name: "app_user への表の権限",
      run: (d) => d.superuser.query(`GRANT SELECT ON claim.t_claim TO app_user`),
      expected: "app_user の claim.t_claim の SELECT がある",
    },
    {
      name: "INHERIT TRUE",
      run: (d) => d.superuser.query(`GRANT claim_module TO app_user WITH INHERIT TRUE`),
      expected: "app_user が claim_module に INHERIT FALSE、SET TRUE で入っていない",
    },
    {
      name: "モジュールのロールの LOGIN",
      run: (d) => d.superuser.query(`ALTER ROLE claim_module LOGIN`),
      expected: "ロール claim_module が LOGIN できる",
    },
    {
      name: "モジュールのロールの BYPASSRLS",
      run: (d) => d.superuser.query(`ALTER ROLE claim_module BYPASSRLS`),
      expected: "ロール claim_module が BYPASSRLS",
    },
    {
      name: "締めの auth の ほかの列の SELECT",
      run: (d) =>
        d.superuser.query(`GRANT SELECT ("name") ON auth."organization" TO closing_module`),
      expected: "closing_module の auth.organization.name の SELECT がある",
    },
    {
      name: "申請のロールの auth の USAGE",
      run: (d) => d.superuser.query(`GRANT USAGE ON SCHEMA auth TO claim_module`),
      expected: "claim_module の auth スキーマの USAGE がある",
    },
    {
      name: "SECURITY DEFINER の関数",
      run: (d) =>
        d.migrator.query(
          `CREATE FUNCTION claim.leak() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`,
        ),
      expected: "claim.leak が SECURITY DEFINER の関数",
    },
    {
      name: "所有者の権限で動く view",
      run: (d) =>
        d.migrator.query(`CREATE VIEW claim.v_claim AS SELECT claim_id FROM claim.t_claim`),
      expected: "claim.v_claim が所有者の権限で動く view",
    },
    {
      name: "スキーマをまたぐ外部キー",
      run: (d) =>
        d.migrator.query(
          `CREATE TABLE approval.t_approval (
             tenant_id uuid NOT NULL, claim_id bigint NOT NULL,
             FOREIGN KEY (tenant_id, claim_id) REFERENCES claim.t_claim (tenant_id, claim_id))`,
        ),
      expected: "から claim をまたいでいる",
    },
  ];

  it.each(breakages)("$name を見つけること", async ({ run, expected }) => {
    await run(db);

    const failures = await checkModuleRoles(db.superuser, reads);

    expect(failures.join("\n")).toContain(expected);
  });

  it("security_invoker の view は許すこと", async () => {
    await db.migrator.query(
      `CREATE VIEW claim.v_claim WITH (security_invoker = true) AS SELECT claim_id FROM claim.t_claim`,
    );

    expect(await checkModuleRoles(db.superuser, reads)).toEqual([]);
  });

  it("ロールかスキーマがなければ、その失敗を返すこと", async () => {
    const failures = await checkModuleRoles(db.superuser, { ...reads, ghost: [] });

    expect(failures).toEqual(["ロール ghost_module がない", "スキーマ ghost がない"]);
  });
});
