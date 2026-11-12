import { describe, expect, it, test } from "vite-plus/test";

import { createDraft, isClaimId } from "./claim.ts";

describe("申請の id の型述語 (isClaimId)", () => {
  test.each([
    ["", false],
    ["0", false],
    ["1", true],
    ["01", false],
    ["-1", false],
    ["+1", false],
    ["1.5", false],
    [" 1", false],
    ["1 ", false],
    ["a", false],
    ["123456789012345678", true],
    ["9223372036854775806", true],
    ["9223372036854775807", true],
    ["9223372036854775808", false],
    ["9999999999999999999", false],
    ["10000000000000000000", false],
  ])("isClaimId(%j) は %s であること", (input, expected) => {
    expect(isClaimId(input)).toBe(expected);
  });
});

describe("下書きを作る (createDraft)", () => {
  it("許可の証を受けた利用者を、申請者にすること", () => {
    const draft = createDraft({
      permit: { __brand: "Permit", operation: "CreateClaim", actorId: "user-1" },
    });

    expect(draft).toEqual({ _tag: "NewDraft", applicantId: "user-1" });
  });
});
