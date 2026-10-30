import type { Pool } from "pg";

// docs/db の規約のうち、migration を流した DB のカタログ (pg_catalog) で判定できるものを確かめる (Issue #361)。
// SQL の静的な解析はしない。規約の出典は検査ごとに書く。人がレビューで見る項目 (名前が意味に合うか、結合する列の
// index が足りているか、業務として必要な一意性があるか) は確かめない (docs/db/convention-check.md)。

/** 検査の名前。例外 (ConventionException) の check と、失敗の文の先頭の `[名前]` に使う。 */
export const conventionChecks = [
  "naming",
  "reserved-word",
  "common-columns",
  "column-types",
  "primary-key",
  "foreign-key",
  "check-constraint",
  "unique-constraint",
  "row-level-security",
  "privileges",
] as const;
type ConventionCheck = (typeof conventionChecks)[number];

/** 検査から外す対象。理由が空だと、その例外は効かず、検査が失敗を返す。 */
export interface ConventionException {
  /** スキーマ (`auth`) か、表 (`auth.rateLimit`)。 */
  readonly scope: string;
  /** 外す検査。`all` はすべて。 */
  readonly check: ConventionCheck | "all";
  readonly reason: string;
}

const betterAuthReason =
  "Better Auth が生成する表の定義のままにする (docs/adr/0025 の「docs/db の規約の例外」)";

/** 検査の設定。例外を足すときは、理由を書く。 */
export const conventionExceptions: readonly ConventionException[] = [
  // auth: Better Auth の生成物。名前、共通カラム、型、RLS は規約に従えない (docs/adr/0025)。
  // 外部キーと一意制約は、Better Auth が生成する表の定義にあり、規約と合わない。
  { scope: "auth", check: "naming", reason: betterAuthReason },
  { scope: "auth", check: "reserved-word", reason: betterAuthReason },
  { scope: "auth", check: "common-columns", reason: betterAuthReason },
  { scope: "auth", check: "column-types", reason: betterAuthReason },
  {
    scope: "auth",
    check: "row-level-security",
    reason: "auth の表は RLS の対象にしない (docs/adr/0011)",
  },
  { scope: "auth", check: "foreign-key", reason: betterAuthReason },
  { scope: "auth", check: "unique-constraint", reason: betterAuthReason },
  // migrations: dbmate の履歴の表 (docs/adr/0025)。dbmate が作る定義のままにする。
  { scope: "migrations", check: "all", reason: "dbmate の履歴の表。dbmate が作る定義のままにする" },
];

/** DDL を実行できてはいけないロール (docs/adr/0025)。 */
const restrictedRoles = ["app_user", "auth_service"];

interface Violation {
  readonly check: ConventionCheck;
  readonly schema: string;
  readonly table?: string;
  readonly message: string;
}

interface TableRow {
  readonly schema: string;
  readonly table: string;
  readonly rls: boolean;
  readonly forceRls: boolean;
}

interface ColumnRow {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
  readonly typname: string;
  readonly notNull: boolean;
  /** IDENTITY 列なら `a` (ALWAYS) か `d` (BY DEFAULT)。そうでなければ空。 */
  readonly identity: string;
  readonly defaultExpr: string | null;
}

interface ConstraintRow {
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly type: "p" | "f" | "c" | "u";
  readonly columns: string[];
}

interface Snapshot {
  readonly schemas: string[];
  readonly tables: TableRow[];
  readonly columns: ColumnRow[];
  readonly constraints: ConstraintRow[];
  readonly reserved: Set<string>;
}

// システムのスキーマ (pg_catalog、pg_toast、information_schema) は見ない。
const userSchema = (column: string) => `${column} !~ '^pg_' AND ${column} <> 'information_schema'`;
const userTable = `c.relkind IN ('r', 'p') AND ${userSchema("n.nspname")}`;

