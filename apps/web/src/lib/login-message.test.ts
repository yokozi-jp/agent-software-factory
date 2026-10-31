import { describe, expect, it } from "vite-plus/test";

import { selectLoginMessage } from "./login-message.ts";

describe("ログイン画面のメッセージの種類 (selectLoginMessage)", () => {
  it.each([
    ["account_unavailable", "accountUnavailable"],
    ["access_denied", "failed"],
    ["state_mismatch", "failed"],
    ["state_not_found", "failed"],
    ["invalid_code", "failed"],
    ["no_code", "failed"],
    ["something_new", "failed"],
    ["__proto__", "failed"],
    ["toString", "failed"],
  ] as const)("error=%s は %s", (error, kind) => {
    expect(selectLoginMessage(error, undefined)).toBe(kind);
  });

  it.each([
    ["session-expired", "sessionExpired"],
    ["logged-out", "loggedOut"],
  ] as const)("reason=%s は %s", (reason, kind) => {
    expect(selectLoginMessage(undefined, reason)).toBe(kind);
  });

  it("error と reason が両方あれば error を使う", () => {
    expect(selectLoginMessage("invalid_code", "logged-out")).toBe("failed");
  });

  it.each([undefined, "", "other", "<script>", "toString", 1, null, {}])(
    "error がなく、reason が %j なら出さない",
    (reason) => {
      expect(selectLoginMessage(undefined, reason)).toBeUndefined();
    },
  );

  it.each(["", 1, null, undefined])(
    "error が文字列でない、または空 (%j) なら reason に進む",
    (error) => {
      expect(selectLoginMessage(error, "session-expired")).toBe("sessionExpired");
    },
  );
});
