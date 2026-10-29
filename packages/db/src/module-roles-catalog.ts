import type { Pool } from "pg";

/** モジュールの名前と、そのモジュールが読んでよいモジュール (依存の方向。締め → 承認 → 申請) (docs/adr/0029)。 */
export type ModuleReads = Readonly<Record<string, readonly string[]>>;

// モジュールのロールが持ってよいのは、自分のスキーマの読み書き (ownPrivileges) と、依存の方向の SELECT だけ。
// TRUNCATE は RLS を迂回して全テナントの行を消せるので、DELETE と同じ重さで見る。
const ownPrivileges = ["SELECT", "INSERT", "UPDATE", "DELETE"];
const tablePrivileges = [...ownPrivileges, "TRUNCATE", "REFERENCES", "TRIGGER"];
const columnPrivileges = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];

/** 締めのバッチがテナントの一覧を読むために、列を限って権限を持つ表と列 (docs/adr/0022 の例外)。 */
const tenantList = { role: "closing_module", schema: "auth", table: "organization", column: "id" };

const roleOf = (module: string) => `${module}_module`;

/**
 * モジュールのロールと表の所有が、決めたとおりの形かを DB のカタログから確かめる (docs/adr/0029)。
 * 決めたとおりでない点を、文の一覧で返す。空なら問題がない。
 *
 * 確かめること:
 * - ロールは NOLOGIN で、superuser でも BYPASSRLS でもない。`app_user` が INHERIT FALSE、SET TRUE で入っている。
 * - 権限は、自分のスキーマの読み書きと、依存の方向のスキーマの SELECT だけ (TRUNCATE、REFERENCES、TRIGGER もない)。
 *   ほかのスキーマには USAGE もない。シーケンスと関数の EXECUTE は、まだ見ない (今はどちらもない)。
 * - `app_user` はモジュールのスキーマに権限を持たない。モジュールのロールはほかのロールのメンバーにならない。
 * - 締めのロールの `auth` の権限は、`auth.organization` の `id` の SELECT だけ。ほかのロールは `auth` に権限がない。
 * - モジュールのスキーマに、所有者の権限で動く view と `SECURITY DEFINER` の関数、スキーマをまたぐ外部キーがない。
 *
 * `messaging.outbox` の INSERT は、表を作る Issue #269 で足す。
 *
 * この検査はテスト専用で、migrate や CI の別の段からは呼ばない。migration を流した DB に対する結合テスト
 * (module-roles-catalog.test.ts) が、毎回これを呼んで問題が空であることを確かめる。
 */
