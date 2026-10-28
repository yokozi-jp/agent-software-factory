import { describe, expect, it } from "vite-plus/test";
import { parsePrePush, pushedTips } from "./pre-push.ts";

const zero = "0".repeat(40);
const a = "a".repeat(40);
const b = "b".repeat(40);

describe("parsePrePush", () => {
  it("reads the four fields of each ref that git passes to pre-push", () => {
    expect(parsePrePush(`refs/heads/x ${a} refs/heads/y ${b}\n`)).toEqual([
      {
        localRef: "refs/heads/x",
        localSha: a,
        remoteRef: "refs/heads/y",
        remoteSha: b,
        deleted: false,
        created: false,
      },
    ]);
  });

  it("marks a deleted ref (local object name all zeros) and a new ref (remote object name all zeros)", () => {
    const [deleted, created] = parsePrePush(
      `(delete) ${zero} refs/heads/x ${a}\nrefs/heads/y ${b} refs/heads/z ${zero}\n`,
    );
    expect(deleted).toMatchObject({ deleted: true, created: false });
    expect(created).toMatchObject({ deleted: false, created: true });
  });

  it("treats an object name as zero only when every character is zero", () => {
    expect(parsePrePush(`r ${"0".repeat(63)}1 r ${zero}`)[0]).toMatchObject({ deleted: false });
    expect(parsePrePush(`r ${"0".repeat(64)} r ${a}`)[0]).toMatchObject({ deleted: true });
    expect(parsePrePush(`r ${a} r 1${"0".repeat(39)}`)[0]).toMatchObject({ created: false });
  });

  it("skips a line that does not have exactly four fields, and empty input", () => {
    expect(parsePrePush("")).toEqual([]);
    expect(parsePrePush("\n\n")).toEqual([]);
    expect(parsePrePush(`r ${a} r\nr ${a} r ${zero} x\n`)).toEqual([]);
  });
});

describe("pushedTips", () => {
  it("takes the local object name of each ref that is pushed", () => {
    const stdin = `refs/heads/x ${a} refs/heads/x ${zero}\nrefs/heads/y ${b} refs/heads/y ${a}\n`;
    expect(pushedTips(stdin)).toEqual([a, b]);
  });

  it("skips a deleted ref: there is nothing to compare", () => {
    expect(pushedTips(`(delete) ${zero} refs/heads/x ${a}\n`)).toEqual([]);
  });

  it("reads nothing from empty input", () => {
    expect(pushedTips("")).toEqual([]);
  });
});
