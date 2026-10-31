import type { Pool } from "pg";

import { appOrigin } from "./auth-fixtures.ts";
import type { TestBrowser } from "./browser.ts";

// BOLA (OWASP API Security Top 10 2023 の API1) のテストの仕組み (docs/adr/0045)。
// OpenAPI の spec から「パスに id を持つ操作」をすべて取り出し、1 人目の社員が作ったリソースの id を 2 人目の社員で叩いて、
// 404 の Problem Details が返り、DB の行が変わらないことを確かめる。route を足すと自動で対象に入る。

const methodNames = {
  get: "GET",
  put: "PUT",
  post: "POST",
  delete: "DELETE",
  options: "OPTIONS",
  head: "HEAD",
  patch: "PATCH",
  trace: "TRACE",
} as const;
type HttpMethod = keyof typeof methodNames;

/** 操作の名前。`GET /api/notes/{id}` のように、大文字の method と spec のパスの書き方をそのまま使う。 */
export type OperationKey = `${Uppercase<HttpMethod>} ${string}`;

/** spec のうち、このテストが読む部分。 */
export interface OpenApiPaths {
  readonly paths?: Readonly<Record<string, unknown>> | undefined;
}

/** commit した spec の型から、パスに id を持つ操作の名前の union を作る。id を持つ route がなければ `never`。 */
export type IdOperationKeys<Spec extends { readonly paths: object }> = {
  [Path in Extract<keyof Spec["paths"], `${string}{${string}}${string}`>]: {
    [Method in Extract<keyof Spec["paths"][Path], HttpMethod>]: `${Uppercase<Method>} ${Path}`;
  }[Extract<keyof Spec["paths"][Path], HttpMethod>];
}[Extract<keyof Spec["paths"], `${string}{${string}}${string}`>];

/** パスに `{id}` のような path parameter を持つ操作を、spec に書かれた順に取り出す。 */
export function extractIdOperations(spec: OpenApiPaths): OperationKey[] {
  const operations: OperationKey[] = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (!/\{[^}]+\}/.test(path) || typeof item !== "object" || item === null) continue;
    for (const [method, label] of Object.entries(methodNames)) {
      if (method in item) operations.push(`${label} ${path}`);
    }
  }
  return operations;
}

/** 社員 1 人。`userId` はセッションの利用者の id で、リソースの持ち主の値に使う。 */
export interface Employee {
  readonly browser: TestBrowser;
  readonly userId: string;
}

export interface ResourceContext {
  /** リソースの持ち主。 */
  readonly owner: Employee;
  /** 同じテナントの別の社員。リソースの持ち主ではない。 */
  readonly other: Employee;
  /** superuser の接続。RLS を通らないので、リソースの行を直接作れる。 */
  readonly superuser: Pool;
}

/** 持ち主のリソースを作り、2 人目が叩く要求の部品を返す。 */
interface CreatedResource {
  /** パスの `{name}` に入れる値。 */
  readonly params: Readonly<Record<string, string>>;
  /** 書き込みの操作の本文。検証で 400 にならない値にする。 */
  readonly body?: unknown;
}
export type ResourceFactory = (context: ResourceContext) => Promise<CreatedResource>;

export interface BolaInput {
  readonly spec: OpenApiPaths;
  readonly context: ResourceContext;
  /** 操作ごとに、持ち主のリソースを作る関数。対応がない操作は違反になる。 */
  readonly factories: Readonly<Record<string, ResourceFactory>>;
  /** 404 でなくてよい操作と、その理由。spec にない操作が書いてあると違反になる。 */
  readonly exceptions: Readonly<Record<string, string>>;
}