export async function checkModuleRoles(pool: Pool, reads: ModuleReads): Promise<string[]> {
  const modules = Object.keys(reads);
  const roles = modules.map(roleOf);
  const failures: string[] = [];

  const { rows: roleRows } = await pool.query<{
    rolname: string;
    rolcanlogin: boolean;
    rolsuper: boolean;
    rolbypassrls: boolean;
    inherit_option: boolean | null;
    set_option: boolean | null;
  }>(
    `SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls, m.inherit_option, m.set_option
       FROM pg_roles r
       LEFT JOIN pg_auth_members m ON m.roleid = r.oid AND m.member = 'app_user'::regrole
      WHERE r.rolname = ANY($1)`,
    [roles],
  );
  for (const role of roles) {
    const row = roleRows.find((candidate) => candidate.rolname === role);
    if (row === undefined) {
      failures.push(`ロール ${role} がない`);
      continue;
    }
    if (row.rolcanlogin) failures.push(`ロール ${role} が LOGIN できる`);
    if (row.rolsuper) failures.push(`ロール ${role} が superuser`);
    if (row.rolbypassrls) failures.push(`ロール ${role} が BYPASSRLS`);
    if (row.inherit_option !== false || row.set_option !== true) {
      failures.push(`app_user が ${role} に INHERIT FALSE、SET TRUE で入っていない`);
    }
  }

  // モジュールのロールは、ほかのロールのメンバーにならない。INHERIT FALSE でも SET で入れてしまう。
  const { rows: memberships } = await pool.query<{ member: string; roleName: string }>(
    `SELECT mr.rolname AS member, gr.rolname AS "roleName"
       FROM pg_auth_members m
       JOIN pg_roles mr ON mr.oid = m.member
       JOIN pg_roles gr ON gr.oid = m.roleid
      WHERE mr.rolname = ANY($1)`,
    [roles],
  );
  for (const row of memberships) failures.push(`${row.member} が ${row.roleName} のメンバー`);

  const { rows: schemaRows } = await pool.query<{ nspname: string }>(
    `SELECT nspname FROM pg_namespace WHERE nspname = ANY($1)`,
    [modules],
  );
  for (const module of modules) {
    if (!schemaRows.some((row) => row.nspname === module))
      failures.push(`スキーマ ${module} がない`);
  }
  // ロールかスキーマがないと、権限の問い合わせ自体が失敗する。ここまでの失敗を返す。
  if (failures.length > 0) return failures;

  // ロールごとに USAGE を持つスキーマ: 自分のスキーマと、依存の方向のスキーマ。app_user は何も持たない。
  const usable = new Map(
    Object.entries(reads).map(([module, dependencies]) => [
      roleOf(module),
      new Set([module, ...dependencies]),
    ]),
  );
  const canUse = (role: string, schema: string) => usable.get(role)?.has(schema) === true;

  const { rows: schemaPrivileges } = await pool.query<{
    rolname: string;
    nspname: string;
    usage: boolean;
    create: boolean;
  }>(
    `SELECT r.rolname, n.nspname,
            has_schema_privilege(r.rolname, n.nspname, 'USAGE') AS usage,
            has_schema_privilege(r.rolname, n.nspname, 'CREATE') AS "create"
       FROM unnest($1::text[]) AS r(rolname), unnest($2::text[]) AS n(nspname)`,
    [[...roles, "app_user"], modules],
  );
  for (const row of schemaPrivileges) {
    if (row.usage !== canUse(row.rolname, row.nspname)) {
      failures.push(
        `${row.rolname} の ${row.nspname} スキーマの USAGE が${row.usage ? "ある" : "ない"}`,
      );
    }
    if (row.create) failures.push(`${row.rolname} が ${row.nspname} スキーマに CREATE できる`);
  }

  const { rows: tablePrivilegeRows } = await pool.query<{
    rolname: string;
    nspname: string;
    relname: string;
    privilege: string;
    has: boolean;
  }>(
    `SELECT r.rolname, n.nspname, c.relname, p.privilege,
            has_table_privilege(r.rolname, c.oid, p.privilege) AS has
       FROM unnest($1::text[]) AS r(rolname)
       CROSS JOIN pg_namespace n
       JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       CROSS JOIN unnest($3::text[]) AS p(privilege)
      WHERE n.nspname = ANY($2)`,
    [[...roles, "app_user"], [...modules, "auth"], tablePrivileges],
  );
  for (const row of tablePrivilegeRows) {
    // auth の表には、表全体の権限を誰にも与えない。締めの id の SELECT は列の権限で、下で調べる。
    const want =
      canUse(row.rolname, row.nspname) &&
      (row.privilege === "SELECT" ||
        (row.rolname === roleOf(row.nspname) && ownPrivileges.includes(row.privilege)));
    if (row.has !== want) {
      failures.push(
        `${row.rolname} の ${row.nspname}.${row.relname} の ${row.privilege} が${row.has ? "ある" : "ない"}`,
      );
    }
  }

  // auth: 締めのロールの organization.id の SELECT だけ。列の権限は、表の権限とは別に調べる。
  const { rows: authRows } = await pool.query<{
    rolname: string;
    usage: boolean;
    relname: string | null;
    attname: string | null;
    privilege: string | null;
    has: boolean | null;
  }>(
    `SELECT r.rolname, has_schema_privilege(r.rolname, 'auth', 'USAGE') AS usage,
            c.relname, a.attname, p.privilege,
            has_column_privilege(r.rolname, c.oid, a.attnum, p.privilege) AS has
       FROM unnest($1::text[]) AS r(rolname)
       CROSS JOIN unnest($2::text[]) AS p(privilege)
       LEFT JOIN pg_class c ON c.relnamespace = 'auth'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped`,
    [[...roles, "app_user"], columnPrivileges],
  );
  const authUsage = new Map(authRows.map((row) => [row.rolname, row.usage]));
  for (const [role, usage] of authUsage) {
    if (usage !== (role === tenantList.role)) {
      failures.push(`${role} の auth スキーマの USAGE が${usage ? "ある" : "ない"}`);
    }
  }
  for (const row of authRows) {
    if (row.relname === null || row.attname === null) continue;
    const want =
      row.privilege === "SELECT" &&
      row.rolname === tenantList.role &&
      row.relname === tenantList.table &&
      row.attname === tenantList.column;
    if (row.has !== want) {
      failures.push(
        `${row.rolname} の auth.${row.relname}.${row.attname} の ${row.privilege} が${row.has ? "ある" : "ない"}`,
      );
    }
  }

  const { rows: views } = await pool.query<{ nspname: string; relname: string }>(
    `SELECT n.nspname, c.relname
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind IN ('v', 'm')
        AND NOT coalesce('security_invoker=true' = ANY(c.reloptions), false)`,
    [modules],
  );
  for (const view of views) {
    failures.push(
      `${view.nspname}.${view.relname} が所有者の権限で動く view (security_invoker = true にする)`,
    );
  }

  const { rows: definers } = await pool.query<{ nspname: string; proname: string }>(
    `SELECT n.nspname, p.proname
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = ANY($1) AND p.prosecdef`,
    [modules],
  );
  for (const fn of definers) {
    failures.push(`${fn.nspname}.${fn.proname} が SECURITY DEFINER の関数`);
  }

  const { rows: foreignKeys } = await pool.query<{
    conname: string;
    from_schema: string;
    to_schema: string;
  }>(
    `SELECT k.conname, fn.nspname AS from_schema, tn.nspname AS to_schema
       FROM pg_constraint k
       JOIN pg_class f ON f.oid = k.conrelid JOIN pg_namespace fn ON fn.oid = f.relnamespace
       JOIN pg_class t ON t.oid = k.confrelid JOIN pg_namespace tn ON tn.oid = t.relnamespace
      WHERE k.contype = 'f' AND fn.nspname = ANY($1) AND fn.nspname <> tn.nspname`,
    [modules],
  );
  for (const key of foreignKeys) {
    failures.push(
      `外部キー ${key.conname} が ${key.from_schema} から ${key.to_schema} をまたいでいる`,
    );
  }

  return failures;
}
