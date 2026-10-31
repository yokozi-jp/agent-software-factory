import type { Queryable } from "./queryable.ts";

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

/** 検査から外す対象。理由が空か、対象がないと、その例外は効かず、検査が失敗を返す。 */
export interface ConventionException {
  /** スキーマ (`auth`) か、表 (`auth.rateLimit`)。 */
  readonly scope: string;
  /** 外す検査。`all` はすべて。 */
  readonly check: ConventionCheck | "all";
  readonly reason: string;
}

const betterAuthReason =
  "Better Auth が生成する表の定義のままにする (docs/adr/0025 の「docs/db の規約の例外」)";

/** 外部キーと UNIQUE 制約を持つ auth の表。Better Auth が生成する定義にある。表を足すときは、ここにも足すか決める。 */
const authTablesWith = {
  "foreign-key": ["session", "account", "member", "invitation"],
  "unique-constraint": ["user", "session", "organization", "rateLimit"],
} as const;

/** 検査の設定。例外を足すときは、理由を書く。 */
export const conventionExceptions: readonly ConventionException[] = [
  // auth: Better Auth の生成物。名前、共通カラム、型、RLS は規約に従えない (docs/adr/0025)。
  { scope: "auth", check: "naming", reason: betterAuthReason },
  { scope: "auth", check: "reserved-word", reason: betterAuthReason },
  { scope: "auth", check: "common-columns", reason: betterAuthReason },
  { scope: "auth", check: "column-types", reason: betterAuthReason },
  {
    scope: "auth",
    check: "row-level-security",
    reason: "auth の表は RLS の対象にしない (docs/adr/0011)",
  },
  // 外部キーと UNIQUE 制約は、Better Auth が生成する表の定義にある。スキーマ全体ではなく、表ごとに外す。
  ...(["foreign-key", "unique-constraint"] as const).flatMap((check) =>
    authTablesWith[check].map((table) => ({
      scope: `auth.${table}`,
      check,
      reason: betterAuthReason,
    })),
  ),
  // migrations: dbmate の履歴の表 (docs/adr/0025)。dbmate が作る定義のままにする。
  { scope: "migrations", check: "all", reason: "dbmate の履歴の表。dbmate が作る定義のままにする" },
];

/** DDL を実行できてはいけないロール (docs/adr/0025)。 */
// outbox_relay はここに入れない。その属性 (SUPERUSER、CREATEROLE、CREATEDB) と権限は、モジュールの検査
// (module-roles-catalog.ts) が確かめる。ロールの属性はクラスタ全体のもので、そのテストが壊した間、この検査が
// 並行して失敗するのを避ける。
const restrictedRoles = ["app_user", "auth_service"];

interface Violation {
  readonly check: ConventionCheck;
  readonly schema: string;
  readonly table?: string;
  readonly message: string;
}

const violation = (
  check: ConventionCheck,
  where: { schema: string; table?: string },
  message: string,
): Violation => ({ check, ...where, message });

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
  /** 配列の要素の型か、ドメインの元の型 (1 段)。どちらでもなければ typname と同じ。 */
  readonly baseTypname: string;
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
  /** 表 (`schema.table`) ごとの列と制約。 */
  columnsOf(table: TableRow): ColumnRow[];
  constraintsOf(table: TableRow, type: ConstraintRow["type"]): ConstraintRow[];
}

// システムのスキーマ (pg_catalog、pg_toast、information_schema) は見ない。
const userSchema = (column: string) => `${column} !~ '^pg_' AND ${column} <> 'information_schema'`;
const userTable = `c.relkind IN ('r', 'p') AND ${userSchema("n.nspname")}`;

const keyOf = ({ schema, table }: { schema: string; table: string }) => `${schema}.${table}`;

function groupByTable<Row extends { schema: string; table: string }>(rows: Row[]) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  return groups;
}

