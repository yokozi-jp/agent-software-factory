import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import committed from "../openapi.json" with { type: "json" };
import { createAuthFixture, type AuthFixture } from "../test/auth-fixtures.ts";
import {
  extractIdOperations,
  findBolaViolations,
  type Employee,
  type IdOperationKeys,
  type ResourceContext,
  type ResourceFactory,
} from "../test/bola.ts";
import { addNoteRoutes, createNote, type Leak } from "../test/bola-fixtures.ts";

// 他人のリソースの id で読めないこと (OWASP API Security Top 10 2023 の API1 BOLA、docs/adr/0045)。
// commit した spec のパスに id を持つ操作はすべて、ここで 404 になることを確かめる対象になる。
//
// route を足したとき: `pnpm --filter api openapi` で spec を更新すると、下の `factories` の型が操作の名前を要求する。
// 持ち主のリソースを作る関数を足す (404 でなくてよい操作は、理由を付けて `exceptions` に書く)。

/** 操作から、持ち主のリソースを作る関数への対応表。キーは spec の操作の名前で、足し忘れは型の検査が止める。 */
const factories: Record<IdOperationKeys<typeof committed>, ResourceFactory> = {};

/** 404 でなくてよい操作と、その理由。 */
const exceptions: Record<string, string> = {};

async function employee(fixture: AuthFixture, email: string): Promise<Employee> {
  const browser = await fixture.signedIn({ email });
  const me: unknown = await (await browser.request("/api/me")).json();
  if (typeof me !== "object" || me === null || !("id" in me) || typeof me.id !== "string") {
    throw new Error("/api/me が利用者の id を返さなかった");
  }
  return { browser, userId: me.id };
}

async function twoEmployees(fixture: AuthFixture): Promise<ResourceContext> {
  return {
    owner: await employee(fixture, "owner@example.com"),
    other: await employee(fixture, "other@example.com"),
    superuser: fixture.db.superuser,
  };
}

describe("commit した spec の、パスに id を持つ操作", () => {
  let fixture: AuthFixture;
  let people: ResourceContext;

  beforeAll(async () => {
    fixture = await createAuthFixture();
    people = await twoEmployees(fixture);
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("すべてが、他人のリソースの id で 404 の Problem Details を返し、DB の行を変えないこと", async () => {
    const violations = await findBolaViolations({
      spec: committed,
      context: people,
      factories,
      exceptions,
    });

    expect(violations).toEqual([]);
  });

  it("例外の一覧の操作が、すべて spec にあること", () => {
    const operations: string[] = extractIdOperations(committed);

    expect(Object.keys(exceptions).filter((key) => !operations.includes(key))).toEqual([]);
  });

  it("リソースを作る関数の対応表の操作が、すべて spec にあること", () => {
    const operations: string[] = extractIdOperations(committed);

    expect(Object.keys(factories).filter((key) => !operations.includes(key))).toEqual([]);
  });
});

describe("検出力: id を持つ route (fixture) に対するテスト", () => {
  async function run(
    leak: Leak,
    overrides: {
      factories?: Record<string, ResourceFactory>;
      exceptions?: Record<string, string>;
    } = {},
  ) {
    const fixture = await createAuthFixture();
    try {
      await addNoteRoutes(fixture.app, fixture.db, leak);
      const spec = fixture.app.getOpenAPI31Document({
        openapi: "3.1.0",
        info: { title: "fixture", version: "0.0.0" },
      });
      return await findBolaViolations({
        spec,
        context: await twoEmployees(fixture),
        factories: overrides.factories ?? {
          "GET /api/notes/{id}": createNote,
          "PUT /api/notes/{id}": createNote,
        },
        exceptions: overrides.exceptions ?? {},
      });
    } finally {
      await fixture.close();
    }
  }

  it("持ち主で絞り込んだ route は、違反にならないこと", async () => {
    expect(await run("none")).toEqual([]);
  });

  it("絞り込みを外した GET は、違反になること", async () => {
    const violations = await run("read");

    expect(violations).toEqual([
      "GET /api/notes/{id}: 他人のリソースへの応答が 200 (404 であるべき)",
    ]);
  });

  it("404 を返しても他人の行を書き換える PUT は、違反になること", async () => {
    const violations = await run("write");

    expect(violations).toEqual([
      "PUT /api/notes/{id}: 他人のリソースへの書き込みで DB の行が変わった",
    ]);
  });

  it("リソースを作る関数がない操作は、違反になること", async () => {
    const violations = await run("none", { factories: { "GET /api/notes/{id}": createNote } });

    expect(violations).toEqual([
      "PUT /api/notes/{id}: リソースを作る関数がない (factories に足すか、理由を付けて exceptions に書く)",
    ]);
  });

  it("例外の一覧にある操作は、確かめないこと", async () => {
    const violations = await run("read", {
      factories: { "PUT /api/notes/{id}": createNote },
      exceptions: { "GET /api/notes/{id}": "公開のメモで、誰でも読める" },
    });

    expect(violations).toEqual([]);
  });

  it("spec にない操作が例外の一覧にあると、違反になること", async () => {
    const violations = await run("none", {
      exceptions: { "DELETE /api/notes/{id}": "消えた操作" },
    });

    expect(violations).toEqual(["DELETE /api/notes/{id}: 例外の一覧にあるが、spec にない操作"]);
  });
});
