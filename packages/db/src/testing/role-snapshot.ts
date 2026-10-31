import type { Queryable } from "../queryable.ts";

/**
 * クラスタ全体のロールの状態 (属性とメンバーシップ) を、並べ替えた文の一覧にする。システムのロール (pg_*) は除く。
 * テストの前後で比べて、コミットされたロールの変更を見つける (Issue #448)。
 */
export async function snapshotRoles(pool: Queryable): Promise<string[]> {
  const [attributes, memberships] = await Promise.all([
    pool.query<{ line: string }>(
      `SELECT format('%s super=%s inherit=%s createrole=%s createdb=%s login=%s bypassrls=%s connlimit=%s',
                     rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls, rolconnlimit) AS line
         FROM pg_roles WHERE rolname !~ '^pg_'`,
    ),
    pool.query<{ line: string }>(
      `SELECT format('%s は %s のメンバー inherit=%s set=%s admin=%s',
                     mr.rolname, gr.rolname, m.inherit_option, m.set_option, m.admin_option) AS line
         FROM pg_auth_members m
         JOIN pg_roles mr ON mr.oid = m.member
         JOIN pg_roles gr ON gr.oid = m.roleid
        WHERE mr.rolname !~ '^pg_' AND gr.rolname !~ '^pg_'`,
    ),
  ]);
  return [...attributes.rows, ...memberships.rows].map((row) => row.line).toSorted();
}

/** 2 つの状態の差を、消えた行に `-`、増えた行に `+` を付けて返す。同じなら空。 */
export function diffRoles(before: readonly string[], after: readonly string[]): string[] {
  const kept = new Set(after);
  const was = new Set(before);
  return [
    ...before.filter((line) => !kept.has(line)).map((line) => `- ${line}`),
    ...after.filter((line) => !was.has(line)).map((line) => `+ ${line}`),
  ];
}
