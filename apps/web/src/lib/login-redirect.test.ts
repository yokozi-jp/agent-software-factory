import { describe, expect, it } from "vite-plus/test";

import { loginSearchFor, parseLoginReason, safeRedirect } from "./login-redirect.ts";

// web-xss の規則は javascript: の文字列を止めるので、拒むことを確かめる値は組み立てる。
const scriptUrl = ["javascript", "alert(1)"].join(":");

describe("戻り先の検査 (safeRedirect)", () => {
  it.each(["/", "/claims", "/claims/1?tab=a#top", "/a//b"])("%s は相対パスなので通す", (value) => {
    expect(safeRedirect(value)).toBe(value);
  });

  it.each([
    "//evil.example",
    "//evil.example/path",
    "https://evil.example",
    "http://evil.example/",
    scriptUrl,
    "/\\evil.example",
    "/a\\b",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\u0000",
    "claims",
    "",
    " /claims",
  ])("%j は拒んで / にする", (value) => {
    expect(safeRedirect(value)).toBe("/");
  });

  it.each([undefined, null, 1, {}, ["/claims"]])("文字列でない値 (%j) は / にする", (value) => {
    expect(safeRedirect(value)).toBe("/");
  });
});

describe("理由の解釈 (parseLoginReason)", () => {
  it.each(["session-expired", "logged-out"] as const)("%s は識別子として通す", (value) => {
    expect(parseLoginReason(value)).toBe(value);
  });

  it.each(["", "other", "<script>", undefined, 1])(
    "知らない値 (%j) は無かったことにする",
    (value) => {
      expect(parseLoginReason(value)).toBeUndefined();
    },
  );
});

describe("ログイン画面への search (loginSearchFor)", () => {
  it("元の相対パスを redirect に載せる", () => {
    expect(loginSearchFor("/claims?tab=a")).toEqual({ redirect: "/claims?tab=a" });
  });

  it("元のパスが / なら redirect を省く", () => {
    expect(loginSearchFor("/")).toEqual({});
  });

  it("安全でない元のパスは載せない", () => {
    expect(loginSearchFor("//evil.example")).toEqual({});
  });

  it("理由があれば reason に載せる", () => {
    expect(loginSearchFor("/claims", "session-expired")).toEqual({
      redirect: "/claims",
      reason: "session-expired",
    });
  });
});