async function snapshot(pool: Queryable): Promise<Snapshot> {
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
              coalesce(CASE WHEN t.typcategory = 'A' THEN et.typname END,
                       CASE WHEN t.typtype = 'd' THEN bt.typname END, t.typname) AS "baseTypname",
              a.attnotnull AS "notNull", a.attidentity AS identity,
              pg_get_expr(d.adbin, d.adrelid) AS "defaultExpr"
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_type t ON t.oid = a.atttypid
         LEFT JOIN pg_type et ON et.oid = t.typelem
         LEFT JOIN pg_type bt ON bt.oid = t.typbasetype
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
    // pg_get_keywords の catcode: R は予約語、T は型名と関数名には使えるが、カラム名には使えない予約語、
    // C はカラム名に使える、U は予約語でない (https://www.postgresql.org/docs/17/functions-info.html)。
    // カラム名に使えない R と T を、予約語とする。
    pool.query<{ word: string }>(`SELECT word FROM pg_get_keywords() WHERE catcode IN ('R', 'T')`),
  ]);
  const columnGroups = groupByTable(columns.rows);
  const constraintGroups = groupByTable(constraints.rows);
  return {
    schemas: schemas.rows.map((row) => row.nspname),
    tables: tables.rows,
    columns: columns.rows,
    constraints: constraints.rows,
    reserved: new Set(keywords.rows.map((row) => row.word)),
    columnsOf: (table) => columnGroups.get(keyOf(table)) ?? [],
    constraintsOf: (table, type) =>
      (constraintGroups.get(keyOf(table)) ?? []).filter((constraint) => constraint.type === type),
  };
}

