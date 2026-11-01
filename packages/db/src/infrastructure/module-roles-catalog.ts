import type { Queryable } from "./queryable.ts";

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

/** Outbox を読んで送る処理のロールと、Outbox の表 (Issue #269、docs/adr/0029)。 */
const relayRole = "outbox_relay";
const outbox = { schema: "messaging", table: "outbox" };
const outboxName = `${outbox.schema}.${outbox.table}`;
/** pg_policies に出る、テナントで比べるポリシーの式。`inTenantTransaction` が設定する app.current_tenant と比べる。 */
const tenantExpression = "(tenant_id = (current_setting('app.current_tenant'::text))::uuid)";

// 検査は 1 種類ずつの関数にする。どれも pool と、見る対象を受け取り、決めたとおりでない点を文の一覧で返す。
type Check = (pool: Queryable, reads: ModuleReads) => Promise<string[]>;

const yesNo = (has: boolean) => (has ? "ある" : "ない");

/** ロールの属性 (NOLOGIN、superuser でない、BYPASSRLS でない) と、app_user のメンバーシップ。 */
const roleAttributes: Check = async (pool, reads) => {
  const roles = Object.keys(reads).map(roleOf);
  const { rows } = await pool.query<{
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
  return roles.flatMap((role) => {
    const row = rows.find((candidate) => candidate.rolname === role);
    if (row === undefined) return [`ロール ${role} がない`];
    return [
      ...(row.rolcanlogin ? [`ロール ${role} が LOGIN できる`] : []),
      ...(row.rolsuper ? [`ロール ${role} が superuser`] : []),
      ...(row.rolbypassrls ? [`ロール ${role} が BYPASSRLS`] : []),
      ...(row.inherit_option !== false || row.set_option !== true
        ? [`app_user が ${role} に INHERIT FALSE、SET TRUE で入っていない`]
        : []),
    ];
  });
};

/** モジュールのロールは、ほかのロールのメンバーにならない。INHERIT FALSE でも SET で入れてしまう。 */
const roleMemberships: Check = async (pool, reads) => {
  const { rows } = await pool.query<{ member: string; roleName: string }>(
    `SELECT mr.rolname AS member, gr.rolname AS "roleName"
       FROM pg_auth_members m
       JOIN pg_roles mr ON mr.oid = m.member
       JOIN pg_roles gr ON gr.oid = m.roleid
      WHERE mr.rolname = ANY($1)`,
    [Object.keys(reads).map(roleOf)],
  );
  return rows.map((row) => `${row.member} が ${row.roleName} のメンバー`);
};

const schemasExist: Check = async (pool, reads) => {
  const modules = [...Object.keys(reads), outbox.schema];
  const { rows } = await pool.query<{ nspname: string }>(
    `SELECT nspname FROM pg_namespace WHERE nspname = ANY($1)`,
    [modules],
  );
  return modules
    .filter((module) => !rows.some((row) => row.nspname === module))
    .map((module) => `スキーマ ${module} がない`);
};

/** 送る処理のロール: ログインできるが、superuser でも BYPASSRLS でも DDL を実行できるロールでもない。 */
const relayAttributes: Check = async (pool) => {
  const { rows } = await pool.query<{
    rolcanlogin: boolean;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreaterole: boolean;
    rolcreatedb: boolean;
  }>(
    `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = $1`,
    [relayRole],
  );
  const row = rows[0];
  if (row === undefined) return [`ロール ${relayRole} がない`];
  return [
    ...(row.rolcanlogin ? [] : [`ロール ${relayRole} が LOGIN できない`]),
    ...(row.rolsuper ? [`ロール ${relayRole} が superuser`] : []),
    ...(row.rolbypassrls ? [`ロール ${relayRole} が BYPASSRLS`] : []),
    ...(row.rolcreaterole ? [`ロール ${relayRole} が CREATEROLE`] : []),
    ...(row.rolcreatedb ? [`ロール ${relayRole} が CREATEDB`] : []),
  ];
};

/** outbox_relay はほかのロールのメンバーにならず、だれもそのメンバーにならない (app_user から SET ROLE できない)。 */
const relayMemberships: Check = async (pool) => {
  const { rows } = await pool.query<{ member: string; roleName: string }>(
    `SELECT mr.rolname AS member, gr.rolname AS "roleName"
       FROM pg_auth_members m
       JOIN pg_roles mr ON mr.oid = m.member
       JOIN pg_roles gr ON gr.oid = m.roleid
      WHERE mr.rolname = $1 OR gr.rolname = $1`,
    [relayRole],
  );
  return rows.map((row) => `${row.member} が ${row.roleName} のメンバー`);
};

// ロールごとに USAGE を持つスキーマ: 自分のスキーマと、依存の方向のスキーマ。app_user は何も持たない。
const canUseOf = (reads: ModuleReads) => {
  const usable = new Map(
    Object.entries(reads).map(([module, dependencies]) => [
      roleOf(module),
      new Set([module, ...dependencies]),
    ]),
  );
  return (role: string, schema: string) => usable.get(role)?.has(schema) === true;
};

// outbox_relay も入れる: モジュールのスキーマと auth には、何の権限も持たない。
const subjects = (reads: ModuleReads) => [...Object.keys(reads).map(roleOf), "app_user", relayRole];

const schemaPrivileges: Check = async (pool, reads) => {
  const canUse = canUseOf(reads);
  const { rows } = await pool.query<{
    rolname: string;
    nspname: string;
    usage: boolean;
    create: boolean;
  }>(
    `SELECT r.rolname, n.nspname,
            has_schema_privilege(r.rolname, n.nspname, 'USAGE') AS usage,
            has_schema_privilege(r.rolname, n.nspname, 'CREATE') AS "create"
       FROM unnest($1::text[]) AS r(rolname), unnest($2::text[]) AS n(nspname)`,
    [subjects(reads), Object.keys(reads)],
  );
  return rows.flatMap((row) => [
    ...(row.usage !== canUse(row.rolname, row.nspname)
      ? [`${row.rolname} の ${row.nspname} スキーマの USAGE が${yesNo(row.usage)}`]
      : []),
    ...(row.create ? [`${row.rolname} が ${row.nspname} スキーマに CREATE できる`] : []),
  ]);
};

/**
 * 自分のモジュールのロールだけが読む表。他人の user_id と保存した応答が入るので、依存の方向のモジュールにも
 * SELECT を付けない (冪等キーの表。Issue #323、docs/adr/0040)。
 */
const ownerOnlyTables = ["idempotency_key"];

/** 表の権限。auth の表には、表全体の権限を誰にも与えない。締めの id の SELECT は列の権限で、authColumns が調べる。 */
const tablePrivilegeChecks: Check = async (pool, reads) => {
  const canUse = canUseOf(reads);
  const { rows } = await pool.query<{
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
    [subjects(reads), [...Object.keys(reads), "auth"], tablePrivileges],
  );
  return rows
    .filter(
      (row) =>
        row.has !==
        (canUse(row.rolname, row.nspname) &&
          ((row.privilege === "SELECT" &&
            (row.rolname === roleOf(row.nspname) || !ownerOnlyTables.includes(row.relname))) ||
            (row.rolname === roleOf(row.nspname) && ownPrivileges.includes(row.privilege)))),
    )
    .map(
      (row) =>
        `${row.rolname} の ${row.nspname}.${row.relname} の ${row.privilege} が${yesNo(row.has)}`,
    );
};

/** auth: 締めのロールの USAGE と organization.id の SELECT だけ。列の権限は、表の権限とは別に調べる。 */
const authColumns: Check = async (pool, reads) => {
  const { rows } = await pool.query<{
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
    [subjects(reads), columnPrivileges],
  );
  const usage = new Map(rows.map((row) => [row.rolname, row.usage]));
  return [
    ...[...usage]
      .filter(([role, has]) => has !== (role === tenantList.role))
      .map(([role, has]) => `${role} の auth スキーマの USAGE が${yesNo(has)}`),
    ...rows
      .filter(
        (row) =>
          row.relname !== null &&
          row.attname !== null &&
          row.has !==
            (row.privilege === "SELECT" &&
              row.rolname === tenantList.role &&
              row.relname === tenantList.table &&
              row.attname === tenantList.column),
      )
      .map(
        (row) =>
          `${row.rolname} の auth.${row.relname}.${row.attname} の ${row.privilege} が${yesNo(row.has === true)}`,
      ),
  ];
};

// messaging スキーマと Outbox の表の権限。モジュールのロールは INSERT だけ、outbox_relay は SELECT、UPDATE、DELETE だけで、
// app_user は何も持たない。列だけの権限も見つけるので、has_any_column_privilege で調べる。
const outboxPrivileges = (reads: ModuleReads, role: string, privilege: string): boolean =>
  Object.keys(reads).map(roleOf).includes(role)
    ? privilege === "INSERT"
    : role === relayRole && ["SELECT", "UPDATE", "DELETE"].includes(privilege);

const messagingPrivileges: Check = async (pool, reads) => {
  const { rows } = await pool.query<{
    rolname: string;
    privilege: string;
    has: boolean;
    usage: boolean;
    create: boolean;
  }>(
    `SELECT r.rolname, p.privilege,
            CASE WHEN p.privilege IN ('DELETE', 'TRUNCATE', 'TRIGGER')
                 THEN has_table_privilege(r.rolname, $3::regclass, p.privilege)
                 ELSE has_any_column_privilege(r.rolname, $3::regclass, p.privilege) END AS has,
            has_schema_privilege(r.rolname, $2, 'USAGE') AS usage,
            has_schema_privilege(r.rolname, $2, 'CREATE') AS "create"
       FROM unnest($1::text[]) AS r(rolname)
       CROSS JOIN unnest($4::text[]) AS p(privilege)`,
    [subjects(reads), outbox.schema, outboxName, tablePrivileges],
  );
  const needsUsage = (role: string) => role !== "app_user";
  return [
    ...rows
      .filter((row) => row.has !== outboxPrivileges(reads, row.rolname, row.privilege))
      .map((row) => `${row.rolname} の ${outboxName} の ${row.privilege} が${yesNo(row.has)}`),
    ...[...new Map(rows.map((row) => [row.rolname, row])).values()].flatMap((row) => [
      ...(row.usage !== needsUsage(row.rolname)
        ? [`${row.rolname} の ${outbox.schema} スキーマの USAGE が${yesNo(row.usage)}`]
        : []),
      ...(row.create ? [`${row.rolname} が ${outbox.schema} スキーマに CREATE できる`] : []),
    ]),
  ];
};

/**
 * outbox_relay は messaging.outbox のほかに権限を持たない。モジュールのスキーマと auth は subjects の検査が見るので、
 * ここでは、それ以外のスキーマ (public など) の表と view を見る。システムのスキーマは見ない。
 */
const relayElsewhere: Check = async (pool, reads) => {
  const { rows } = await pool.query<{ nspname: string; relname: string; privilege: string }>(
    `SELECT n.nspname, c.relname, p.privilege
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN unnest($3::text[]) AS p(privilege)
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND n.nspname <> ALL ($2::text[])
        AND CASE WHEN p.privilege IN ('DELETE', 'TRUNCATE', 'TRIGGER')
                 THEN has_table_privilege($1, c.oid, p.privilege)
                 ELSE has_any_column_privilege($1, c.oid, p.privilege) END`,
    [relayRole, [...Object.keys(reads), "auth", outbox.schema], tablePrivileges],
  );
  return rows.map(
    (row) => `${relayRole} の ${row.nspname}.${row.relname} の ${row.privilege} がある`,
  );
};

/** messaging.outbox がある。ないと、権限の問い合わせ自体が失敗するので、権限の検査より先に確かめる。 */
const outboxExists: Check = async (pool) => {
  const { rows } = await pool.query<{ found: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS found`,
    [outboxName],
  );
  return rows[0]?.found === true ? [] : [`表 ${outboxName} がない`];
};

/** messaging.outbox は RLS を ENABLE と FORCE にする (docs/adr/0011)。 */
const outboxRowSecurity: Check = async (pool) => {
  const { rows } = await pool.query<{ rls: boolean; forceRls: boolean }>(
    `SELECT relrowsecurity AS rls, relforcerowsecurity AS "forceRls" FROM pg_class
      WHERE oid = to_regclass($1)`,
    [outboxName],
  );
  return [
    ...(rows[0]?.rls === true ? [] : [`${outboxName} が RLS を ENABLE にしていない`]),
    ...(rows[0]?.forceRls === true ? [] : [`${outboxName} が RLS を FORCE にしていない`]),
  ];
};

/**
 * RLS のポリシー。app.current_tenant で比べないポリシーは、messaging.outbox の outbox_relay 向けの 1 つだけ
 * (ADR 0011 の例外。docs/adr/0029)。式の文字列を `tenantExpression` と比べるので、`OR true` のような足し込みも見つける。
 */
const rlsPolicies: Check = async (pool) => {
  const { rows } = await pool.query<{
    schemaname: string;
    tablename: string;
    policyname: string;
    roles: string[];
    qual: string | null;
    withCheck: string | null;
  }>(
    `SELECT schemaname, tablename, policyname, roles::text[] AS roles, qual, with_check AS "withCheck"
       FROM pg_policies`,
  );
  const isTenantScoped = (row: (typeof rows)[number]) =>
    [row.qual, row.withCheck].every(
      (expression) => expression === null || expression === tenantExpression,
    );
  // 例外のポリシーは、messaging.outbox の outbox_relay だけに掛かり、式が `true` (USING (true)) のものに限る。
  const isRelayPolicy = (row: (typeof rows)[number]) =>
    row.schemaname === outbox.schema &&
    row.tablename === outbox.table &&
    row.roles.length === 1 &&
    row.roles[0] === relayRole &&
    row.qual === "true" &&
    (row.withCheck === null || row.withCheck === "true");
  const exceptions = rows.filter((row) => !isTenantScoped(row));
  return [
    ...exceptions
      .filter((row) => !isRelayPolicy(row))
      .map(
        (row) =>
          `${row.schemaname}.${row.tablename} のポリシー ${row.policyname} が app.current_tenant で比べていない` +
          " (例外は messaging.outbox の outbox_relay 向けの USING (true) の 1 つだけ)",
      ),
    ...(exceptions.filter(isRelayPolicy).length === 1
      ? []
      : [`${outboxName} に outbox_relay 向けの USING (true) のポリシーが 1 つない`]),
  ];
};

const ownerViews: Check = async (pool, reads) => {
  const { rows } = await pool.query<{ nspname: string; relname: string }>(
    `SELECT n.nspname, c.relname
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind IN ('v', 'm')
        AND NOT coalesce('security_invoker=true' = ANY(c.reloptions), false)`,
    [Object.keys(reads)],
  );
  return rows.map(
    (view) =>
      `${view.nspname}.${view.relname} が所有者の権限で動く view (security_invoker = true にする)`,
  );
};

const securityDefiners: Check = async (pool, reads) => {
  const { rows } = await pool.query<{ nspname: string; proname: string }>(
    `SELECT n.nspname, p.proname
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = ANY($1) AND p.prosecdef`,
    [Object.keys(reads)],
  );
  return rows.map((fn) => `${fn.nspname}.${fn.proname} が SECURITY DEFINER の関数`);
};

const crossSchemaForeignKeys: Check = async (pool, reads) => {
  const { rows } = await pool.query<{ conname: string; from_schema: string; to_schema: string }>(
    `SELECT k.conname, fn.nspname AS from_schema, tn.nspname AS to_schema
       FROM pg_constraint k
       JOIN pg_class f ON f.oid = k.conrelid JOIN pg_namespace fn ON fn.oid = f.relnamespace
       JOIN pg_class t ON t.oid = k.confrelid JOIN pg_namespace tn ON tn.oid = t.relnamespace
      WHERE k.contype = 'f' AND fn.nspname = ANY($1) AND fn.nspname <> tn.nspname`,
    [Object.keys(reads)],
  );
  return rows.map(
    (key) => `外部キー ${key.conname} が ${key.from_schema} から ${key.to_schema} をまたいでいる`,
  );
};

// ロールかスキーマがないと、権限の問い合わせ自体が失敗するので、先に確かめて、あれば権限の検査に進まない。
const existence: readonly Check[] = [
  roleAttributes,
  roleMemberships,
  relayAttributes,
  relayMemberships,
  schemasExist,
  outboxExists,
];
const privileges: readonly Check[] = [
  schemaPrivileges,
  tablePrivilegeChecks,
  authColumns,
  messagingPrivileges,
  relayElsewhere,
  outboxRowSecurity,
  rlsPolicies,
  ownerViews,
  securityDefiners,
  crossSchemaForeignKeys,
];

const runAll = async (checks: readonly Check[], pool: Queryable, reads: ModuleReads) =>
  (await Promise.all(checks.map((check) => check(pool, reads)))).flat();

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
 * - `messaging.outbox` (Issue #269): モジュールのロールは INSERT だけ、`outbox_relay` は SELECT、UPDATE、DELETE だけ、
 *   `app_user` は何も持たない。`outbox_relay` はログインできるが、superuser でも BYPASSRLS でもなく、モジュールのスキーマと
 *   `auth` に権限を持たず、だれのメンバーにもならず、だれもそのメンバーにならない。
 * - RLS のポリシーで `app.current_tenant` で比べないものは、`messaging.outbox` の `outbox_relay` 向けの 1 つだけ。
 *
 * この検査はテスト専用で、migrate や CI の別の段からは呼ばない。migration を流した DB に対する結合テスト
 * (module-roles-catalog.test.ts) が、毎回これを呼んで問題が空であることを確かめる。
 */
export async function checkModuleRoles(pool: Queryable, reads: ModuleReads): Promise<string[]> {
  const missing = await runAll(existence, pool, reads);
  if (missing.length > 0) return missing;
  return runAll(privileges, pool, reads);
}
