import { describe, expect, it } from "vite-plus/test";
import { isObject, objects } from "./json.ts";

describe("isObject", () => {
  it("is true for an object only", () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
    for (const value of [null, undefined, [], [{}], "x", 1, true])
      expect(isObject(value)).toBe(false);
  });
});

describe("objects", () => {
  it("keeps the objects of an array", () => {
    expect(objects([{ a: 1 }, null, "x", [], 2, { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("is empty for anything else", () => {
    for (const value of [undefined, null, {}, "x", 1]) expect(objects(value)).toEqual([]);
  });
});