async function snapshot(pool: Pool): Promise<Snapshot> {
  const [schemas, tables, columns, constraints, keywords] = await Promise.all([
    pool.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace n WHERE ${userSchema("nspname")}`,
    ),
    pool.query<TableRow>(
      `SELECT n.nspname AS schema, c.relname AS "table",
              c.relrowsecurity AS rls, c.relforcerowsecurity AS "forceRls"
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE ${userTable}`,
    ),
    pool.query<ColumnRow>(
      `SELECT n.nspname AS schema, c.relname AS "table", a.attname AS "column", t.typname,
              a.attnotnull AS "notNull", a.attidentity AS identity,
              pg_get_expr(d.adbin, d.adrelid) AS "defaultExpr"
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_type t ON t.oid = a.atttypid
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attnum > 0 AND NOT a.attisdropped AND ${userTable}
        ORDER BY n.nspname, c.relname, a.attnum`,
    ),
    pool.query<ConstraintRow>(
      `SELECT n.nspname AS schema, c.relname AS "table", k.conname AS name, k.contype AS type,
              ARRAY(SELECT a.attname::text
                      FROM unnest(k.conkey) WITH ORDINALITY AS u(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.attnum
                     ORDER BY u.ord) AS columns
         FROM pg_constraint k
         JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE k.contype IN ('p', 'f', 'c', 'u') AND ${userTable}`,
    ),
    // R: 予約語。T: 予約語だが関数名と型名には使える。PostgreSQL の SQL Key Words の表の reserved にあたる。
    pool.query<{ word: string }>(`SELECT word FROM pg_get_keywords() WHERE catcode IN ('R', 'T')`),
  ]);
  return {
    schemas: schemas.rows.map((row) => row.nspname),
    tables: tables.rows,
    columns: columns.rows,
    constraints: constraints.rows,
    reserved: new Set(keywords.rows.map((row) => row.word)),
  };
}

const snakeCase = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** スキーマ、表、カラムの名前が snake_case で、予約語でない (docs/db/postgresql-naming-physical.md)。 */
function names(snap: Snapshot): Violation[] {
  const identifiers = [
    ...snap.schemas.map((schema) => ({ schema, label: `スキーマ ${schema}`, name: schema })),
    ...snap.tables.map(({ schema, table }) => ({
      schema,
      table,
      label: `表 ${schema}.${table}`,
      name: table,
    })),
    ...snap.columns.map(({ schema, table, column }) => ({
      schema,
      table,
      label: `カラム ${schema}.${table}.${column}`,
      name: column,
    })),
  ];
  return identifiers.flatMap(({ name, label, ...where }) => [
    ...(snakeCase.test(name)
      ? []
      : [{ check: "naming" as const, ...where, message: `${label} が snake_case でない` }]),
    ...(snap.reserved.has(name.toLowerCase())
      ? [{ check: "reserved-word" as const, ...where, message: `${label} が予約語` }]
      : []),
  ]);
}

// 共通カラム (docs/db/postgresql-keys.md の「共通カラム」)。桁は見ない。
const textColumn = { type: "varchar", notNull: true } as const;
const patchColumn = { type: "varchar", notNull: false } as const;
const commonColumns: readonly {
  name: string;
  type: string;
  notNull: boolean;
  defaultExpr?: string;
}[] = [
  { name: "created_at", type: "timestamptz", notNull: true },
  { name: "created_by", ...textColumn },
  { name: "created_pgm_cd", ...textColumn },
  { name: "created_tx_id", ...textColumn },
  { name: "updated_at", type: "timestamptz", notNull: true },
  { name: "updated_by", ...textColumn },
  { name: "updated_pgm_cd", ...textColumn },
  { name: "updated_tx_id", ...textColumn },
  { name: "lock_no", type: "int4", notNull: true, defaultExpr: "1" },
  { name: "patched_at", type: "timestamptz", notNull: false },
  { name: "patched_by", ...patchColumn },
  { name: "patched_id", ...patchColumn },
];

function commonColumnChecks(snap: Snapshot): Violation[] {
  return snap.tables.flatMap(({ schema, table }) =>
    commonColumns.flatMap((spec) => {
      const where = { check: "common-columns" as const, schema, table };
      const label = `${schema}.${table} の ${spec.name}`;
      const column = snap.columns.find(
        (candidate) =>
          candidate.schema === schema &&
          candidate.table === table &&
          candidate.column === spec.name,
      );
      if (column === undefined) return [{ ...where, message: `${label} がない` }];
      return [
        ...(column.typname === spec.type
          ? []
          : [{ ...where, message: `${label} の型が ${column.typname}。${spec.type} にする` }]),
        ...(column.notNull === spec.notNull
          ? []
          : [
              {
                ...where,
                message: `${label} が ${spec.notNull ? "NOT NULL でない" : "NULL を許さない"}`,
              },
            ]),
        ...(spec.defaultExpr === undefined || column.defaultExpr === spec.defaultExpr
          ? []
          : [
              {
                ...where,
                message:
                  column.defaultExpr === null
                    ? `${label} に既定値がない。${spec.defaultExpr} にする`
                    : `${label} の既定値が ${column.defaultExpr}。${spec.defaultExpr} にする`,
              },
            ]),
      ];
    }),
  );
}

// 使わない型 (docs/db/postgresql-column.md の「使わない型」)。
const bannedTypes: Readonly<Record<string, string>> = {
  money: "money 型は使わず numeric にする",
  float4: "float 型は使わず numeric にする",
  float8: "float 型は使わず numeric にする",
  timestamp: "タイムゾーンなしの timestamp は使わず timestamptz にする",
};

/** serial、money、float、タイムゾーンなしの timestamp を使わない。連番は bigint の IDENTITY。 */
function columnTypes(snap: Snapshot): Violation[] {
  return snap.columns.flatMap(({ schema, table, column, typname, identity, defaultExpr }) => {
    const where = { check: "column-types" as const, schema, table };
    const label = `${schema}.${table}.${column}`;
    const banned = bannedTypes[typname];
    return [
      ...(banned === undefined ? [] : [{ ...where, message: `${label}: ${banned}` }]),
      ...(identity === "" && defaultExpr?.startsWith("nextval(") === true
        ? [{ ...where, message: `${label}: serial は使わず bigint の IDENTITY にする` }]
        : []),
      ...(identity !== "" && typname !== "int8"
        ? [{ ...where, message: `${label}: IDENTITY 列は bigint にする (${typname})` }]
        : []),
    ];
  });
}

const constraintsOf = (
  snap: Snapshot,
  schema: string,
  table: string,
  type: ConstraintRow["type"],
) =>
  snap.constraints.filter(
    (constraint) =>
      constraint.schema === schema && constraint.table === table && constraint.type === type,
  );

/** 主キーがあり、複合の主キーが tenant_id で始まる (docs/adr/0011)。 */
function primaryKeys(snap: Snapshot): Violation[] {
  return snap.tables.flatMap(({ schema, table }) => {
    const where = { check: "primary-key" as const, schema, table };
    const [key] = constraintsOf(snap, schema, table, "p");
    if (key === undefined) return [{ ...where, message: `${schema}.${table} に主キーがない` }];
    return key.columns.length > 1 && key.columns[0] !== "tenant_id"
      ? [
          {
            ...where,
            message: `${schema}.${table} の複合の主キー (${key.columns.join(", ")}) が tenant_id で始まらない`,
          },
        ]
      : [];
  });
}

// 外部キー、CHECK 制約、UNIQUE 制約を使わない (docs/db/postgresql-constraints.md)。
// スキーマをまたぐ外部キーは、モジュールの検査 (module-roles-catalog.ts、docs/adr/0029) も止める。
const forbiddenConstraints = [
  { type: "f", check: "foreign-key", what: "外部キー制約", instead: "" },
  { type: "c", check: "check-constraint", what: "CHECK 制約", instead: "" },
  {
    type: "u",
    check: "unique-constraint",
    what: "UNIQUE 制約",
    instead: "。ユニークインデックスにする",
  },
] as const;

function forbidden(snap: Snapshot): Violation[] {
  return forbiddenConstraints.flatMap(({ type, check, what, instead }) =>
    snap.constraints
      .filter((constraint) => constraint.type === type)
      .map(({ schema, table, name }) => ({
        check,
        schema,
        table,
        message: `${schema}.${table} に ${what} ${name} がある${instead}`,
      })),
  );
}

/** tenant_id を持つ表が、RLS を ENABLE と FORCE にしている (docs/adr/0011)。 */
function rowLevelSecurity(snap: Snapshot): Violation[] {
  return snap.tables
    .filter(({ schema, table }) =>
      snap.columns.some(
        (column) =>
          column.schema === schema && column.table === table && column.column === "tenant_id",
      ),
    )
    .flatMap(({ schema, table, rls, forceRls }) => {
      const where = { check: "row-level-security" as const, schema, table };
      return [
        ...(rls ? [] : [{ ...where, message: `${schema}.${table} が RLS を ENABLE にしていない` }]),
        ...(forceRls
          ? []
          : [{ ...where, message: `${schema}.${table} が RLS を FORCE にしていない` }]),
      ];
    });
}

// PUBLIC の権限は、PostgreSQL の既定を引いて数える (ACL が NULL のときは、所有者だけの既定の権限)。
// public スキーマの USAGE と、データベースの CONNECT、TEMPORARY は PostgreSQL の既定で PUBLIC にある。
const publicGrants = `
  SELECT n.nspname AS schema, NULL AS name, 'スキーマ ' || n.nspname AS label, a.privilege_type AS privilege
    FROM pg_namespace n
   CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n'::"char", n.nspowner))) a
   WHERE a.grantee = 0 AND ${userSchema("n.nspname")}
     AND NOT (n.nspname = 'public' AND a.privilege_type = 'USAGE')
  UNION ALL
  SELECT n.nspname, c.relname, '表 ' || n.nspname || '.' || c.relname, a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN LATERAL aclexplode(
         coalesce(c.relacl, acldefault(CASE c.relkind WHEN 'S' THEN 's'::"char" ELSE 'r'::"char" END, c.relowner))) a
   WHERE a.grantee = 0 AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') AND ${userSchema("n.nspname")}
  UNION ALL
  SELECT n.nspname, p.proname, '関数 ' || n.nspname || '.' || p.proname, a.privilege_type
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
   WHERE a.grantee = 0 AND ${userSchema("n.nspname")}
  UNION ALL
  SELECT '', NULL, 'データベース ' || d.datname, a.privilege_type
    FROM pg_database d
   CROSS JOIN LATERAL aclexplode(coalesce(d.datacl, acldefault('d'::"char", d.datdba))) a
   WHERE d.datname = current_database() AND a.grantee = 0
     AND a.privilege_type NOT IN ('CONNECT', 'TEMPORARY')`;

/** app_user と auth_service が DDL を実行できず、PUBLIC に余計な権限がない (docs/adr/0025)。 */
async function privileges(pool: Pool): Promise<Violation[]> {
  const where = { check: "privileges" as const };
  const [creates, databaseCreates, owned, publics] = await Promise.all([
    pool.query<{ rolname: string; nspname: string }>(
      `SELECT r.rolname, n.nspname
         FROM pg_roles r CROSS JOIN pg_namespace n
        WHERE r.rolname = ANY($1) AND ${userSchema("n.nspname")}
          AND has_schema_privilege(r.rolname, n.oid, 'CREATE')`,
      [restrictedRoles],
    ),
    pool.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles
        WHERE rolname = ANY($1) AND has_database_privilege(rolname, current_database(), 'CREATE')`,
      [restrictedRoles],
    ),
    pool.query<{ rolname: string; nspname: string; relname: string }>(
      `SELECT r.rolname, n.nspname, c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
        WHERE r.rolname = ANY($1) AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
          AND ${userSchema("n.nspname")}`,
      [restrictedRoles],
    ),
    pool.query<{ schema: string; name: string | null; label: string; privilege: string }>(
      publicGrants,
    ),
  ]);
  return [
    ...creates.rows.map(({ rolname, nspname }) => ({
      ...where,
      schema: nspname,
      message: `${rolname} が ${nspname} スキーマに CREATE できる`,
    })),
    ...databaseCreates.rows.map(({ rolname }) => ({
      ...where,
      schema: "",
      message: `${rolname} がデータベースに CREATE できる`,
    })),
    ...owned.rows.map(({ rolname, nspname, relname }) => ({
      ...where,
      schema: nspname,
      table: relname,
      message: `${rolname} が ${nspname}.${relname} を所有している (所有者は DDL を実行できる)`,
    })),
    ...publics.rows.map(({ schema, name, label, privilege }) => ({
      ...where,
      schema,
      ...(name === null ? {} : { table: name }),
      message: `PUBLIC が ${label} の ${privilege} を持つ`,
    })),
  ];
}

