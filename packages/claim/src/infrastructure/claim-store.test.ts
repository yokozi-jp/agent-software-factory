import { describe, expect, it } from "vite-plus/test";

import { parseDraft } from "./claim-store.ts";

const newDraft = { _tag: "NewDraft", applicantId: "user-1" } as const;

describe("書いた行を下書きにする (parseDraft)", () => {
  it("claim_id が申請の id なら、申請者を引き継いだ Draft にすること", () => {
    expect(parseDraft({ claim_id: "42" }, newDraft)).toEqual({
      _tag: "Draft",
      id: "42",
      applicantId: "user-1",
    });
  });

  it.each(["", "0", "01", "-1", "abc", "9223372036854775808"])(
    "claim_id が %j なら、壊れたデータとして例外にすること",
    (claimId) => {
      expect(() => parseDraft({ claim_id: claimId }, newDraft)).toThrow(/not a claim id/);
    },
  );
});
