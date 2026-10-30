import { z } from "zod";
import { describe, expect, it } from "vite-plus/test";
import { defineEvent, eventFixtureProblems } from "./event.ts";

const submitted = defineEvent("claim.submitted", 2, {
  claimId: z.uuid(),
  total: z.int(),
  note: z.string().optional(),
});

const id = "0198f6e0-0000-7000-8000-000000000001";
const v1 = {
  id,
  tenantId: id,
  kind: "claim.submitted",
  version: 1,
  occurredAt: "2026-10-30T01:02:03.000Z",
  claimId: id,
  total: 1200,
};
const v2 = { ...v1, version: 2, note: "出張" };
const files = {
  "./fixtures/claim.submitted.v1.json": v1,
  "./fixtures/claim.submitted.v2.json": v2,
};

describe("defineEvent", () => {
  it("共通の項目と、足した項目を持つ型を導く", () => {
    const parsed = submitted.schema.parse(v1);
    expect(parsed).toEqual(v1);
  });

  it("知らない項目は捨てる（古い受け手が新しい版を読める）", () => {
    expect(submitted.schema.parse({ ...v2, addedLater: true })).toEqual(v2);
  });

  it.each([
    ["種類が違う", { ...v1, kind: "claim.withdrawn" }],
    ["版が 0", { ...v1, version: 0 }],
    ["起きた瞬間にミリ秒がない", { ...v1, occurredAt: "2026-10-30T01:02:03Z" }],
    ["tenantId が uuid でない", { ...v1, tenantId: "t1" }],
  ])("共通の項目が合わなければ拒む: %s", (_, message) => {
    expect(submitted.schema.safeParse(message).success).toBe(false);
  });
});

describe("eventFixtureProblems", () => {
  it("今の版までの fixture をすべて受け入れれば、問題はない", () => {
    expect(eventFixtureProblems([submitted], files)).toEqual([]);
  });

  it("過去の版から項目を削除すると、その fixture が落ちる", () => {
    const { total: _removed, ...withoutTotal } = v1;
    expect(
      eventFixtureProblems([submitted], {
        ...files,
        "./fixtures/claim.submitted.v1.json": withoutTotal,
      }),
    ).toEqual([
      "claim.submitted.v1.json: total: Invalid input: expected number, received undefined",
    ]);
  });

  it("過去の版の項目の型を変えると、その fixture が落ちる", () => {
    expect(
      eventFixtureProblems([submitted], {
        ...files,
        "./fixtures/claim.submitted.v1.json": { ...v1, total: "1200" },
      }),
    ).toEqual(["claim.submitted.v1.json: total: Invalid input: expected number, received string"]);
  });

  it("今の版の fixture がなければ、足すよう求める", () => {
    expect(eventFixtureProblems([submitted], { "./fixtures/claim.submitted.v1.json": v1 })).toEqual(
      ["claim.submitted has no fixture for its current version 2: add claim.submitted.v2.json"],
    );
  });

  it("名前の版と中身の版が違う fixture を拒む", () => {
    expect(
      eventFixtureProblems([submitted], {
        ...files,
        "./fixtures/claim.submitted.v1.json": { ...v1, version: 2 },
      }),
    ).toEqual(["claim.submitted.v1.json: the name says version 1 but the message has version 2"]);
  });

  it("知らない種類と、形式の違う名前を拒む", () => {
    expect(
      eventFixtureProblems([submitted], {
        ...files,
        "./fixtures/claim.gone.v1.json": v1,
        "./fixtures/notes.json": {},
      }),
    ).toEqual([
      "claim.gone.v1.json: no event of this kind is exported",
      "notes.json: the name must be <kind>.v<version>.json",
    ]);
  });
});
