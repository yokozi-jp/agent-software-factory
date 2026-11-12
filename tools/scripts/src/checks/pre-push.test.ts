import { describe, expect, it } from "vite-plus/test";
import { parsePrePush, pushedTips } from "./pre-push.ts";

const zero = "0".repeat(40);
const a = "a".repeat(40);
const b = "b".repeat(40);

describe("parsePrePush", () => {
  it("git が pre-push に渡す各 ref の 4 つの項目を読むこと", () => {
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

  it("削除された ref (local の object 名がすべて 0) と新しい ref (remote の object 名がすべて 0) を印付けること", () => {
    const [deleted, created] = parsePrePush(
      `(delete) ${zero} refs/heads/x ${a}\nrefs/heads/y ${b} refs/heads/z ${zero}\n`,
    );
    expect(deleted).toMatchObject({ deleted: true, created: false });
    expect(created).toMatchObject({ deleted: false, created: true });
  });

  it("すべての文字が 0 のときだけ、object 名を 0 とみなすこと", () => {
    expect(parsePrePush(`r ${"0".repeat(63)}1 r ${zero}`)[0]).toMatchObject({ deleted: false });
    expect(parsePrePush(`r ${"0".repeat(64)} r ${a}`)[0]).toMatchObject({ deleted: true });
    expect(parsePrePush(`r ${a} r 1${"0".repeat(39)}`)[0]).toMatchObject({ created: false });
  });

  it("項目がちょうど 4 つではない行と、空の入力を読み飛ばすこと", () => {
    expect(parsePrePush("")).toEqual([]);
    expect(parsePrePush("\n\n")).toEqual([]);
    expect(parsePrePush(`r ${a} r\nr ${a} r ${zero} x\n`)).toEqual([]);
  });
});

describe("pushedTips", () => {
  it("push する各 ref の local の object 名を採ること", () => {
    const stdin = `refs/heads/x ${a} refs/heads/x ${zero}\nrefs/heads/y ${b} refs/heads/y ${a}\n`;
    expect(pushedTips(stdin)).toEqual([a, b]);
  });

  it("削除された ref を読み飛ばすこと: 比べるものがない", () => {
    expect(pushedTips(`(delete) ${zero} refs/heads/x ${a}\n`)).toEqual([]);
  });

  it("空の入力から何も読まないこと", () => {
    expect(pushedTips("")).toEqual([]);
  });
});
