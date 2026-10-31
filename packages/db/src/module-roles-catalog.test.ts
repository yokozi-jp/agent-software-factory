import { describe, expect, it } from "vite-plus/test";

import { rolledBackPerTest, type RolledBackQueries } from "./testing/index.ts";
import { checkModuleRoles, type ModuleReads } from "./module-roles-catalog.ts";
import { moduleSchemas } from "./types.ts";

// モジュールのロールと表の所有を DB のカタログで確かめる検査 (docs/adr/0029)。依存の方向は 締め → 承認 → 申請。
const reads: ModuleReads = {
  claim: [],
  approval: ["claim"],
  closing: ["approval", "claim"],
};

describe("checkModuleRoles", () => {
  // 規則を壊すテストは、テストごとのトランザクションの中で壊す。ロールの変更はクラスタ全体に及ぶので、コミットしない (Issue #448)。
  const db = rolledBackPerTest();

  it("migration を流した DB では、問題がないこと", async () => {
    expect(await checkModuleRoles(db.superuser, reads)).toEqual([]);
  });

  it("モジュールの package (type:module) の名前ごとに、依存の方向の表があること", () => {
    // 名前は型の生成 (types.ts) が package.json の tag から読むものと同じ。ここの reads の手書きの写しとずれたら失敗する。
    // ModuleName (shared) の型で結び付けないのは、db が shared に依存しないため (ADR 0038)。
    expect(Object.keys(reads).toSorted()).toEqual([...moduleSchemas].toSorted());
  });

  // 検出力: わざと規則を破った DB で、検査が失敗を返すこと (#30)。DDL は表の所有者の migrator、GRANT などは superuser。
  const breakages: readonly {
    name: string;
    run: (d: RolledBackQueries) => Promise<unknown>;
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
      name: "TRUNCATE の GRANT",
      run: (d) => d.superuser.query(`GRANT TRUNCATE ON claim.t_claim TO approval_module`),
      expected: "approval_module の claim.t_claim の TRUNCATE がある",
    },
    {
      name: "締めの auth.organization への UPDATE の GRANT",
      run: (d) =>
        d.superuser.query(`GRANT UPDATE ("name") ON auth."organization" TO closing_module`),
      expected: "closing_module の auth.organization.name の UPDATE がある",
    },
    {
      name: "モジュールのロールをほかのロールに入れる",
      run: (d) => d.superuser.query(`GRANT migrator TO claim_module WITH INHERIT FALSE, SET TRUE`),
      expected: "claim_module が migrator のメンバー",
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
      name: "app_user を outbox_relay に入れる GRANT",
      run: (d) => d.superuser.query(`GRANT outbox_relay TO app_user`),
      expected: "app_user が outbox_relay のメンバー",
    },
    {
      name: "2 つ目の USING (true) のポリシー",
      run: (d) =>
        d.migrator.query(
          `CREATE POLICY see_all ON messaging.outbox FOR SELECT TO claim_module USING (true)`,
        ),
      expected: "messaging.outbox のポリシー see_all が app.current_tenant で比べていない",
    },
    {
      name: "テナントの比較に OR true を足したポリシー",
      run: (d) =>
        d.migrator.query(
          `DROP POLICY tenant_insert ON messaging.outbox;
           CREATE POLICY tenant_insert ON messaging.outbox FOR INSERT TO claim_module
             WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid OR true)`,
        ),
      expected: "messaging.outbox のポリシー tenant_insert が app.current_tenant で比べていない",
    },
    {
      name: "別の表の USING (true) のポリシー",
      run: (d) =>
        d.migrator.query(
          `CREATE POLICY see_all ON claim.t_claim FOR SELECT TO claim_module USING (true)`,
        ),
      expected: "claim.t_claim のポリシー see_all が app.current_tenant で比べていない",
    },
    {
      name: "outbox_relay 向けのポリシーの欠け",
      run: (d) => d.migrator.query(`DROP POLICY relay_all_tenants ON messaging.outbox`),
      expected: "messaging.outbox に outbox_relay 向けの USING (true) のポリシーが 1 つない",
    },
    {
      name: "Outbox の RLS の FORCE の欠け",
      run: (d) => d.migrator.query(`ALTER TABLE messaging.outbox NO FORCE ROW LEVEL SECURITY`),
      expected: "messaging.outbox が RLS を FORCE にしていない",
    },
    {
      name: "モジュールのロールの Outbox の SELECT",
      run: (d) => d.superuser.query(`GRANT SELECT ON messaging.outbox TO claim_module`),
      expected: "claim_module の messaging.outbox の SELECT がある",
    },
    {
      name: "モジュールのロールの Outbox の列だけの SELECT",
      run: (d) => d.superuser.query(`GRANT SELECT ("id") ON messaging.outbox TO claim_module`),
      expected: "claim_module の messaging.outbox の SELECT がある",
    },
    {
      name: "モジュールのロールの Outbox の INSERT の欠け",
      run: (d) => d.superuser.query(`REVOKE INSERT ON messaging.outbox FROM closing_module`),
      expected: "closing_module の messaging.outbox の INSERT がない",
    },
    {
      name: "app_user の Outbox への INSERT",
      run: (d) => d.superuser.query(`GRANT INSERT ON messaging.outbox TO app_user`),
      expected: "app_user の messaging.outbox の INSERT がある",
    },
    {
      name: "outbox_relay の Outbox の DELETE の欠け",
      run: (d) => d.superuser.query(`REVOKE DELETE ON messaging.outbox FROM outbox_relay`),
      expected: "outbox_relay の messaging.outbox の DELETE がない",
    },
    {
      name: "outbox_relay の Outbox への INSERT",
      run: (d) => d.superuser.query(`GRANT INSERT ON messaging.outbox TO outbox_relay`),
      expected: "outbox_relay の messaging.outbox の INSERT がある",
    },
    {
      name: "outbox_relay のモジュールの表の SELECT",
      run: (d) =>
        d.superuser.query(
          `GRANT USAGE ON SCHEMA claim TO outbox_relay; GRANT SELECT ON claim.t_claim TO outbox_relay`,
        ),
      expected: "outbox_relay の claim.t_claim の SELECT がある",
    },
    {
      name: "outbox_relay の BYPASSRLS",
      run: (d) => d.superuser.query(`ALTER ROLE outbox_relay BYPASSRLS`),
      expected: "ロール outbox_relay が BYPASSRLS",
    },
    {
      name: "outbox_relay の LOGIN の欠け",
      run: (d) => d.superuser.query(`ALTER ROLE outbox_relay NOLOGIN`),
      expected: "ロール outbox_relay が LOGIN できない",
    },
    {
      name: "outbox_relay の superuser",
      run: (d) => d.superuser.query(`ALTER ROLE outbox_relay SUPERUSER`),
      expected: "ロール outbox_relay が superuser",
    },
    {
      name: "outbox_relay の CREATEROLE",
      run: (d) => d.superuser.query(`ALTER ROLE outbox_relay CREATEROLE`),
      expected: "ロール outbox_relay が CREATEROLE",
    },
    {
      name: "outbox_relay の CREATEDB",
      run: (d) => d.superuser.query(`ALTER ROLE outbox_relay CREATEDB`),
      expected: "ロール outbox_relay が CREATEDB",
    },
    {
      name: "Outbox の RLS の ENABLE の欠け",
      run: (d) => d.migrator.query(`ALTER TABLE messaging.outbox DISABLE ROW LEVEL SECURITY`),
      expected: "messaging.outbox が RLS を ENABLE にしていない",
    },
    {
      name: "outbox_relay の messaging スキーマの USAGE の欠け",
      run: (d) => d.superuser.query(`REVOKE USAGE ON SCHEMA messaging FROM outbox_relay`),
      expected: "outbox_relay の messaging スキーマの USAGE がない",
    },
    {
      name: "app_user の messaging スキーマの USAGE",
      run: (d) => d.superuser.query(`GRANT USAGE ON SCHEMA messaging TO app_user`),
      expected: "app_user の messaging スキーマの USAGE がある",
    },
    {
      name: "messaging スキーマへの CREATE の GRANT",
      run: (d) => d.superuser.query(`GRANT CREATE ON SCHEMA messaging TO claim_module`),
      expected: "claim_module が messaging スキーマに CREATE できる",
    },
    {
      name: "outbox_relay の public の表の SELECT",
      run: (d) =>
        d.superuser.query(
          `CREATE TABLE public.t_leak (id int); GRANT SELECT ON public.t_leak TO outbox_relay`,
        ),
      expected: "outbox_relay の public.t_leak の SELECT がある",
    },
    {
      name: "outbox_relay のポリシーの式が true でない",
      run: (d) =>
        d.migrator.query(
          `DROP POLICY relay_all_tenants ON messaging.outbox;
           CREATE POLICY relay_all_tenants ON messaging.outbox FOR ALL TO outbox_relay USING (id IS NOT NULL)`,
        ),
      expected:
        "messaging.outbox のポリシー relay_all_tenants が app.current_tenant で比べていない",
    },
    {
      name: "outbox_relay をほかのロールに入れる",
      run: (d) => d.superuser.query(`GRANT migrator TO outbox_relay`),
      expected: "outbox_relay が migrator のメンバー",
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

  it("outbox_relay のロールか Outbox の表がなければ、その失敗だけを返すこと", async () => {
    await db.superuser.query(`ALTER ROLE outbox_relay RENAME TO outbox_relay_moved`);
    expect(await checkModuleRoles(db.superuser, reads)).toContain("ロール outbox_relay がない");
    await db.superuser.query(`ALTER ROLE outbox_relay_moved RENAME TO outbox_relay`);

    await db.migrator.query(`DROP TABLE messaging.outbox`);

    expect(await checkModuleRoles(db.superuser, reads)).toEqual(["表 messaging.outbox がない"]);
  });

  it("ロールかスキーマがなければ、その失敗を返すこと", async () => {
    const failures = await checkModuleRoles(db.superuser, { ...reads, ghost: [] });

    expect(failures).toEqual(["ロール ghost_module がない", "スキーマ ghost がない"]);
  });
});