const snakeCase = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** スキーマ、表、カラムの名前が snake_case で、予約語でない (docs/db/postgresql-naming-physical.md)。 */
function names(snap: Snapshot): Violation[] {
  const identifiers = [
    ...snap.schemas.map((schema) => ({
      where: { schema },
      label: `スキーマ ${schema}`,
      name: schema,
    })),
    ...snap.tables.map(({ schema, table }) => ({
      where: { schema, table },
      label: `表 ${schema}.${table}`,
      name: table,
    })),
    ...snap.columns.map(({ schema, table, column }) => ({
      where: { schema, table },
      label: `カラム ${schema}.${table}.${column}`,
      name: column,
    })),
  ];
  return identifiers.flatMap(({ name, label, where }) => [
    ...(snakeCase.test(name) ? [] : [violation("naming", where, `${label} が snake_case でない`)]),
    ...(snap.reserved.has(name.toLowerCase())
      ? [violation("reserved-word", where, `${label} が予約語`)]
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
  return snap.tables.flatMap((table) =>
    commonColumns.flatMap((spec) => {
      const report = (message: string) => violation("common-columns", table, message);
      const label = `${keyOf(table)} の ${spec.name}`;
      const column = snap.columnsOf(table).find((candidate) => candidate.column === spec.name);
      if (column === undefined) return [report(`${label} がない`)];
      return [
        ...(column.typname === spec.type
          ? []
          : [report(`${label} の型が ${column.typname}。${spec.type} にする`)]),
        ...(column.notNull === spec.notNull
          ? []
          : [report(`${label} が ${spec.notNull ? "NOT NULL でない" : "NULL を許さない"}`)]),
        ...(spec.defaultExpr === undefined || column.defaultExpr === spec.defaultExpr
          ? []
          : [
              report(
                column.defaultExpr === null
                  ? `${label} に既定値がない。${spec.defaultExpr} にする`
                  : `${label} の既定値が ${column.defaultExpr}。${spec.defaultExpr} にする`,
              ),
            ]),
      ];
    }),
  );
}

// 使わない型 (docs/db/postgresql-column.md の「使わない型」)。float8 (double precision) は、浮動小数点が
// 必要なときに使う型として規約が挙げているので、止めない。配列とドメインは、元の型で見る。
const bannedTypes: Readonly<Record<string, string>> = {
  money: "money 型は使わず numeric にする",
  float4: "real 型は使わず、浮動小数点が必要なら double precision にする",
  timestamp: "タイムゾーンなしの timestamp は使わず timestamptz にする",
};

/** serial、money、real、タイムゾーンなしの timestamp を使わない。連番は bigint の IDENTITY。 */
function columnTypes(snap: Snapshot): Violation[] {
  return snap.columns.flatMap((col) => {
    const report = (message: string) =>
      violation("column-types", col, `${keyOf(col)}.${col.column}: ${message}`);
    const banned = bannedTypes[col.baseTypname];
    return [
      ...(banned === undefined ? [] : [report(banned)]),
      ...(col.identity === "" && col.defaultExpr?.startsWith("nextval(") === true
        ? [report("serial は使わず bigint の IDENTITY にする")]
        : []),
      ...(col.identity !== "" && col.typname !== "int8"
        ? [report(`IDENTITY 列は bigint にする (${col.typname})`)]
        : []),
    ];
  });
}

/** 主キーがあり、複合の主キーが tenant_id で始まる (複合の主キーは docs/adr/0011。主キーがあることは Issue #361 の判断)。 */
function primaryKeys(snap: Snapshot): Violation[] {
  return snap.tables.flatMap((table) => {
    const report = (message: string) => violation("primary-key", table, message);
    const [key] = snap.constraintsOf(table, "p");
    if (key === undefined) return [report(`${keyOf(table)} に主キーがない`)];
    return key.columns.length > 1 && key.columns[0] !== "tenant_id"
      ? [
          report(
            `${keyOf(table)} の複合の主キー (${key.columns.join(", ")}) が tenant_id で始まらない`,
          ),
        ]
      : [];
  });
}

// 外部キー、CHECK 制約、UNIQUE 制約を使わない (docs/db/postgresql-constraints.md)。
// スキーマをまたぐ外部キーは、モジュールの検査 (module-roles-catalog.ts、docs/adr/0029) も止める。
// あちらは例外で外せないので、この検査の例外でスキーマ内の外部キーを許しても、またぐものは止まる。
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
    snap.tables.flatMap((table) =>
      snap
        .constraintsOf(table, type)
        .map(({ name }) =>
          violation(check, table, `${keyOf(table)} に ${what} ${name} がある${instead}`),
        ),
    ),
  );
}

/** tenant_id を持つ表が、RLS を ENABLE と FORCE にしている (docs/adr/0011)。 */
function rowLevelSecurity(snap: Snapshot): Violation[] {
  return snap.tables
    .filter((table) => snap.columnsOf(table).some((column) => column.column === "tenant_id"))
    .flatMap((table) => {
      const report = (message: string) => violation("row-level-security", table, message);
      return [
        ...(table.rls ? [] : [report(`${keyOf(table)} が RLS を ENABLE にしていない`)]),
        ...(table.forceRls ? [] : [report(`${keyOf(table)} が RLS を FORCE にしていない`)]),
      ];
    });
}

// PUBLIC の権限は、PostgreSQL の既定を引いて数える。ACL が NULL のときは既定の権限で、所有者の全権限と、
// 型によっては PUBLIC の権限がある (https://www.postgresql.org/docs/17/ddl-priv.html)。
// 次は既定で PUBLIC にあるので許す。データベースの CONNECT と TEMPORARY。public スキーマの USAGE
// (https://www.postgresql.org/docs/17/ddl-schemas.html の「Schemas and Privileges」)。
// 関数の EXECUTE も既定で PUBLIC にあるが、許さない。モジュールのスキーマの関数は REVOKE する。
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

/**
 * app_user と auth_service が DDL を実行できず、PUBLIC に余計な権限がない (docs/adr/0025)。
 * DDL を実行できるのは、スキーマかデータベースに CREATE できるロール、オブジェクトの所有者 (所有者のメンバーで
 * 権限を継承するロールを含む)、superuser、CREATEROLE、CREATEDB を持つロール。
 */
async function privileges(pool: Queryable): Promise<Violation[]> {
  const report = (where: { schema: string; table?: string }, message: string) =>
    violation("privileges", where, message);
  const [attributes, inherited, creates, databaseCreates, owned, publics] = await Promise.all([
    pool.query<{ rolname: string; attribute: string }>(
      `SELECT r.rolname, a.attribute
         FROM pg_roles r
        CROSS JOIN LATERAL (VALUES ('SUPERUSER', r.rolsuper), ('CREATEROLE', r.rolcreaterole),
                                   ('CREATEDB', r.rolcreatedb)) AS a(attribute, has)
        WHERE r.rolname = ANY($1) AND a.has`,
      [restrictedRoles],
    ),
    // モジュールのロールへの INHERIT は、ここでは見ない。app_user が INHERIT FALSE、SET TRUE で入っていることは、
    // モジュールの検査 (module-roles-catalog.ts) が確かめる。ロールのメンバーシップはクラスタ全体のもので、
    // そのテストが INHERIT TRUE にした間、この検査が並行して失敗するのを避ける。
    pool.query<{ rolname: string; roleName: string }>(
      `SELECT mr.rolname, gr.rolname AS "roleName"
         FROM pg_auth_members m
         JOIN pg_roles mr ON mr.oid = m.member JOIN pg_roles gr ON gr.oid = m.roleid
        WHERE mr.rolname = ANY($1) AND m.inherit_option
          AND gr.rolname !~ '_module$'`,
      [restrictedRoles],
    ),
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
          AND ${userSchema("n.nspname")}
       UNION ALL
       SELECT r.rolname, n.nspname, p.proname
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles r ON r.oid = p.proowner
        WHERE r.rolname = ANY($1) AND ${userSchema("n.nspname")}`,
      [restrictedRoles],
    ),
    pool.query<{ schema: string; name: string | null; label: string; privilege: string }>(
      publicGrants,
    ),
  ]);
  return [
    ...attributes.rows.map(({ rolname, attribute }) =>
      report({ schema: "" }, `${rolname} が ${attribute} を持つ`),
    ),
    ...inherited.rows.map(({ rolname, roleName }) =>
      report({ schema: "" }, `${rolname} が ${roleName} の権限を継承している`),
    ),
    ...creates.rows.map(({ rolname, nspname }) =>
      report({ schema: nspname }, `${rolname} が ${nspname} スキーマに CREATE できる`),
    ),
    ...databaseCreates.rows.map(({ rolname }) =>
      report({ schema: "" }, `${rolname} がデータベースに CREATE できる`),
    ),
    ...owned.rows.map(({ rolname, nspname, relname }) =>
      report(
        { schema: nspname, table: relname },
        `${rolname} が ${nspname}.${relname} を所有している (所有者は DDL を実行できる)`,
      ),
    ),
    ...publics.rows.map(({ schema, name, label, privilege }) =>
      report(
        name === null ? { schema } : { schema, table: name },
        `PUBLIC が ${label} の ${privilege} を持つ`,
      ),
    ),
  ];
}

const covers = (exception: ConventionException, found: Violation) =>
  (exception.scope === found.schema ||
    (found.table !== undefined && exception.scope === `${found.schema}.${found.table}`)) &&
  (exception.check === "all" || exception.check === found.check);

/**
 * 規約に反する点を、決めたとおりでない文の一覧で返す。空なら問題がない。
 *
 * 確かめること (出典は docs/db/convention-check.md):
 * 命名 (snake_case、予約語)、共通カラム、型、主キー、外部キー、CHECK 制約、一意制約、RLS、権限。
 * `exceptions` に当たる対象は検査から外す。理由が空の例外と、対象のスキーマか表がない例外は効かず、
 * その例外を失敗として返す (消えた表の例外が残り続けないようにする)。
 * 失敗があるときは、外している検査と理由も、失敗の後ろに付ける。
 *
 * この検査はテスト専用で、migrate や CI の別の段からは呼ばない。migration を流した DB に対する結合テスト
 * (convention-catalog.test.ts) が、毎回これを呼んで問題が空であることを確かめる。
 */
export async function checkConventions(
  pool: Queryable,
  exceptions: readonly ConventionException[] = conventionExceptions,
): Promise<string[]> {
  const snap = await snapshot(pool);
  const targets = new Set([...snap.schemas, ...snap.tables.map(keyOf)]);
  const invalid = exceptions.flatMap(({ scope, check, reason }) => [
    ...(reason.trim() === "" ? [`[exception] 例外 ${scope} の ${check} に理由がない`] : []),
    ...(targets.has(scope) ? [] : [`[exception] 例外 ${scope} の ${check} の対象がない`]),
  ]);
  const effective = exceptions.filter(
    ({ scope, reason }) => reason.trim() !== "" && targets.has(scope),
  );

  const violations = [
    ...names(snap),
    ...commonColumnChecks(snap),
    ...columnTypes(snap),
    ...primaryKeys(snap),
    ...forbidden(snap),
    ...rowLevelSecurity(snap),
    ...(await privileges(pool)),
  ].filter((found) => !effective.some((exception) => covers(exception, found)));

  const failures = [...invalid, ...violations.map(({ check, message }) => `[${check}] ${message}`)];
  if (failures.length === 0) return [];
  return [
    ...failures,
    ...effective.map(
      ({ scope, check, reason }) => `外している検査: ${scope} の ${check} (理由: ${reason})`,
    ),
  ];
}