const covers = (exception: ConventionException, violation: Violation) =>
  (exception.scope === violation.schema ||
    exception.scope === `${violation.schema}.${violation.table}`) &&
  (exception.check === "all" || exception.check === violation.check);

/**
 * 規約に反する点を、決めたとおりでない文の一覧で返す。空なら問題がない。
 *
 * 確かめること (出典は docs/db/convention-check.md):
 * 命名 (snake_case、予約語)、共通カラム、型、主キー、外部キー、CHECK 制約、一意制約、RLS、権限。
 * `exceptions` に当たる対象は検査から外す。理由が空の例外は効かず、その例外を失敗として返す。
 * 失敗があるときは、外している検査と理由も、失敗の後ろに付ける。
 *
 * この検査はテスト専用で、migrate や CI の別の段からは呼ばない。migration を流した DB に対する結合テスト
 * (convention-catalog.test.ts) が、毎回これを呼んで問題が空であることを確かめる。
 */
export async function checkConventions(
  pool: Pool,
  exceptions: readonly ConventionException[] = conventionExceptions,
): Promise<string[]> {
  const snap = await snapshot(pool);
  const valid = exceptions.filter((exception) => exception.reason.trim() !== "");
  const unexplained = exceptions
    .filter((exception) => exception.reason.trim() === "")
    .map((exception) => `[exception] 例外 ${exception.scope} の ${exception.check} に理由がない`);

  const violations = [
    ...names(snap),
    ...commonColumnChecks(snap),
    ...columnTypes(snap),
    ...primaryKeys(snap),
    ...forbidden(snap),
    ...rowLevelSecurity(snap),
    ...(await privileges(pool)),
  ].filter((violation) => !valid.some((exception) => covers(exception, violation)));

  const failures = [
    ...unexplained,
    ...violations.map(({ check, message }) => `[${check}] ${message}`),
  ];
  if (failures.length === 0) return [];
  return [
    ...failures,
    ...valid.map(
      ({ scope, check, reason }) => `外している検査: ${scope} の ${check} (理由: ${reason})`,
    ),
  ];
}
