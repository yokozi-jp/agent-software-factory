import { describe, expect, expectTypeOf, it } from "vite-plus/test";

import { exceptionFields, messageCodes, noopLogger, type Logger } from "./index.ts";

describe("メッセージコードの定義 (docs/logging/message-codes.md)", () => {
  const entries = Object.entries(messageCodes);

  it("キーは <領域>-<3桁> の形で、重複しない", () => {
    for (const [code] of entries) expect(code).toMatch(/^[A-Z]+-\d{3}$/);
    expect(new Set(entries.map(([code]) => code)).size).toBe(entries.length);
  });

  it("message、cause、action が空でない", () => {
    for (const [code, definition] of entries) {
      expect([code, definition.message.trim()]).not.toContain("");
      expect([code, definition.cause.trim()]).not.toContain("");
      expect([code, definition.action.trim()]).not.toContain("");
    }
  });

  it("文言が別のコードと同じにならない (同じ文面で意味が違うのを避ける)", () => {
    expect(new Set(entries.map(([, definition]) => definition.message)).size).toBe(entries.length);
  });
});

describe("Logger の型", () => {
  it("warn と error は定義のキーだけを受け取る", () => {
    expectTypeOf<Parameters<Logger["error"]>[0]>().toEqualTypeOf<"API-001">();
    // @ts-expect-error -- not a defined code
    expectTypeOf<Parameters<Logger["error"]>[0]>().toEqualTypeOf<"API-999">();
    // fatal の定義 (API-002) は error には渡せない。
    expectTypeOf<"API-002">().not.toExtend<Parameters<Logger["error"]>[0]>();
  });

  it("LogFields にないキーは渡せない", () => {
    const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
    // @ts-expect-error -- password is not a key of LogFields
    logger.info("x", { password: "p" });
    expect(logger.info("x", { "url.path": "/a" })).toBeUndefined();
  });
});

describe("exceptionFields", () => {
  it("型、メッセージ、スタックトレースだけを出す", () => {
    const error = Object.assign(new Error("duplicate key"), {
      name: "DatabaseError",
      detail: "Key (email)=(a@example.com) already exists.",
      where: "COPY users",
      parameters: ["a@example.com"],
    });
    const fields = exceptionFields(error);
    expect(Object.keys(fields).toSorted()).toEqual([
      "exception.message",
      "exception.stacktrace",
      "exception.type",
    ]);
    expect(fields["exception.type"]).toBe("DatabaseError");
    expect(JSON.stringify(fields)).not.toContain("a@example.com");
  });

  it("Error でない値は中身を出さない", () => {
    expect(exceptionFields({ token: "secret" })).toEqual({
      "exception.type": "object",
      "exception.message": "A non-Error value was thrown.",
    });
  });

  it("スタックトレースがなければ付けない", () => {
    const error = new Error("x");
    delete error.stack;
    expect(exceptionFields(error)).not.toHaveProperty("exception.stacktrace");
  });
});

describe("noopLogger", () => {
  it("どのレベルも何も返さない", () => {
    expect(noopLogger.info("x")).toBeUndefined();
    expect(noopLogger.error("API-001")).toBeUndefined();
    expect(noopLogger.fatal("API-002")).toBeUndefined();
    expect(noopLogger.debug("x")).toBeUndefined();
  });
});
