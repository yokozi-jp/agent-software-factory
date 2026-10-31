import { describe, expect, it } from "vite-plus/test";

import { visibleNavItems } from "./nav-items.ts";

const labels = (roles: readonly string[]) => visibleNavItems(roles).map((item) => item.id);

// 出し分けの網羅は unit に寄せる (Issue #407、#401)。
describe("役割ごとのメニューの項目 (visibleNavItems)", () => {
  it.each([
    { name: "役割なし", roles: [], expected: ["approvals"] },
    { name: "申請者のみ (経理でない)", roles: ["member"], expected: ["approvals"] },
    {
      name: "経理",
      roles: ["accounting"],
      expected: ["approvals", "review", "closing"],
    },
    {
      name: "申請者と経理",
      roles: ["member", "accounting"],
      expected: ["approvals", "review", "closing"],
    },
  ])("$name のとき、見える項目は $expected", ({ roles, expected }) => {
    expect(labels(roles)).toEqual(expected);
  });

  it("見える項目が 0 のグループは作らない", () => {
    const groups = new Set(visibleNavItems(["member"]).map((item) => item.groupId));
    expect([...groups]).toEqual(["approval"]);
  });
});
