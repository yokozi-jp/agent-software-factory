import { describe, expect, it } from "vite-plus/test";
import { isObject, objects } from "./json.ts";

describe("isObject", () => {
  it("オブジェクトのときだけ true になること", () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
    for (const value of [null, undefined, [], [{}], "x", 1, true])
      expect(isObject(value)).toBe(false);
  });
});

describe("objects", () => {
  it("配列のオブジェクトを残すこと", () => {
    expect(objects([{ a: 1 }, null, "x", [], 2, { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("それ以外では空になること", () => {
    for (const value of [undefined, null, {}, "x", 1]) expect(objects(value)).toEqual([]);
  });
});
