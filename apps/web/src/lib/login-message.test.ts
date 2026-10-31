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

  it("error も reason もなければ出さない", () => {
    expect(selectLoginMessage(undefined, undefined)).toBeUndefined();
  });

  it("error が空文字なら reason に進む", () => {
    expect(selectLoginMessage("", "session-expired")).toBe("sessionExpired");
  });
});