/** 違反の説明を返す。空なら、id を持つ操作のすべてが他人のリソースを隠している。 */
export async function findBolaViolations({
  spec,
  context,
  factories,
  exceptions,
}: BolaInput): Promise<string[]> {
  const operations = extractIdOperations(spec);
  const violations: string[] = [];

  for (const [key, reason] of Object.entries(exceptions)) {
    if (reason.trim() === "") violations.push(`${key}: 例外の理由が空`);
    if (!(operations as string[]).includes(key)) {
      violations.push(`${key}: 例外の一覧にあるが、spec にない操作`);
    }
  }

  for (const key of operations) {
    if (key in exceptions) continue;
    const factory = factories[key];
    if (factory === undefined) {
      violations.push(
        `${key}: リソースを作る関数がない (factories に足すか、理由を付けて exceptions に書く)`,
      );
      continue;
    }
    violations.push(...(await checkOperation({ context, key, factory })));
  }
  return violations;
}

async function checkOperation({
  context,
  key,
  factory,
}: {
  context: ResourceContext;
  key: OperationKey;
  factory: ResourceFactory;
}): Promise<string[]> {
  const [method = "", template = ""] = key.split(" ");
  const created = await factory(context);
  const path = template.replaceAll(/\{([^}]+)\}/g, (_, name: string) =>
    encodeURIComponent(created.params[name] ?? ""),
  );
  const missing = [...template.matchAll(/\{([^}]+)\}/g)]
    .map((match) => match[1] ?? "")
    .filter((name) => created.params[name] === undefined);
  if (missing.length > 0)
    return [`${key}: 作る関数が path parameter ${missing.join(", ")} を返していない`];

  const isWrite = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  const before = isWrite ? await dumpRows(context.superuser) : undefined;

  const response = await context.other.browser.request(path, {
    method,
    headers: { origin: appOrigin, "content-type": "application/json" },
    ...(created.body === undefined || !isWrite ? {} : { body: JSON.stringify(created.body) }),
  });
  const violations: string[] = [];
  if (response.status !== 404) {
    violations.push(`${key}: 他人のリソースへの応答が ${response.status} (404 であるべき)`);
  } else {
    const problem = await readProblem(response);
    if (problem !== undefined)
      violations.push(`${key}: 404 が Problem Details でない (${problem})`);
  }
  if (before !== undefined && before !== (await dumpRows(context.superuser))) {
    violations.push(`${key}: 他人のリソースへの書き込みで DB の行が変わった`);
  }
  return violations;
}

/** Problem Details (ADR 0035) でなければ、その理由を返す。 */
async function readProblem(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/problem+json"))
    return `Content-Type が ${contentType || "なし"}`;
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null) return "本文が object でない";
  if (
    !("type" in body && typeof body.type === "string") ||
    !("title" in body && typeof body.title === "string") ||
    !("status" in body && body.status === 404)
  ) {
    return "type、title、status (404) がそろっていない";
  }
  return undefined;
}

// 数えないスキーマ。Better Auth の表と dbmate の履歴は、リソースの処理では変わるべきでない行ではない (セッションは要求のたびに更新される)。
const excludedSchemas = ["pg_catalog", "information_schema", "pg_toast", "auth", "migrations"];

/**
 * 全表の全行を 1 つの文字列にする。`pool` は superuser の接続にする (RLS を通らず、全テナントの行が読める)。
 * 行数でなく中身を比べるので、既存の行の更新も差に出る。
 */
async function dumpRows(pool: Pool): Promise<string> {
  const { rows: tables } = await pool.query<{ schema: string; name: string }>(
    `SELECT n.nspname AS schema, c.relname AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relpersistence <> 't'
        AND n.nspname <> ALL ($1::text[])
        AND n.nspname NOT LIKE 'pg\\_temp\\_%' AND n.nspname NOT LIKE 'pg\\_toast\\_temp\\_%'
      ORDER BY 1, 2`,
    [excludedSchemas],
  );
  const dumps: string[] = [];
  for (const { schema, name } of tables) {
    const { rows } = await pool.query<{ dump: string }>(
      `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]')::text AS dump FROM "${schema}"."${name}" t`,
    );
    dumps.push(`${schema}.${name}=${rows[0]?.dump ?? ""}`);
  }
  return dumps.join("\n");
}
