import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { appOrigin, createAuthFixture, type AuthFixture } from "../test/auth-fixtures.ts";
import type { TestBrowser } from "../test/browser.ts";

// 申請のモジュールの最初の route、POST /api/claims (Issue #554、docs/adr/0026)。モジュールの sub-app が apps/api の app に付き、
// セッションからテナントと操作する人を読み、冪等キーと同じトランザクションで下書きを 1 行書くことを、本物の PostgreSQL で確かめる。
const keyA = '"33333333-3333-4333-8333-333333333333"';
const keyB = '"44444444-4444-4444-8444-444444444444"';

describe("下書きを作る (POST /api/claims)", () => {
  let fixture: AuthFixture;

  beforeAll(async () => {
    fixture = await createAuthFixture();
  });

  afterAll(async () => {
    await fixture.close();
  });

  const post = (browser: TestBrowser, key: string | undefined, path = "/api/claims") =>
    browser.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: appOrigin,
        ...(key === undefined ? {} : { "idempotency-key": key }),
      },
    });

  const claimRows = async () =>
    (
      await fixture.db.superuser.query<{
        claim_id: string;
        tenant_id: string;
        applicant_id: string;
        status_typ: string;
        created_by: string;
        created_pgm_cd: string;
        created_tx_id: string;
      }>(
        // 出力の列 claim_id (文字列) ではなく、表の列で並べる (ORDER BY は出力の列の名前を先に探す)。
        `SELECT c.claim_id::text AS claim_id, c.tenant_id, c.applicant_id, c.status_typ, c.created_by, c.created_pgm_cd, c.created_tx_id
           FROM claim.t_claim c WHERE c.created_pgm_cd = 'claim.create-claim' ORDER BY c.claim_id`,
      )
    ).rows;

  /** 利用者のセッションの active organization (テナント) の id。 */
  const tenantIdOf = async (browser: TestBrowser) =>
    (
      await fixture.db.superuser.query<{ tenant: string }>(
        'SELECT "activeOrganizationId" AS tenant FROM auth."session" WHERE "userId" = $1',
        [await userIdOf(browser)],
      )
    ).rows[0]?.tenant;

  const userIdOf = async (browser: TestBrowser) => {
    const me: unknown = await (await browser.request("/api/me")).json();
    if (typeof me !== "object" || me === null || !("id" in me) || typeof me.id !== "string")
      throw new Error("/api/me did not return an id");
    return me.id;
  };

  it("セッションのテナントと利用者の下書きを 1 行書き、201 で id と状態を返すこと", async () => {
    const browser = await fixture.signedIn({ tenant: true });
    const before = await claimRows();

    const res = await post(browser, keyA);

    expect(res.status).toBe(201);
    const created = z
      .object({ id: z.string(), status: z.literal("draft") })
      .strict()
      .parse(await res.json());
    expect(created.id).toMatch(/^[1-9][0-9]*$/);
    const rows = (await claimRows()).slice(before.length);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      claim_id: created.id,
      tenant_id: await tenantIdOf(browser),
      applicant_id: await userIdOf(browser),
      status_typ: "00",
      created_by: await userIdOf(browser),
      created_pgm_cd: "claim.create-claim",
    });
  });

  it("同じキーで同じ要求を送り直すと、同じ応答を返し、行を増やさないこと", async () => {
    const browser = await fixture.signedIn({ tenant: true });
    const before = (await claimRows()).length;

    const first = await post(browser, keyA);
    const retried = await post(browser, keyA);

    expect(retried.status).toBe(201);
    expect(await retried.json()).toEqual(await first.json());
    expect((await claimRows()).length - before).toBe(1);
  });

  it("別のキーなら、別の下書きを作ること", async () => {
    const browser = await fixture.signedIn({ tenant: true });
    const before = (await claimRows()).length;

    const first = await post(browser, keyA);
    const second = await post(browser, keyB);

    expect(await first.json()).not.toEqual(await second.json());
    expect((await claimRows()).length - before).toBe(2);
  });

  it("同じキーで別の要求を送ると、400 の idempotency-payload-mismatch で、行を増やさないこと", async () => {
    const browser = await fixture.signedIn({ tenant: true });
    await post(browser, keyA);
    const before = (await claimRows()).length;

    const res = await post(browser, keyA, "/api/claims?other=1");

    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ type: "/problems/idempotency-payload-mismatch" });
    expect((await claimRows()).length).toBe(before);
  });

  it("Idempotency-Key がなければ、400 の idempotency-key-missing で、行を書かないこと", async () => {
    const browser = await fixture.signedIn({ tenant: true });
    const before = (await claimRows()).length;

    const res = await post(browser, undefined);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ type: "/problems/idempotency-key-missing" });
    expect((await claimRows()).length).toBe(before);
  });

  it("セッションがなければ、401 で、行を書かないこと", async () => {
    const before = (await claimRows()).length;

    const res = await post(fixture.newBrowser(), keyA);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ type: "/problems/unauthenticated" });
    expect((await claimRows()).length).toBe(before);
  });

  it("テナントを持たない利用者には、403 の no-tenant を返し、行を書かないこと", async () => {
    const browser = await fixture.signedIn();
    const before = (await claimRows()).length;

    const res = await post(browser, keyA);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ type: "/problems/no-tenant" });
    expect((await claimRows()).length).toBe(before);
  });

  it("クライアントが送るテナントの値を使わず、セッションのテナントに書くこと", async () => {
    const browser = await fixture.signedIn({ tenant: true });
    const before = (await claimRows()).length;

    const res = await browser.request("/api/claims", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: appOrigin,
        "idempotency-key": keyA,
        "x-tenant-id": "00000000-0000-4000-8000-0000000000ff",
      },
    });

    expect(res.status).toBe(201);
    const rows = (await claimRows()).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenant_id).toBe(await tenantIdOf(browser));
    expect(rows[0]?.tenant_id).not.toBe("00000000-0000-4000-8000-0000000000ff");
  });

  it("別の利用者が同じキーを使っても、前の利用者の応答を返さず、自分の下書きを作ること", async () => {
    const owner = await fixture.signedIn({ tenant: true });
    const other = await fixture.signedIn({ tenant: true });
    const before = (await claimRows()).length;

    const first = await post(owner, keyA);
    const second = await post(other, keyA);

    expect(second.status).toBe(201);
    expect(await second.json()).not.toEqual(await first.json());
    const rows = (await claimRows()).slice(before);
    expect(rows.map((row) => row.applicant_id).toSorted()).toEqual(
      [await userIdOf(owner), await userIdOf(other)].toSorted(),
    );
    expect(new Set(rows.map((row) => row.tenant_id)).size).toBe(2);
  });

  it("テナントを使わない /api/me は、テナントがなくても 200 を返すこと", async () => {
    const browser = await fixture.signedIn();

    expect((await browser.request("/api/me")).status).toBe(200);
  });
});
